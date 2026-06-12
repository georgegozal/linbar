# LinBar

**LinBar** is a *Linux-desktop-style* bottom **taskbar** for macOS: live per-window task buttons, pinned launchers, start menu, calendar, and tray controls.

The name is short for **Lin**ux-style **bar** — familiar if you miss XFCE/Mint panels, but built for the Mac.

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

## Features

- One task button per **window** (not per app), with app icons, stable
  ordering, and instant updates.
- **XFCE click semantics**: click focuses a window, clicking the active
  window minimizes it, middle-click closes it, right-click opens a window
  menu (restore/minimize/close, pin/unpin).
- **Minimized windows** stay on the bar, dimmed and italic.
- **Pinned launchers**: pin any running app from its right-click menu; pins
  persist in `~/.config/linbar/config.json`.
- **Start menu** with common apps and folders.
- **Clock with calendar popup** (click the clock).
- Tray: About This Mac, notification settings, **clipboard preview**, and a
  **volume** control (click to mute, scroll to adjust).

## Debugging

- `LINBAR_DEBUG_TASKS=1 npm start` — log snapshots, timings, and activations.
- `LINBAR_FORCE_APPLESCRIPT=1 npm start` — skip the native helper and use the
  AppleScript backend.
- `npm run build:helper` — rebuild the native helper manually.

## Tips

- The bar sits over the stock Dock; hide the Dock (System Settings →
  Desktop & Dock → automatically hide) for the full Linux feel.

## Static prototype

For a browser-only mock (no real apps), see `../xfce-taskbar-demo/`.

## Disclaimer

This is a small utility; it is not affiliated with Apple, XFCE, or Linux Mint.
