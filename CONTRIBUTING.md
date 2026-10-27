# Contributing to LinBar

Thanks for improving LinBar. This project lives at **[github.com/georgegozal/linbar](https://github.com/georgegozal/linbar)** — forks and pull requests should target upstream **`main`**.

## Before you start

- **Bug fixes and small improvements** — open a pull request and describe what you tested on macOS.
- **Large features** (helper protocol changes, new tray APIs, packaging) — open an [issue](https://github.com/georgegozal/linbar/issues) first.
- **Security** — do not post exploit details in public issues; contact the maintainer privately.

## Development setup

Requirements: **macOS**, **Node.js**, **npm**, and **Xcode Command Line Tools** (`swiftc` for the native helper).

```bash
git clone https://github.com/georgegozal/linbar.git
cd linbar
npm install    # builds helper/linbar-helper via postinstall
npm start
```

Grant **Accessibility** to LinBar (or Terminal when running from source) in System Settings.

**README screenshot (no Mac required):** `bash scripts/generate-readme-screenshot.sh` — headless Firefox captures `docs/readme-screenshot.html` into `assets/screenshot.png`.

Useful env vars (see [README.md](README.md#debugging)):

- `LINBAR_DEBUG_TASKS=1 npm start`
- `LINBAR_FORCE_APPLESCRIPT=1 npm start`

## Pull request workflow

1. **Fork** [georgegozal/linbar](https://github.com/georgegozal/linbar) and clone your fork.
2. Add upstream: `git remote add upstream git@github.com:georgegozal/linbar.git`
3. Branch from `main`, e.g. `fix/task-button-order` or `feat/clock-format`.
4. Keep changes focused; match existing JS/Swift style in touched files.
5. **Commit** with clear messages (see below).
6. Open a PR against **`georgegozal/linbar` `main`** with what changed and how you tested.

## Commit messages

Prefer short, imperative subjects. Prefixes used elsewhere in the ecosystem:

- `fix:` — bug fix  
- `feat:` — new behavior  
- `refactor:` — internal change  
- `docs:` — documentation only  

## Code layout

- **`main.js`**, **`preload.js`** — Electron main/preload.
- **`renderer/`** — taskbar UI (HTML/CSS/JS).
- **`lib/`** — config, helper bridge, AppleScript fallback.
- **`helper/`** — Swift native window-tracking helper (`main.swift`).

## License

By contributing, you agree your work is licensed under **AGPL-3.0** ([LICENSE](LICENSE)).
