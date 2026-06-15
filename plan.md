# LinBar — Road to an XFCE-Quality Taskbar on macOS

Goal: make LinBar feel like the XFCE panel on Linux Mint/Xubuntu — instant window buttons,
zero perceptible lag, rich right-click actions, pinned launchers, tray widgets, and a clock
with calendar — while staying a native-feeling macOS utility.

## 0. Changelog — 2026-06-15

Maintenance pass + launcher/pinning UX:

- **Packaging fix:** added `build.asarUnpack: ["helper/linbar-helper"]`. Without it the
  native helper got packed inside `app.asar` while `lib/helper.js` looks for it under
  `app.asar.unpacked`, so packaged builds silently fell back to AppleScript.
- **Fallback bug:** `isLikelyHelperProcess` no longer drops every process whose name
  contains a `.` — that was hiding real apps like `zoom.us` from the bar.
- **App drawer:** `apps:list` cache now keys on the full set of app paths (not just the
  count), so a same-count install+uninstall reclassifies correctly. Removed a dead
  `c ? "Other" : "Other"` ternary in `categoryGroupFor`.
- **Lifecycle:** the frontmost-poll `setInterval` is tracked and cleared on quit; the
  helper removes its `AXObserver` run-loop source in `untrack`.
- **User-controlled pins:** nothing is pre-pinned anymore. Default pins are empty, the
  hardcoded Safari pin and Documents shortcut are gone, and any app can be pinned/unpinned
  from the drawer via right-click (`apps:contextmenu`) or from its existing right-click
  menus. Existing configs keep their pins — unpin unwanted ones via right-click.
- **Volume wheel sensitivity:** scrolling the speaker icon now accumulates ticks locally
  and updates instantly (5% per notch), debouncing only the slow `setVolume` call, instead
  of dropping ticks while one osascript call was in flight.

## 1. Where we are today

### Architecture
- Electron panel window (frameless, always-on-top, 48px, bottom edge), `main.js`.
- Window discovery via AppleScript (`lib/applescript.js`): one big `System Events` scan
  plus per-app scripting for Terminal and browser-style apps (one button per OS window).
- Main-process scheduler polls every 1.6–4s, pushes snapshots to the renderer over IPC.
- Renderer (`renderer/app.js`) does incremental DOM reconciliation, app icons, right-click
  menu (bring to front / minimize / close), start menu, quick launch, tray buttons, clock.

### The core problem
XFCE's taskbar is **event-driven**: X11/EWMH delivers window open/close/focus/title events
instantly and for free. LinBar instead **polls AppleScript**, and measured logs show
`System Events` scans taking **6–19 seconds** under load. No amount of caching or
scheduling fixes that ceiling — polling osascript can never feel like XFCE.

### Uncommitted work in progress
- `lib/lsappinfo.js` (new): fast app discovery via `lsappinfo` (~20ms vs ~600ms+ per
  osascript call) for the visible-app list and frontmost app.
- `lib/applescript.js`: osascript timeout (default 10s, kills hung scripts) and a queue
  that serializes `System Events` scripts — concurrent SE scripts are what stacked up
  to the 19s scans.
- These need to be wired in (replace `getRunningApplicationProcessNames` /
  `getFrontmostProcessName` with the lsappinfo versions) and committed.

## 2. Strategy

Two tracks:

- **Track A — squeeze the current stack** (days): wire in `lsappinfo`, cut osascript
  count, make the UI feel instant with optimistic updates. Gets refresh latency from
  "seconds, sometimes frozen" to "sub-second, reliable".
- **Track B — native event-driven helper** (the real fix, ~1–2 weeks): a small Swift
  helper streaming window events. This is what makes LinBar actually XFCE-smooth.
  Everything in Track A remains useful as a fallback path.

---

## 3. Track A: make the current stack fast (Phase 1)

1. **Wire in `lsappinfo`** (work already started):
   - `getVisibleAppNames()` replaces the `System Events` "running processes" scan.
   - `getFrontmostAppName()` replaces `getFrontmostProcessName()`.
   - Effect: removes 2 of the 3+ SE scripts per refresh cycle.
2. **One `System Events` script per refresh, serialized**: only the window-title scan
   remains on SE; pass the lsappinfo app list into it so it never iterates background
   processes. Keep the new timeout + serialization queue.
3. **Decouple "frontmost" from "full list"**: poll frontmost (cheap, lsappinfo) every
   ~500ms; full window list every ~3s or on demand. Active-button highlight then tracks
   focus changes near-instantly even between full scans.
4. **Optimistic UI**: when a task button is clicked, mark it active immediately in the
   renderer and trigger a frontmost re-check; don't wait for the next full snapshot.
5. **Commit** the outstanding hotfix work as 2–3 scoped commits (lsappinfo helper,
   SE serialization/timeout, frontmost fast-path).

Acceptance: refresh `parts` timings consistently < 1s; active highlight follows
Cmd+Tab within ~500ms; no scan ever blocks the UI for seconds.

## 4. Track B: native event-driven core (Phase 2) — the cornerstone

Build a small **Swift helper binary** (`helper/linbar-helper`), spawned by the Electron
main process, that streams newline-delimited JSON events over stdout:

- **Enumeration**: `CGWindowListCopyWindowInfo` — full window list (id, pid, title,
  bounds, layer) in single-digit milliseconds, no AppleScript at all.
- **Events instead of polling**:
  - `NSWorkspace` notifications: app launched / terminated / activated (free, no perms).
  - `AXObserver` per app: window created / destroyed / focused / title changed /
    miniaturized (needs the Accessibility permission LinBar already requests).
- **Actions** (JSON commands on stdin): raise, minimize, close a window via
  `AXUIElement` — replaces all activation AppleScript, works uniformly for every app
  (no more special-casing Terminal/browsers, since AX windows are real OS windows —
  the whole tabs-vs-windows problem disappears).
- **Permissions**: Accessibility (already required today); window titles via CGWindowList
  additionally want Screen Recording on newer macOS — fall back to AX titles if denied.

Electron side: replace the scheduler's snapshot polling with the helper's event stream;
keep the AppleScript path only as a fallback when the helper is missing or perms denied.

Acceptance: window open/close/focus reflected on the bar in **< 100ms**, idle CPU near
zero (no periodic scans at all).

## 5. Phase 3: XFCE window-button parity

With cheap, correct window data, implement classic XFCE taskbar behavior:

- **Click semantics**: click focuses; **click the active button again → minimize**
  (signature XFCE behavior); **middle-click → close** (make it configurable).
- **Minimized state**: show minimized windows with a dimmed/italic style (XFCE shows
  them in brackets); clicking restores.
- **Urgency / attention**: flash a button when its app bounces in the Dock /
  requests attention (`NSWorkspace` + AX notifications).
- **Grouping option**: settings toggle — never group (current), group per app with a
  popup window list, or group when the bar is full.
- **Drag-to-reorder** buttons; remember order per app.
- **Hover tooltips with live previews**: window thumbnail via ScreenCaptureKit
  (graceful fallback to title-only tooltip without the permission).
- **Window list sorting**: stable insertion order (XFCE default), not alphabetical churn.

## 6. Phase 4: panel features

- **Pinned launchers**: pin any running app from the right-click menu; pinned apps show
  as launcher buttons when not running (XFCE "Launcher" plugin behavior). Persist in a
  JSON config (`~/.config/linbar/config.json`).
- **Show-desktop button** at the far right (AX-minimize all / Mission Control F11 key event).
- **Clock → calendar popup** on click (Orage-style month view).
- **Volume**: scroll on the tray icon to change volume, click for mute, slider popup.
- **Battery / network indicators** (read via `pmset -g batt` and `scutil`/`networksetup`).
- **Workspaces (Spaces) pager** — *stretch goal*: macOS has no public API; options are
  skip it, integrate with yabai if installed, or use private CGS calls (fragile). Ship
  current-Space awareness first (helper can detect Space changes via
  `NSWorkspace.activeSpaceDidChangeNotification`).
- **Panel options**: autohide (slide down, reveal on edge hover), opacity, height,
  top/bottom position, per-display panels (multi-monitor).
- **Settings UI**: small preferences window writing the JSON config; live-applies.

## 7. Phase 5: look, feel, and shipping polish

- **Theming**: XFCE-accurate default theme (Greybird-like), plus Mint-Y and a native
  macOS vibrancy theme; CSS variables, theme switch in settings.
- **Animations**: 120ms ease-out for button add/remove/active-state; no layout jank
  (buttons already equal-width — keep `min-width` collapse for crowded bars).
- **Dock coexistence**: document/automate `defaults write com.apple.dock autohide`
  prompt on first run (macOS can't reserve screen space for third-party panels).
- **App lifecycle**: launch at login (`app.setLoginItemSettings`), single-instance lock,
  menu-bar item to quit/show settings (since the panel has no window chrome).
- **Packaging**: sign + notarize the helper and app (hardened runtime), dmg via
  electron-builder; helper bundled in `Resources`.
- **Diagnostics**: keep `LINBAR_DEBUG_TASKS=1`; add a status row in settings showing
  permission states (Accessibility / Screen Recording / Automation) with deep links.

## 8. Suggested commit sequence

1. `perf:` wire lsappinfo into app discovery + frontmost detection
2. `perf:` serialize System Events scripts and add osascript timeouts (already coded)
3. `perf:` split fast frontmost poll from full window scan
4. `feat:` optimistic active state on click
5. `feat:` Swift helper — enumeration + actions (CGWindowList + AX)
6. `feat:` Swift helper — event stream (NSWorkspace + AXObserver), drop polling
7. `feat:` XFCE click semantics (minimize on active click, middle-click close)
8. `feat:` minimized styling + urgency flash
9. `feat:` pinned launchers + config file
10. `feat:` calendar popup, volume slider, battery/network tray
11. `feat:` autohide, multi-monitor, settings UI
12. `style:` Greybird theme + animations
13. `chore:` packaging, signing, login item

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Screen Recording permission for CGWindowList titles | Fall back to AX titles; clearly guide the user |
| AXObserver quirks for some apps (Electron apps, Java) | Keep periodic cheap reconciliation scan (e.g. every 30s) as safety net |
| Spaces have no public API | Ship without pager; current-Space detection only |
| Helper adds a build toolchain (Xcode CLT) | Prebuild universal binary, commit it or fetch on `npm install` |
| macOS can't reserve panel space | Dock autohide guidance; accept overlay model |
