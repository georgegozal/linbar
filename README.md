# LinBar

[![Stars](https://img.shields.io/github/stars/georgegozal/linbar?style=flat-square)](https://github.com/georgegozal/linbar/stargazers)
[![Forks](https://img.shields.io/github/forks/georgegozal/linbar?style=flat-square)](https://github.com/georgegozal/linbar/network/members)
[![License: AGPL-3.0](https://img.shields.io/github/license/georgegozal/linbar?style=flat-square)](LICENSE)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square&logo=apple)](https://github.com/georgegozal/linbar)
[![Contributing](https://img.shields.io/badge/contributing-guide-7c3aed?style=flat-square)](CONTRIBUTING.md)

**LinBar** is a *Linux-desktop-style* bottom **taskbar** for macOS: live per-window task buttons, pinned launchers, start menu, calendar, and tray controls.

The name is short for **Lin**ux-style **bar** — familiar if you miss XFCE/Mint panels, but built for the Mac.

**Contents:** [How it works](#how-it-works) · [Requirements](#requirements) · [Run](#run-from-source) · [Install](#install-as-a-macos-app) · [Features](#features) · [Debugging](#debugging) · [Contributing](#contributing) · [Support](#support) · [License](#license)

## How it works

LinBar ships a small native helper (`helper/main.swift`, compiled locally to
`helper/linbar-helper`) that tracks windows **event-driven** through Apple's
Accessibility and NSWorkspace APIs — window opens, closes, focus and title
changes appear on the bar in well under 100ms, with near-zero idle CPU. The
helper uses only Apple frameworks and talks exclusively to the LinBar parent
process over stdio; no data leaves your machine.

If the helper binary is missing or Accessibility permission is not granted,
LinBar falls back to a slower AppleScript backend automatically.

## Requirements

- macOS (tested with recent versions) and Xcode Command Line Tools (`swiftc`)
  to build the helper. `npm install` builds it automatically.
- **Accessibility**: grant LinBar (or your terminal, when running from source)
  access in **System Settings → Privacy & Security → Accessibility**. This is
  what lets the helper enumerate, raise, minimize, and close other apps'
  windows.
- **Automation** (fallback backend only): allow LinBar → System Events when
  macOS prompts.

## Run from source

```bash
cd linbar
npm install      # also compiles helper/linbar-helper
npm start
```

## Install as a macOS app

Build a distributable app bundle or DMG:

```bash
npm install
npm run dist          # creates dist/LinBar-<version>.dmg and dist/LinBar-<version>-mac.zip
# or, for a quick unpacked bundle (no DMG):
npm run dist:dir      # creates dist/mac/LinBar.app
```

**Install:**

1. Open the DMG (or use the `.app` from `dist/mac/`).
2. Drag **LinBar** to **Applications**.
3. Launch LinBar from Applications, Launchpad, or Spotlight.
4. On first launch, follow the setup popup:
   - Grant **Accessibility** (System Settings → Privacy & Security → Accessibility → LinBar).
   - Optionally hide the macOS Dock and enable **Open at login**.
5. Use the **menu-bar LinBar icon** (top-right) or **LinBar → Preferences…** to change settings later.

**Unsigned builds:** macOS may block the first launch. Right-click LinBar → **Open**, or allow it in **System Settings → Privacy & Security**.

**Permissions when installed:** Accessibility applies to **LinBar** in System Settings (not Terminal or Electron). Without it, window buttons, minimize/show-desktop, and Brave/Chrome tabs will not work reliably. Quit and reopen LinBar after granting access.

If the app drawer shows gray placeholders instead of real icons, quit LinBar fully and reopen it once Accessibility is granted.

## Features

- One task button per **window** (not per app), with app icons, stable
  ordering, and instant updates.
- **XFCE click semantics**: click focuses a window, clicking the active
  window minimizes it, middle-click closes it, right-click opens a window
  menu (restore/minimize/close, pin/unpin).
- **Minimized windows** stay on the bar, dimmed and italic.
- **Pinned launchers**: pin any running app from its right-click menu; pins
  persist in `~/.config/linbar/config.json`.
- **Dock-like spacing**: with the native helper, maximized windows stop above the
  taskbar (no gap, no overlap). Toggle in **Preferences → Reserve space for the
  taskbar** (`reserveScreenSpace`, on by default).
- **Start menu** with common apps and folders.
- **Clock with calendar popup** (click the clock). Default is **time only** (24-hour).
  **LinBar → Preferences → Clock** — show date, 12/24-hour, date format (month-first,
  day-first, ISO).
- **Show desktop** — button after the clock; minimizes all open windows (XFCE-style).
- Tray: About This Mac, notification settings, **clipboard preview**, and a
  **volume** control (click to mute, scroll to adjust).

## Debugging

- `LINBAR_DEBUG_TASKS=1 npm start` — log snapshots, timings, and activations.
- `LINBAR_FORCE_APPLESCRIPT=1 npm start` — skip the native helper and use the
  AppleScript backend.
- `npm run build:helper` — rebuild the native helper manually.

## Tips

- **Installed from Applications:** enable **LinBar** under System Settings → Privacy & Security → **Accessibility** (not Terminal). Restart LinBar after granting. Without this, the taskbar won't list windows (e.g. Brave), minimize/show-desktop won't work, and drawer icons may stay gray.
- Hide the stock Dock for the full Linux-panel feel (onboarding offers a one-click
  option, or **System Settings → Desktop & Dock → automatically hide**).
- With **Reserve space for the taskbar** enabled (Preferences), tiled windows shrink
  to sit flush above LinBar — similar to how apps respect the macOS Dock. Requires
  Accessibility and the native helper.
- If a window was resized incorrectly after an upgrade, quit and reopen that app once.

## Static prototype

For a browser-only mock (no real apps), see `../xfce-taskbar-demo/`.

## Contributing

Fork the repo, work on a branch, and open a pull request against [georgegozal/linbar](https://github.com/georgegozal/linbar). See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, helper rebuild, and commit conventions.

## Support

LinBar is **free software** ([AGPL-3.0](LICENSE)). You can use, study, modify, and share it under that license — no payment required.

If the app saves you time, optional tips help fund maintenance and new features. Tips do not unlock extra features or a “pro” edition.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-FFDD00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/georgegozal)

## License

LinBar is free software released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE) for the full text.

## Disclaimer

This is a small utility; it is not affiliated with Apple, XFCE, or Linux Mint.
