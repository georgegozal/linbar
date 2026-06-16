# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LinBar is an Electron app for **macOS only** that renders a Linux/XFCE-style taskbar pinned to the bottom edge of the screen: one button per **window** (not per app), pinned launchers, an app drawer, a clock/calendar, and tray widgets (clipboard history, volume, battery). It overlays the stock Dock — macOS cannot reserve screen space for third-party panels.

## Commands

```bash
npm install          # installs deps AND compiles the Swift helper (postinstall)
npm start            # run the app (electron .)
npm run build:helper # recompile helper/linbar-helper manually after editing main.swift
npm run pack         # electron-builder --dir (alias for dist:dir)
npm run dist:dir     # unpacked LinBar.app in dist/mac/
npm run dist         # DMG + zip in dist/
```

There is **no test suite, linter, or formatter** configured. "Verifying" a change means running `npm start` and watching the bar / debug logs.

### Debug env vars

- `LINBAR_DEBUG_TASKS=1` — log every refresh, osascript call, timing, and activation.
- `LINBAR_FORCE_APPLESCRIPT=1` — skip the native helper entirely; exercise the fallback backend.
- `LINBAR_CURRENT_SPACE_ONLY=1` — AppleScript backend lists only current-Space windows.
- `LINBAR_TASK_CACHE_MS`, `LINBAR_OSASCRIPT_TIMEOUT_MS` — tune the AppleScript backend.

## Architecture

Standard Electron three-layer split: **main process** (`main.js`) ↔ **preload** (`preload.js`, the only IPC surface) ↔ **renderer** (`renderer/`). `contextIsolation` is on and `nodeIntegration` is off, so the renderer touches the system *only* through the `window.taskbar` API defined in `preload.js`. When adding a feature that needs OS access, you almost always touch all three: add an `ipcMain.handle`/`.on` in `main.js`, expose it in `preload.js`, call it in `renderer/app.js`.

### Two interchangeable window backends (the core design)

Window tracking has two implementations behind one payload shape. `startBackend()` in `main.js` picks at runtime and can hot-swap on failure:

1. **Native helper (preferred, event-driven)** — `helper/main.swift`, compiled to `helper/linbar-helper`, spawned by `lib/helper.js`. Communicates over **stdio with newline-delimited JSON**: the helper streams `snapshot`/`status`/`icon`/`categories` messages on stdout; the main process sends `raise`/`minimize`/`close`/`snapshot`/`icon`/`categories` commands on stdin. It uses `NSWorkspace` notifications + per-app `AXObserver` to push window changes in <100ms with ~zero idle CPU. Requires the **Accessibility** permission. Window identity is the stable `CGWindowID` obtained via the private (but ABI-stable) `_AXUIElementGetWindow`.

2. **AppleScript fallback (slow, polling)** — `lib/applescript.js`. Used when the helper binary is missing, Accessibility is denied, or the helper exits. Polls via `osascript`/`System Events` on a self-adjusting timer (`TASK_REFRESH_ACTIVE_MS`/`IDLE_MS`), plus a fast `lsappinfo` frontmost poll (`lib/lsappinfo.js`, ~20ms) for the active highlight between full scans. `System Events` scans can take **seconds under load** — this is the known performance ceiling that the native helper exists to fix.

**Both backends produce the same task payload** (`{ tasks, front, error, meta }`) which `emitTaskPayload` sends to the renderer over `taskbar:tasksUpdated`. A `task` has `{ process, kind, ref, pid?, title, minimized, key }` where `kind` is `native` | `system` | `terminal` | `browser`. Keep this shape stable across both paths.

#### Why `kind` exists (AppleScript path only)

`System Events` reports browser/terminal **tabs** as separate windows. To get one button per real OS window, those apps (`APP_SCRIPTING_SKIP` / `BROWSER_STYLE_APPS` in `lib/applescript.js`) are queried via their **own** AppleScript dictionary instead, yielding `terminal`/`browser` kinds with different `ref` semantics (window id vs. index). The native backend sidesteps this entirely — AX windows are already real OS windows, so everything is `kind: "native"`.

### Stable button ordering

XFCE keeps each window in its slot for its lifetime. `taskOrderByKey` (main.js) assigns a monotonic sequence per `key` on first sight and prunes dead keys, so buttons never reshuffle alphabetically.

### Renderer

`renderer/app.js` is a single IIFE (no framework). It does **incremental DOM reconciliation** against the task payload (reuses buttons by `key`), lazy-loads/caches app icons via `icon:get`, and supports **optimistic active state** (`setOptimisticActive`) so a clicked button highlights instantly. The panel window is `WINDOW_HEIGHT` (600px) tall but only the bottom `PANEL_HEIGHT` (48px) is the bar; the rest is transparent and **click-through**. `setIgnoreMouseEvents(true, { forward: true })` starts click-through and the renderer toggles it via `panel:setMouseIgnore` based on cursor position so clicks pass through the empty area but popups stay interactive.

### Config & persistence

`lib/config.js` reads/writes `~/.config/linbar/config.json` (atomic temp-file rename, in-memory cache). Keys:

| Key | Purpose |
| --- | --- |
| `pinned` | App names pinned to the quick-launch area |
| `drawerView` | `"icons"` or `"list"` |
| `launchAtLogin` | macOS login item via `app.setLoginItemSettings` |
| `hideDockIcon` | Hide LinBar's Dock tile (`app.dock.hide()`); menu-bar icon remains |
| `onboardingComplete` | First-run welcome popup shown once when `false` |

Pins are user-controlled — **nothing is pre-pinned by default**. Clipboard history is in-memory only, never persisted.

### App lifecycle (Phase 6)

- **Single instance:** `app.requestSingleInstanceLock()` — second launch focuses the existing panel.
- **Menu-bar tray:** `build/trayTemplate.png`, context menu with Preferences, Open at Login, Quit.
- **App menu:** LinBar → Preferences… (⌘,), Quit (⌘Q).
- **Preferences window:** `renderer/settings.html` + `settings-preload.js`; IPC `config:get` / `config:set`.
- **First-run onboarding:** popup in `renderer/index.html`; IPC `taskbar:onboarding`, `config:set` on completion.

### Preferences & settings IPC

Panel renderer (`preload.js` → `window.taskbar`): `getConfig`, `setConfig`, `openPreferences`, `openAccessibilitySettings`, `hideDock`, `onOnboarding`.

Settings window (`settings-preload.js` → `window.linbarSettings`): `getConfig`, `setConfig`, `openAccessibilitySettings`, `hideDock`.

## Conventions & gotchas

- **App launching uses `/usr/bin/open -a`**, not AppleScript `activate`, so launching needs no Automation permission. Window *actions* (raise/minimize/close) need Accessibility (native) or Automation (fallback).
- **Icons:** the native helper's `NSWorkspace.icon(forFile:)` gives the real bundle icon; Electron's `getFileIcon` only returns the generic app icon for `.app` paths, so it's a last resort (`iconForBundlePath` in main.js).
- **Packaging:** the helper binary must stay outside `app.asar` — `build.asarUnpack` keeps it in `app.asar.unpacked`, and `lib/helper.js` rewrites the path accordingly. App icon is `build/icon.icns`; tray template is `build/trayTemplate.png` (bundled in asar). Don't break asarUnpack or packaged builds silently fall back to AppleScript.
- **Panel stacking:** the bar uses `alwaysOnTop: true` at the physical screen bottom (`display.bounds`). Do not switch to `workArea` or toggle always-on-top without explicit user testing — prior attempts broke usability.
- **All IPC task inputs are validated** in `main.js` (`validateTask`) — keep that strict; the renderer is the trust boundary.
- When editing `helper/main.swift`, remember to `npm run build:helper` — `npm start` runs the already-compiled binary.
- `plan.md` is a living roadmap/changelog (XFCE-parity goals, phased plan). Check it for intended direction and update its changelog when doing notable work.
