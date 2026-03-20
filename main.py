"""
Sudoku — main.py
Entry point for the pywebview-based Sudoku desktop application.
Cross-platform: Windows / macOS / Linux
Packaged with PyInstaller (see README.md for instructions).
"""

import os
import sys
import pathlib
import platform
import webview


# ──────────────────────────────────────────────
# Resource path helper (dev + PyInstaller)
# ──────────────────────────────────────────────

def resource(relative: str) -> str:
    """Return the absolute path to a bundled resource.

    Works both when running from source and when frozen by PyInstaller
    (the --onefile bundle unpacks to sys._MEIPASS at runtime).
    """
    if getattr(sys, "frozen", False):
        base = sys._MEIPASS  # type: ignore[attr-defined]
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, relative)


# ──────────────────────────────────────────────
# App data directory (OS-appropriate)
# ──────────────────────────────────────────────

def get_app_data_dir() -> pathlib.Path:
    """
    Return (and create) the platform-specific user data directory.

    Windows : %APPDATA%\\Sudoku
    macOS   : ~/Library/Application Support/Sudoku
    Linux   : $XDG_CONFIG_HOME/Sudoku  (defaults to ~/.config/Sudoku)
    """
    system = platform.system()
    if system == "Windows":
        base = pathlib.Path(os.environ.get("APPDATA", "~")).expanduser()
    elif system == "Darwin":
        base = pathlib.Path("~/Library/Application Support").expanduser()
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME", "")
        base = pathlib.Path(xdg).expanduser() if xdg else pathlib.Path("~/.config").expanduser()

    app_dir = base / "Sudoku"
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


# ──────────────────────────────────────────────
# JavaScript ↔ Python API
# ──────────────────────────────────────────────

class WindowAPI:
    """Methods exposed to JavaScript via window.pywebview.api.*"""

    def __init__(self) -> None:
        self._win: webview.Window | None = None

    def bind(self, win: "webview.Window") -> None:
        self._win = win

    # Window controls ─────────────────────────

    def minimize(self) -> None:
        if self._win:
            self._win.minimize()

    def close(self) -> None:
        if self._win:
            self._win.destroy()

    def move_to(self, x: float, y: float) -> None:
        """Move the window to an absolute screen position (used by JS drag)."""
        if self._win:
            self._win.move(int(x), int(y))

    # State persistence ───────────────────────

    def save_state(self, data: str) -> bool:
        """Persist the full game state JSON to disk. Called from JS.

        Args:
            data: UTF-8 JSON string produced by the JS serialiser.

        Returns:
            True on success, False on any I/O error.
        """
        try:
            path = get_app_data_dir() / "state.json"
            path.write_text(data, encoding="utf-8")
            return True
        except Exception as exc:
            print(f"[Sudoku] save_state failed: {exc}", file=sys.stderr)
            return False

    def load_state(self) -> str | None:
        """Read the persisted state JSON from disk. Called from JS on startup.

        Returns:
            The raw JSON string, or None if no save file exists.
        """
        try:
            path = get_app_data_dir() / "state.json"
            if path.exists():
                return path.read_text(encoding="utf-8")
            return None
        except Exception as exc:
            print(f"[Sudoku] load_state failed: {exc}", file=sys.stderr)
            return None

    def clear_state(self) -> bool:
        """Delete the saved state file (used when starting a fresh game)."""
        try:
            path = get_app_data_dir() / "state.json"
            if path.exists():
                path.unlink()
            return True
        except Exception as exc:
            print(f"[Sudoku] clear_state failed: {exc}", file=sys.stderr)
            return False

    # Utility ─────────────────────────────────

    def platform(self) -> str:
        """Return 'Windows', 'Darwin', or 'Linux'."""
        return platform.system()


# ──────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────

def main() -> None:
    api = WindowAPI()

    win = webview.create_window(
        title="Sudoku",
        url=resource("index.html"),
        width=520,
        height=700,
        resizable=False,
        frameless=True,
        easy_drag=False,          # drag is handled in JS via move_to()
        background_color="#0C0C14",
        min_size=(520, 700),
        on_top=False,
    )

    api.bind(win)
    win.expose(
        api.minimize,
        api.close,
        api.move_to,
        api.platform,
        api.save_state,
        api.load_state,
        api.clear_state,
    )

    debug = "--debug" in sys.argv
    webview.start(debug=debug)


if __name__ == "__main__":
    main()
