# Contributing to OpenDoku

Thanks for your interest. All contributions are welcome — bug reports, feature ideas, code, or docs.

---

## Getting Started

1. Fork the repository and clone your fork:

```bash
git clone https://github.com/mietek64/opendoku.git
cd opendoku
```

2. Create a virtual environment and install dependencies:

```bash
# Windows
py -3.13 -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python3.13 -m venv .venv && source .venv/bin/activate

pip install .[build]
```

3. Create a feature branch:

```bash
git checkout -b feat/your-feature-name
```

4. Run the app and confirm everything works:

```bash
python main.py --debug
```

---

## Reporting Bugs

Open an issue and include:

- Your OS and Python version
- Steps to reproduce
- What you expected vs. what happened
- Any error output or screenshots

---

## Suggesting Features

Open an issue describing the problem you want to solve and your proposed solution. Discuss before writing code — it avoids wasted effort.

---

## Submitting a Pull Request

- Keep PRs focused — one change per PR makes review faster
- Make sure your branch is up to date with `main` before opening
- Link related issues in the PR description (`Closes #12`)
- Be responsive to feedback — PRs with no activity for 30 days may be closed

---

## Code Style

**Python (`main.py`)**
- Follow PEP 8
- Type annotations on all function signatures
- Keep methods short and focused

**JavaScript (`script.js`)**
- `"use strict"` at the top
- `const` by default, `let` when rebinding, never `var`
- No external runtime dependencies

**CSS (`style.css`)**
- All colours through CSS custom properties — no hardcoded hex in rules
- Both themes fully defined in their `[data-theme]` blocks
- Comment every logical section

**HTML (`index.html`)**
- No inline styles

---

## Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <short summary>
```

| Type | When to use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `style` | Visual / CSS changes |
| `refactor` | Code change without behaviour change |
| `docs` | Documentation only |
| `chore` | Tooling, CI, dependencies |

Examples:

```
feat: add sound effects toggle
fix: prevent hint cycling exploit
docs: add Linux WebKitGTK instructions
```
