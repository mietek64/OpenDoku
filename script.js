/* ============================================================
   SUDOKU — script.js
   Engine  : generator · solver · validator
   UI      : board render · theme · timer · drag · keyboard
   Persist : save / load via pywebview.api (roaming JSON)
   ============================================================ */

"use strict";

// ──────────────────────────────────────────────────────────────
// 1. Constants
// ──────────────────────────────────────────────────────────────

const STATE_VERSION = 2;

/** Maximum allowed mistakes per difficulty before the game is lost. */
const MAX_MISTAKES = { easy: 5, medium: 4, hard: 3, expert: 2 };

/** Hints allowed per game (all difficulties). */
const MAX_HINTS = 3;

/** Givens (filled cells) per difficulty — controls puzzle density. */
const CLUES = { easy: 38, medium: 30, hard: 25, expert: 22 };


// ──────────────────────────────────────────────────────────────
// 2. Sudoku Engine
// ──────────────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function firstEmpty(board) { return board.indexOf(0); }

function canPlace(board, idx, num) {
  const r = (idx / 9) | 0, c = idx % 9;
  for (let i = 0; i < 9; i++) {
    if (board[r * 9 + i] === num) return false;
    if (board[i * 9 + c] === num) return false;
  }
  const br = (r / 3 | 0) * 3, bc = (c / 3 | 0) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      if (board[(br + dr) * 9 + (bc + dc)] === num) return false;
  return true;
}

function solve(board) {
  const idx = firstEmpty(board);
  if (idx === -1) return true;
  for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (canPlace(board, idx, n)) {
      board[idx] = n;
      if (solve(board)) return true;
      board[idx] = 0;
    }
  }
  return false;
}

function generatePuzzle(difficulty) {
  const solution = new Array(81).fill(0);
  solve(solution);
  const puzzle   = solution.slice();
  const toKeep   = CLUES[difficulty] ?? 30;
  let removed    = 0;
  for (const idx of shuffle([...Array(81).keys()])) {
    if (removed >= 81 - toKeep) break;
    puzzle[idx] = 0;
    removed++;
  }
  return { puzzle, solution };
}


// ──────────────────────────────────────────────────────────────
// 3. Game State
// ──────────────────────────────────────────────────────────────

class Game {
  constructor() { this._reset(); }

  _reset() {
    this.difficulty = "medium";
    this.puzzle     = new Array(81).fill(0);
    this.solution   = new Array(81).fill(0);
    this.board      = new Array(81).fill(0);
    this.given      = new Array(81).fill(false);
    /** @type {Set<number>[]} */
    this.notes      = Array.from({ length: 81 }, () => new Set());
    this.history    = [];     // undo stack (capped at 200)
    this.mistakes   = 0;
    this.hints      = 0;
    this.solved     = false;
    this.lost       = false;
  }

  // ── Start a fresh puzzle ───────────────────────────────────

  start(difficulty) {
    this._reset();
    this.difficulty = difficulty;
    const { puzzle, solution } = generatePuzzle(difficulty);
    this.puzzle   = puzzle;
    this.solution = solution;
    this.board    = puzzle.slice();
    this.given    = puzzle.map(v => v !== 0);
  }

  // ── Computed ───────────────────────────────────────────────

  get maxMistakes() { return MAX_MISTAKES[this.difficulty] ?? 3; }

  isError(idx) {
    const v = this.board[idx];
    return v !== 0 && v !== this.solution[idx];
  }

  // ── Mutations ──────────────────────────────────────────────

  /**
   * Place a value in a cell.
   * Returns: 'given' | 'locked' | 'ok' | 'new-mistake' | 'lost' | 'won'
   *
   * A cell that already holds a wrong answer must be ERASED first —
   * direct overwrite is blocked. This prevents cycling through numbers
   * to find the correct one at the cost of only one mistake.
   */
  setCell(idx, val) {
    if (this.given[idx] || this.solved || this.lost) return "given";

    // Block overwriting a wrong cell — player must erase first
    if (this.isError(idx)) return "locked";

    this._snapshot(idx);
    this.board[idx] = val;
    if (val !== 0) this.notes[idx].clear();

    const isWrong = val !== 0 && val !== this.solution[idx];
    if (isWrong) {
      this.mistakes++;
      if (this.mistakes >= this.maxMistakes) {
        this.lost = true;
        return "lost";
      }
      return "new-mistake";
    }

    this._checkSolved();
    return this.solved ? "won" : "ok";
  }

  toggleNote(idx, n) {
    if (this.given[idx] || this.board[idx] !== 0 || this.solved || this.lost) return false;
    this._snapshot(idx);
    if (this.notes[idx].has(n)) this.notes[idx].delete(n);
    else                         this.notes[idx].add(n);
    return true;
  }

  erase(idx) {
    if (this.given[idx] || this.solved || this.lost) return false;
    this._snapshot(idx);
    this.board[idx] = 0;
    this.notes[idx].clear();
    return true;
  }

  /**
   * Undo the last action.
   * Returns the affected cell index, or null if nothing to undo.
   * NOTE: mistakes are NOT refunded on undo — this is intentional.
   */
  undo() {
    const snap = this.history.pop();
    if (!snap) return null;
    this.board[snap.idx] = snap.val;
    this.notes[snap.idx] = snap.notes;
    this.solved = false;
    this.lost   = false;
    return snap.idx;
  }

  /** Reveal a random empty cell with the correct value (max MAX_HINTS per game). */
  hint() {
    if (this.solved || this.lost || this.hints >= MAX_HINTS) return null;
    const empties = this.board
      .map((v, i) => (v === 0 && !this.given[i] ? i : -1))
      .filter(i => i !== -1);
    if (!empties.length) return null;
    const idx = empties[(Math.random() * empties.length) | 0];
    this.hints++;
    this.setCell(idx, this.solution[idx]);
    return idx;
  }

  // ── Serialisation ──────────────────────────────────────────

  toJSON() {
    return {
      version   : STATE_VERSION,
      difficulty: this.difficulty,
      puzzle    : this.puzzle,
      solution  : this.solution,
      board     : this.board,
      given     : this.given,
      notes     : this.notes.map(s => [...s]),
      history   : this.history.map(snap => ({
        idx  : snap.idx,
        val  : snap.val,
        notes: [...snap.notes],
      })),
      mistakes  : this.mistakes,
      hints     : this.hints,
      solved    : this.solved,
      lost      : this.lost,
    };
  }

  static fromJSON(obj) {
    if (!obj || obj.version !== STATE_VERSION) return null;
    const g = new Game();
    g.difficulty = obj.difficulty ?? "medium";
    g.puzzle     = obj.puzzle;
    g.solution   = obj.solution;
    g.board      = obj.board;
    g.given      = obj.given;
    g.notes      = (obj.notes ?? []).map(arr => new Set(arr));
    g.history    = (obj.history ?? []).map(snap => ({
      idx  : snap.idx,
      val  : snap.val,
      notes: new Set(snap.notes),
    }));
    g.mistakes   = obj.mistakes ?? 0;
    g.hints      = obj.hints    ?? 0;
    g.solved     = obj.solved   ?? false;
    g.lost       = obj.lost     ?? false;
    return g;
  }

  // ── Internal ───────────────────────────────────────────────

  _snapshot(idx) {
    this.history.push({
      idx,
      val  : this.board[idx],
      notes: new Set(this.notes[idx]),
    });
    // Cap history to avoid unbounded growth
    if (this.history.length > 200) this.history.shift();
  }

  _checkSolved() {
    this.solved = this.board.every((v, i) => v !== 0 && v === this.solution[i]);
  }
}


// ──────────────────────────────────────────────────────────────
// 4. Persistence helpers
// ──────────────────────────────────────────────────────────────

/** True when the pywebview API bridge is available. */
function hasPyAPI() {
  return !!(window.pywebview && window.pywebview.api);
}

/** Debounce helper — returns a function that fires after `ms` quiet time. */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}


// ──────────────────────────────────────────────────────────────
// 5. UI Controller
// ──────────────────────────────────────────────────────────────

class SudokuUI {
  constructor() {
    this.game      = new Game();
    this.selIdx    = null;
    this.notesMode = false;
    this.themeMode = "auto";

    this._timerSec = 0;
    this._timerRef = null;

    // DOM refs
    this.$board      = document.getElementById("board");
    this.$timer      = document.getElementById("timer");
    this.$lives      = document.getElementById("lives");
    this.$overlay    = document.getElementById("overlay");
    this.$overlayIcon = document.getElementById("overlay-icon");
    this.$overlayTitle= document.getElementById("overlay-title");
    this.$overlaySub  = document.getElementById("overlay-sub");
    this.$btnNotes   = document.getElementById("btn-notes");

    // Build the 81 cell elements once
    this.cells = [];
    for (let i = 0; i < 81; i++) {
      const el = document.createElement("div");
      el.className  = "cell";
      el.tabIndex   = 0;
      el.dataset.row = (i / 9) | 0;
      el.dataset.col = i % 9;
      el.dataset.idx = i;
      el.addEventListener("click",   () => this._select(i));
      el.addEventListener("keydown", e  => this._onCellKey(e, i));
      this.cells.push(el);
      this.$board.appendChild(el);
    }

    // Debounced save (fires 400 ms after last change)
    this._debouncedSave = debounce(() => this._persistState(), 400);

    this._bindControls();
    this._initTheme();
    this._initKeyboard();
    this._initDrag();
    this._initPersistence();   // may call newGame() if no save
  }

  // ── New Game ───────────────────────────────────────────────

  newGame() {
    const diff = document.getElementById("sel-difficulty").value;
    this.game.start(diff);
    this.selIdx    = null;
    this.notesMode = false;
    this.$btnNotes.classList.remove("is-active");
    this.$board.classList.remove("is-locked");
    this._stopTimer();
    this._timerSec = 0;
    this._renderTimer();
    this._startTimer();
    this._hideOverlay();
    this._renderLives();
    this._renderHintBtn();
    this._render();

    // Immediately clear old save and write the fresh game
    if (hasPyAPI()) {
      window.pywebview.api.clear_state().then(() => this._persistState());
    }
  }

  // ── Controls binding ───────────────────────────────────────

  _bindControls() {
    document.getElementById("btn-new")
      .addEventListener("click", () => this.newGame());
    document.getElementById("btn-overlay-new")
      .addEventListener("click", () => this.newGame());

    document.getElementById("btn-undo")
      .addEventListener("click", () => this._undo());
    document.getElementById("btn-erase")
      .addEventListener("click", () => this._erase());
    document.getElementById("btn-hint")
      .addEventListener("click", () => this._hint());

    this.$btnNotes.addEventListener("click", () => {
      this.notesMode = !this.notesMode;
      this.$btnNotes.classList.toggle("is-active", this.notesMode);
    });

    document.querySelectorAll(".num").forEach(btn => {
      btn.addEventListener("click", () => this._input(+btn.dataset.n));
    });

    document.getElementById("btn-theme")
      .addEventListener("click", () => this._cycleTheme());
  }

  // ── Input ──────────────────────────────────────────────────

  _select(idx) {
    this.selIdx = idx;
    this._render();
  }

  _input(n) {
    if (this.selIdx === null) return;
    if (this.game.solved || this.game.lost) return;

    if (this.notesMode) {
      this.game.toggleNote(this.selIdx, n);
      this._render();
      this._debouncedSave();
      return;
    }

    const result = this.game.setCell(this.selIdx, n);
    this._flashNum(n);

    switch (result) {
      case "won":
        this._render();
        this._win();
        break;

      case "lost":
        this._renderLives();
        this._render();
        // Brief delay so the losing pip pop-in plays before overlay
        setTimeout(() => this._lose(), 700);
        break;

      case "new-mistake":
        this._renderLives(true); // animate newest pip
        this._shakeCell(this.selIdx);
        this._render();
        break;

      case "locked":
        // Cell holds a wrong value — must erase first. Nudge it.
        this._shakeCell(this.selIdx);
        return; // no save needed, nothing changed

      default:
        this._render();
        break;
    }

    this._debouncedSave();
  }

  _erase() {
    if (this.selIdx === null) return;
    if (this.game.erase(this.selIdx)) {
      this._render();
      this._debouncedSave();
    }
  }

  _undo() {
    const idx = this.game.undo();
    if (idx !== null) {
      this.selIdx = idx;
      this.$board.classList.remove("is-locked");
      this._hideOverlay();
      this._renderLives();
      this._render();
      this._debouncedSave();
    }
  }

  _hint() {
    if (this.game.solved || this.game.lost) return;
    const idx = this.game.hint();
    if (idx === null) return;
    this.selIdx = idx;
    if (this.game.solved) {
      this._render();
      this._renderHintBtn();
      this._win();
    } else {
      this._render();
      this._renderHintBtn();
    }
    // Animate hinted cell
    requestAnimationFrame(() => {
      this.cells[idx].classList.add("hint-flash");
      this.cells[idx].addEventListener(
        "animationend",
        () => this.cells[idx].classList.remove("hint-flash"),
        { once: true }
      );
    });
    this._debouncedSave();
  }

  // ── Render — board ─────────────────────────────────────────

  _render() {
    const sel    = this.selIdx;
    const selVal = sel !== null ? this.game.board[sel] : 0;
    const selR   = sel !== null ? (sel / 9) | 0 : -1;
    const selC   = sel !== null ?  sel % 9       : -1;
    const selBR  = (selR / 3) | 0;
    const selBC  = (selC / 3) | 0;

    this.cells.forEach((el, i) => {
      const r   = (i / 9) | 0, c = i % 9;
      const val      = this.game.board[i];
      const isGiven  = this.game.given[i];
      const isSel    = i === sel;
      const isRel    = !isSel && sel !== null && (
        r === selR || c === selC ||
        ((r / 3 | 0) === selBR && (c / 3 | 0) === selBC)
      );
      const isSameVal = !isSel && selVal !== 0 && val === selVal;
      const isErr     = this.game.isError(i);

      el.className = "cell";
      if (isGiven)     el.classList.add("is-given");
      else if (val)    el.classList.add("is-user");
      if (isSel)       el.classList.add("is-selected");
      else if (isSameVal) el.classList.add("is-same-val");
      else if (isRel)  el.classList.add("is-related");
      if (isErr)       el.classList.add("is-err");

      if (val !== 0) {
        el.textContent = val;
      } else if (this.game.notes[i].size > 0) {
        el.innerHTML = "";
        const grid = document.createElement("div");
        grid.className = "notes-grid";
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement("div");
          span.className = "note-n";
          span.textContent = this.game.notes[i].has(n) ? n : "";
          grid.appendChild(span);
        }
        el.appendChild(grid);
      } else {
        el.textContent = "";
      }
    });
  }

  // ── Render — lives / mistake pips ─────────────────────────

  /**
   * Rebuild the pip display.
   * @param {boolean} [animateLast] - pop-in the newest (rightmost used) pip
   */
  _renderLives(animateLast = false) {
    const max      = this.game.maxMistakes;
    const used     = this.game.mistakes;
    this.$lives.innerHTML = "";

    for (let i = 0; i < max; i++) {
      const pip = document.createElement("span");
      pip.className = "pip";
      if (i < used) {
        pip.classList.add("pip-used");
        if (animateLast && i === used - 1) pip.classList.add("pip-new");
      }
      this.$lives.appendChild(pip);
    }
  }


  // ── Render — hint button label ─────────────────────────────

  _renderHintBtn() {
    const remaining = MAX_HINTS - this.game.hints;
    if (this.$hintLabel) {
      this.$hintLabel.textContent = remaining > 0
        ? `Hint · ${remaining}`
        : "Hint · 0";
    }
    const btn = document.getElementById("btn-hint");
    if (btn) btn.classList.toggle("is-exhausted", remaining <= 0);
  }

  // ── Animations ─────────────────────────────────────────────

  _flashNum(n) {
    const btn = document.querySelector(`.num[data-n="${n}"]`);
    if (!btn) return;
    btn.classList.add("is-flash");
    setTimeout(() => btn.classList.remove("is-flash"), 180);
  }

  _shakeCell(idx) {
    const el = this.cells[idx];
    if (!el) return;
    el.classList.remove("is-shake");
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add("is-shake");
    el.addEventListener("animationend", () => el.classList.remove("is-shake"), { once: true });
  }

  // ── Win / Lose ─────────────────────────────────────────────

  _win() {
    this._stopTimer();
    this.$board.classList.add("is-locked");
    this.$overlayIcon.textContent  = "✦";
    this.$overlayTitle.textContent = "Puzzle Complete";
    const mis = this.game.mistakes;
    this.$overlaySub.textContent   =
      `Solved in ${this.$timer.textContent}` +
      (mis > 0 ? ` · ${mis} mistake${mis !== 1 ? "s" : ""}` : " · Perfect!");
    this.$overlay.dataset.result = "win";
    this.$overlay.classList.add("is-visible");
    this._persistState();
  }

  _lose() {
    this._stopTimer();
    this.$board.classList.add("is-locked");
    this.$overlayIcon.textContent  = "✕";
    this.$overlayTitle.textContent = "Game Over";
    this.$overlaySub.textContent   =
      `${this.game.maxMistakes} mistakes reached · ${this.$timer.textContent}`;
    this.$overlay.dataset.result = "lose";
    this.$overlay.classList.add("is-visible");
    this._persistState();
  }

  _hideOverlay() {
    this.$overlay.classList.remove("is-visible");
  }

  // ── Timer ──────────────────────────────────────────────────

  _startTimer() {
    this._timerRef = setInterval(() => {
      this._timerSec++;
      this._renderTimer();
      // Save timer every 10 s to avoid excessive writes
      if (this._timerSec % 10 === 0) this._persistState();
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this._timerRef);
    this._timerRef = null;
  }

  _renderTimer() {
    const m = String(Math.floor(this._timerSec / 60)).padStart(2, "0");
    const s = String(this._timerSec % 60).padStart(2, "0");
    this.$timer.textContent = `${m}:${s}`;
  }

  // ── Theme ──────────────────────────────────────────────────

  _initTheme() {
    window.matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (this.themeMode === "auto") this._resolveTheme();
      });
    // Theme is applied when state loads; fallback below in _initPersistence
  }

  _applyThemeMode(mode) {
    this.themeMode = mode;
    document.documentElement.dataset.themeMode = mode;
    this._resolveTheme();
  }

  _resolveTheme() {
    let theme = this.themeMode;
    if (theme === "auto") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.dataset.theme = theme;
  }

  _cycleTheme() {
    const order = ["dark", "light", "auto"];
    const next  = order[(order.indexOf(this.themeMode) + 1) % order.length];
    this._applyThemeMode(next);
    this._debouncedSave();
  }

  // ── State Persistence ──────────────────────────────────────

  _initPersistence() {
    // Save immediately before the window unloads
    window.addEventListener("beforeunload", () => {
      this._persistStateSync();
    });

    if (hasPyAPI()) {
      this._loadStateFromDisk();
    } else {
      // Running in a browser for dev — fall back to localStorage
      const raw = (() => { try { return localStorage.getItem("sudoku-state"); } catch { return null; } })();
      if (raw) this._restoreState(raw);
      else     this.newGame();
    }

    // Also handle the pywebviewready event in case the page loads before the bridge
    window.addEventListener("pywebviewready", () => {
      if (!this._stateLoaded) this._loadStateFromDisk();
    });
  }

  _loadStateFromDisk() {
    this._stateLoaded = true;
    window.pywebview.api.load_state().then(raw => {
      if (raw) {
        const ok = this._restoreState(raw);
        if (!ok) this.newGame();
      } else {
        this.newGame();
      }
    }).catch(() => this.newGame());
  }

  /**
   * Restore UI from a serialised JSON string.
   * Returns true on success, false if the data is invalid.
   */
  _restoreState(raw) {
    try {
      const obj = JSON.parse(raw);

      // Restore theme first so there's no flash
      if (obj.themeMode) this._applyThemeMode(obj.themeMode);
      else               this._applyThemeMode("auto");

      const g = Game.fromJSON(obj.game);
      if (!g) return false;

      this.game      = g;
      this._timerSec = obj.timerSec ?? 0;
      this.notesMode = obj.notesMode ?? false;
      this.selIdx    = null;

      // Restore difficulty selector
      const sel = document.getElementById("sel-difficulty");
      if (sel) sel.value = g.difficulty;

      this.$btnNotes.classList.toggle("is-active", this.notesMode);

      this._stopTimer();
      this._renderTimer();
      if (!g.solved && !g.lost) this._startTimer();

      this._renderLives();
      this._renderHintBtn();
      this._render();

      if (g.solved) {
        this.$board.classList.add("is-locked");
        this._win();
      } else if (g.lost) {
        this.$board.classList.add("is-locked");
        this._lose();
      }

      return true;
    } catch (e) {
      console.warn("[Sudoku] Failed to restore state:", e);
      return false;
    }
  }

  /** Full state object saved to disk. */
  _buildStatePayload() {
    return JSON.stringify({
      version   : STATE_VERSION,
      themeMode : this.themeMode,
      timerSec  : this._timerSec,
      notesMode : this.notesMode,
      game      : this.game.toJSON(),
    });
  }

  /** Async (debounced) save — used during normal gameplay. */
  _persistState() {
    const payload = this._buildStatePayload();
    if (hasPyAPI()) {
      window.pywebview.api.save_state(payload);
    } else {
      try { localStorage.setItem("sudoku-state", payload); } catch {}
    }
  }

  /**
   * Synchronous-style save triggered by beforeunload.
   * pywebview API calls are async by nature; we fire and hope.
   */
  _persistStateSync() {
    const payload = this._buildStatePayload();
    if (hasPyAPI()) {
      window.pywebview.api.save_state(payload);
    } else {
      try { localStorage.setItem("sudoku-state", payload); } catch {}
    }
  }

  // ── Keyboard ───────────────────────────────────────────────

  _initKeyboard() {
    document.addEventListener("keydown", e => {
      if (e.target.tagName === "SELECT") return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        this._input(n);
      } else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
        this._erase();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        this._undo();
      } else if (e.key === "n" || e.key === "N") {
        this.$btnNotes.click();
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        this._arrowMove(e.key);
      }
    });
  }

  _onCellKey(e, idx) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._select(idx); }
  }

  _arrowMove(key) {
    if (this.selIdx === null) { this._select(0); return; }
    let r = (this.selIdx / 9) | 0, c = this.selIdx % 9;
    if (key === "ArrowUp")    r = (r + 8) % 9;
    if (key === "ArrowDown")  r = (r + 1) % 9;
    if (key === "ArrowLeft")  c = (c + 8) % 9;
    if (key === "ArrowRight") c = (c + 1) % 9;
    this._select(r * 9 + c);
  }

  // ── Window drag (frameless) ────────────────────────────────

  _initDrag() {
    const titlebar = document.getElementById("titlebar");
    let dragging = false, offX = 0, offY = 0;
    let rafId = null, latestX = 0, latestY = 0;

    titlebar.addEventListener("mousedown", e => {
      if (e.target.closest(".wbtn") || e.target.closest(".titlebar-right")) return;
      dragging = true;
      offX = e.screenX - (window.screenX || 0);
      offY = e.screenY - (window.screenY || 0);
      e.preventDefault();
    });

    document.addEventListener("mousemove", e => {
      if (!dragging) return;
      latestX = e.screenX - offX;
      latestY = e.screenY - offY;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (hasPyAPI()) window.pywebview.api.move_to(latestX, latestY);
        });
      }
    });

    document.addEventListener("mouseup", () => { dragging = false; });
  }
}


// ──────────────────────────────────────────────────────────────
// 6. Window control helpers (called from HTML onclick attrs)
// ──────────────────────────────────────────────────────────────

function wClose() {
  // Save immediately, then close
  if (window.sudoku) window.sudoku._persistStateSync();
  if (hasPyAPI()) window.pywebview.api.close();
}

function wMinimize() {
  if (hasPyAPI()) window.pywebview.api.minimize();
}


// ──────────────────────────────────────────────────────────────
// 7. Bootstrap
// ──────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  window.sudoku = new SudokuUI();
});
