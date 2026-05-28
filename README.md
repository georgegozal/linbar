# LinBar

**LinBar** is a *Linux-desktop-style* bottom **taskbar** for macOS: quick launch, live **open apps** (from System Events), focus switching, clock, and a few tray-style shortcuts.

The name is short for **Lin**ux-style **bar** — familiar if you miss XFCE/Mint panels, but built for the Mac.

## Requirements

- macOS (tested with recent versions)
- **Automation / Accessibility**: macOS may prompt the first time LinBar uses **System Events**. Allow LinBar in **System Settings → Privacy & Security → Automation** (LinBar → System Events). If the task list stays empty, also enable **Accessibility** for LinBar (some macOS versions need it to read other apps’ windows).
- Debug: run `LINBAR_DEBUG_TASKS=1 npm start` to log refresh timings, snapshot health, and activation latency in the main window’s terminal.
- Window scope: by default LinBar lists windows from all Spaces that app scripting exposes. Set `LINBAR_CURRENT_SPACE_ONLY=1` to apply stricter current-Space filtering for System Events windows.

## Run from source

```bash
cd linbar
npm install
npm start
```

## What works

- Bottom **panel** above the physical screen edge (may sit over the stock Dock unless you hide it or move it).
- **Refresh** of open windows ~ every 2s (one task button per **window**, e.g. two Terminal windows → two buttons). Click a task to **focus** that window.
- Refresh cadence is adaptive (faster after interactions, slower while idle) to reduce lag without high idle CPU load.
- **Quick launch** (Finder, Safari, Terminal, Documents).
- **Start menu** with common actions.
- Tray: About This Mac, Notifications prefs, **clipboard text preview**, **volume mute** toggle.

## Static prototype

For a browser-only mock (no real apps), see `../xfce-taskbar-demo/`.

## Disclaimer

This is a small utility; it is not affiliated with Apple, XFCE, or Linux Mint.
