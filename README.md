# LinBar

**LinBar** is a *Linux-desktop-style* bottom **taskbar** for macOS: quick launch, live **open apps** (from System Events), focus switching, clock, and a few tray-style shortcuts.

The name is short for **Lin**ux-style **bar** — familiar if you miss XFCE/Mint panels, but built for the Mac.

## Requirements

- macOS (tested with recent versions)
- **Automation / Accessibility**: macOS may prompt the first time LinBar asks **System Events** to list windows and activate apps. Allow LinBar in **System Settings → Privacy & Security → Automation** (and **Accessibility** if macOS asks).

## Run from source

```bash
cd linbar
npm install
npm start
```

## What works

- Bottom **panel** above the physical screen edge (may sit over the stock Dock unless you hide it or move it).
- **Refresh** of running apps ~ every 2s; click a task to **activate** that app.
- **Quick launch** (Finder, Safari, Terminal, Documents).
- **Start menu** with common actions.
- Tray: About This Mac, Notifications prefs, **clipboard text preview**, **volume mute** toggle.

## Static prototype

For a browser-only mock (no real apps), see `../xfce-taskbar-demo/`.

## Disclaimer

This is a small utility; it is not affiliated with Apple, XFCE, or Linux Mint.
