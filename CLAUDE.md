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

2. **AppleScript fallback (slow, polling)** — `lib/applescript.js`. Used when the helper binary is missing, Accessibility is denied (for **window tracking**), or the helper exits. The helper process may still run to serve **icons and app categories** even when AX is off. Polls via `osascript`/`System Events` on a self-adjusting timer (`TASK_REFRESH_ACTIVE_MS`/`IDLE_MS`), plus a fast `lsappinfo` frontmost poll (`lib/lsappinfo.js`, ~20ms) for the active highlight between full scans. `System Events` scans can take **seconds under load** — this is the known performance ceiling that the native helper exists to fix.

**Both backends produce the same task payload** (`{ tasks, front, error, meta }`) which `emitTaskPayload` sends to the renderer over `taskbar:tasksUpdated`. A `task` has `{ process, kind, ref, pid?, title, minimized, key }` where `kind` is `native` | `system` | `terminal` | `browser`. Keep this shape stable across both paths.

#### Why `kind` exists (AppleScript path only)

`System Events` reports browser/terminal **tabs** as separate windows. To get one button per real OS window, those apps (`APP_SCRIPTING_SKIP` / `BROWSER_STYLE_APPS` in `lib/applescript.js`) are queried via their **own** AppleScript dictionary instead, yielding `terminal`/`browser` kinds with different `ref` semantics (window id vs. index). The native backend sidesteps this entirely — AX windows are already real OS windows, so everything is `kind: "native"`.

### Stable button ordering

XFCE keeps each window in its slot for its lifetime. `taskOrderByKey` (main.js) assigns a monotonic sequence per `key` on first sight and prunes dead keys, so buttons never reshuffle alphabetically.

### Renderer

`renderer/app.js` is a single IIFE (no framework). It does **incremental DOM reconciliation** against the task payload (reuses buttons by `key`), lazy-loads/caches app icons via `icon:get`, and supports **optimistic active state** (`setOptimisticActive`) so a clicked button highlights instantly. Clock display uses `renderer/clock-format.js` + config keys (`clockShowDate`, `clockHour12`, `clockDateFormat`); updates live on `taskbar:configUpdated`. The panel window is `WINDOW_HEIGHT` (600px) tall but only the bottom `PANEL_HEIGHT` (48px) is the bar; the rest is transparent and **click-through**. `setIgnoreMouseEvents(true, { forward: true })` starts click-through and the renderer toggles it via `panel:setMouseIgnore` based on cursor position so clicks pass through the empty area but popups stay interactive.

### Config & persistence

`lib/config.js` reads/writes `~/.config/linbar/config.json` (atomic temp-file rename, in-memory cache). Keys:

| Key | Purpose |
| --- | --- |
| `pinned` | App names pinned to the quick-launch area |
| `drawerView` | `"icons"` or `"list"` |
| `launchAtLogin` | macOS login item via `app.setLoginItemSettings` |
| `hideDockIcon` | Hide LinBar's Dock tile (`app.dock.hide()`); menu-bar icon remains |
| `onboardingComplete` | First-run welcome popup shown once when `false` |
| `reserveScreenSpace` | Native helper insets tiled windows by 48px at the bottom (Dock-like) |
| `clockShowDate` | Show date under the time on the bar (default `false`) |
| `clockHour12` | 12-hour clock when `true`; 24-hour when `false` (default) |
| `clockDateFormat` | `long`, `medium`, `short`, `iso`, `weekdayDate`, or day-first `dmy*` variants — see `lib/config.js` |

Pins are user-controlled — **nothing is pre-pinned by default**. Clipboard history is in-memory only, never persisted.

### Dock-like screen space (native helper)

macOS only shrinks the global work area for the **stock Dock** — not third-party panels.
LinBar works around this:

1. **Panel anchor:** `panelBoundsForDisplay()` uses `display.workArea` so the bar sits on
   the same bottom edge apps use (eliminates the Dock-sized gap when the Dock is visible).
2. **Window inset:** helper command `reserve` (`lib/helper.js` → `setReserve(height, pid)`)
   runs `enforceReservedSpace()` — for full-width windows tiled to the screen bottom, sets
   AX size/position so the window bottom stops `PANEL_HEIGHT` px above the work-area bottom.
3. **Coordinates:** AX window position is **top-left** global (Y down). Always convert
   `NSScreen.visibleFrame` (bottom-left) before reading or writing AX position/size.

Toggle via `reserveScreenSpace` in config / Preferences. Rebuild helper after editing
`helper/main.swift` (`npm run build:helper`).

### App lifecycle (Phase 6)

- **Single instance:** `app.requestSingleInstanceLock()` — second launch focuses the existing panel.
- **Menu-bar tray:** `build/trayTemplate.png`, context menu with Preferences, Open at Login, Quit.
- **App menu:** LinBar → Preferences… (⌘,), Quit (⌘Q).
- **Preferences window:** `renderer/settings.html` + `settings-preload.js`; IPC `config:get` / `config:set`. Clock section uses `renderer/clock-format.js` for live preview.
- **Show desktop:** `desktop:minimizeAll` IPC; native helper `minimizeAll` command or AppleScript per-task fallback.
- **First-run onboarding:** popup in `renderer/index.html`; IPC `taskbar:onboarding`, `config:set` on completion.

### Preferences & settings IPC

Panel renderer (`preload.js` → `window.taskbar`): `getConfig`, `setConfig`, `onConfigUpdated`, `openPreferences`, `showDesktop`, `openAccessibilitySettings`, `hideDock`, `onOnboarding`.

Settings window (`settings-preload.js` → `window.linbarSettings`): `getConfig`, `setConfig`, `openAccessibilitySettings`, `hideDock`.

## Conventions & gotchas

- **App launching uses `/usr/bin/open -a`**, not AppleScript `activate`, so launching needs no Automation permission. Window *actions* (raise/minimize/close) need Accessibility (native) or Automation (fallback).
- **Icons:** the native helper's `NSWorkspace.icon(forFile:)` gives the real bundle icon; `iconForBundlePath` in `main.js` falls back to reading the bundle's `.icns`, then Electron's `getFileIcon` (generic for `.app` paths). The helper stays running for icon requests even when Accessibility is denied (window tracking then uses AppleScript).
- **Packaging:** the helper binary must stay outside `app.asar` — `build.asarUnpack` keeps it in `app.asar.unpacked`, and `lib/helper.js` resolves it via `process.resourcesPath` when packaged. App icon is `build/icon.icns`; tray template is `build/trayTemplate.png` (bundled in asar). Don't break asarUnpack or packaged builds silently fall back to AppleScript.
- **Installed app permissions:** grant **LinBar** (not Terminal/Electron) in Accessibility; quit and reopen after granting. Required for window list, minimize, and show-desktop.
- **Panel placement:** always-on-top at the **work-area** bottom (`display.workArea`), not `display.bounds`. Do not toggle always-on-top off without careful testing.
- **Screen reservation:** only the native helper insets other apps' windows; never mix AppKit bottom-left frame values with AX top-left position — that reserves space at the wrong edge.
- **All IPC task inputs are validated** in `main.js` (`validateTask`) — keep that strict; the renderer is the trust boundary.
- When editing `helper/main.swift`, remember to `npm run build:helper` — `npm start` runs the already-compiled binary.
- `plan.md` is a living roadmap/changelog (XFCE-parity goals, phased plan). Check it for intended direction and update its changelog when doing notable work.
