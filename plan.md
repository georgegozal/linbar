# LinBar — Road to an XFCE-Quality Taskbar on macOS

Goal: make LinBar feel like the XFCE panel on Linux Mint/Xubuntu — instant window buttons,
zero perceptible lag, rich right-click actions, pinned launchers, tray widgets, and a clock
with calendar — while staying a native-feeling macOS utility.

## 0. Changelog

### 2026-06-16 — clock preferences & show desktop

- **Show desktop:** button after the clock minimizes all open windows (native helper
  `minimizeAll` or AppleScript fallback); task buttons stay on the bar, dimmed.
- **Clock defaults:** time only on the bar (date hidden); 24-hour format.
- **Preferences → Clock:** show date, 12/24-hour time, date format presets (month-first,
  day-first DMY, ISO). Live preview; changes apply immediately via `taskbar:configUpdated`.
- **Shared formatter:** `renderer/clock-format.js` used by the panel and preferences window.
- **Config keys added:** `clockShowDate`, `clockHour12`, `clockDateFormat`.

### 2026-06-16 — Dock-like screen space reservation

macOS has no public API for third-party panels to shrink `NSScreen.visibleFrame` the way
the Dock does. LinBar now approximates Dock behavior in two parts:

- **Panel placement:** Electron positions the bar at the bottom of `display.workArea` (not
  the physical screen edge), so it aligns with where apps tile when the stock Dock is visible.
- **Native helper inset:** `helper/main.swift` command `{"cmd":"reserve","height":48}` tells
  the helper to shrink tiled/maximized windows by `PANEL_HEIGHT` at the **bottom** of the
  work area. Config key `reserveScreenSpace` (default `true`); toggle in Preferences.
- **Coordinate fix:** AX `kAXPositionAttribute` uses **top-left** global coordinates; the
  first implementation mistakenly used AppKit bottom-left `visibleFrame` values, which
  reserved space under the menu bar instead of above LinBar.

Requires the native helper + Accessibility. AppleScript fallback does not inset windows.

### 2026-06-16 — Phase 6 installable app (shipped)

- **Build:** `npm run dist` / `npm run dist:dir`, custom `build/icon.icns`, tray template PNG.
- **Lifecycle:** single-instance lock, launch-at-login + hide-Dock-tile via config, menu-bar icon
  (Preferences, Open at Login, Quit), macOS app menu with Preferences.
- **Preferences window:** minimal v1 (`renderer/settings.html`) — login item, hide Dock tile,
  Accessibility deep link.
- **First-run onboarding:** popup above the bar (Accessibility, hide macOS Dock, login item).
- **Config keys added:** `launchAtLogin`, `hideDockIcon`, `onboardingComplete`.
- **README:** install-from-DMG instructions.

Still open within Phase 6: signed/notarized DMG for public distribution, Homebrew cask.

### 2026-06-16 — installability & settings planning

Roadmap refresh after a full codebase audit. The old plan still described an AppleScript-only
polling stack and uncommitted `lsappinfo` work — both are now shipped. New focus: **make
LinBar a normal macOS app** (install to `/Applications`, launch from Spotlight/Launchpad)
and **add a settings surface** before piling on more panel features.

### 2026-06-15 — maintenance pass + launcher/pinning UX

- **Packaging fix:** added `build.asarUnpack: ["helper/linbar-helper"]`. Without it the
  native helper got packed inside `app.asar` while `lib/helper.js` looks for it under
  `app.asar.unpacked`, so packaged builds silently fell back to AppleScript.
- **Fallback bug:** `isLikelyHelperProcess` no longer drops every process whose name
  contains a `.` — that was hiding real apps like `zoom.us` from the bar.
- **App drawer:** `apps:list` cache now keys on the full set of app paths (not just the
  count), so a same-count install+uninstall reclassifies correctly.
- **Lifecycle:** the frontmost-poll `setInterval` is tracked and cleared on quit; the
  helper removes its `AXObserver` run-loop source in `untrack`.
- **User-controlled pins:** nothing is pre-pinned anymore. Pins persist in config and can
  be toggled from right-click menus.
- **Volume wheel sensitivity:** scrolling the speaker icon accumulates ticks locally and
  updates instantly (5% per notch), debouncing only the slow `setVolume` call.

---

## 1. Where we are today (2026-06-16 audit)

### Architecture — **done, dual-backend**

| Layer | Status | Notes |
| --- | --- | --- |
| Electron panel | ✅ | Always-on-top; anchored to `workArea` bottom; 48px bar + click-through popup zone |
| Native helper (`helper/linbar-helper`) | ✅ primary | Swift, NDJSON stdio, AXObserver + NSWorkspace; optional bottom space reservation |
| AppleScript fallback (`lib/applescript.js`) | ✅ fallback | Used when helper missing or Accessibility denied; still slow under load |
| Fast frontmost poll (`lib/lsappinfo.js`) | ✅ | ~20ms; used on fallback path between full scans |
| Config (`lib/config.js`) | ✅ | `~/.config/linbar/config.json` — pins, drawer view, login item, dock tile, onboarding |
| Packaging (`electron-builder`) | ✅ basic | `npm run dist` / `dist:dir`; custom icon; helper asar-unpacked |

### Features — **mostly Phase 3–4 complete**

| Feature | Status |
| --- | --- |
| One button per OS window | ✅ native path; AppleScript special-cases Terminal/browsers |
| Stable button ordering (`taskOrderByKey`) | ✅ |
| XFCE click semantics (active→minimize, middle-click close) | ✅ |
| Minimized window styling | ✅ |
| Optimistic active highlight on click | ✅ |
| Right-click window menu (restore/minimize/close/pin) | ✅ |
| Pinned launchers + config persistence | ✅ |
| Searchable app drawer (categories, icons/list view, profile, power menu) | ✅ |
| Clock + calendar popup | ✅ configurable in Preferences (time/date format) |
| Volume (scroll, mute, slider popup) | ✅ |
| Battery indicator + charging bolt | ✅ |
| Clipboard history popup | ✅ (in-memory only) |
| App icons from native helper | ✅ |
| Launch at login | ✅ |
| Single-instance lock | ✅ |
| Menu-bar / tray icon to quit or open settings | ✅ |
| LinBar settings / preferences UI | ✅ v1 — general, clock, permissions |
| Installable `.app` + DMG workflow | ✅ basic |
| Code signing / notarization | ❌ |
| Custom app icon | ✅ |
| First-run onboarding | ✅ |
| Dock-like bottom space reservation | ✅ native helper; `reserveScreenSpace` config |
| Window grouping, urgency flash, drag-reorder | ❌ |
| Network tray, Spaces pager | ❌ |
| Autohide, multi-monitor, theming | ❌ |
| Show-desktop button (minimize all) | ✅ after clock |

### Installability — **Phase 6 basics shipped**

`npm run dist` produces a DMG/zip; drag `LinBar.app` to `/Applications`. Menu-bar icon,
Preferences, login item, and onboarding are in place. Code signing/notarization remain
for public distribution.

**Dock coexistence:** hide the stock Dock for the cleanest panel experience. With
`reserveScreenSpace` enabled (default), tiled windows stop above LinBar; the helper does
not modify `NSScreen.visibleFrame` itself — it adjusts individual window frames via AX.

**What "installable" means:**

1. `npm run dist` produces `dist/LinBar-x.y.z.dmg` (or `.zip`).
2. User drags LinBar to `/Applications` (or an optional install script).
3. LinBar appears in **Launchpad**, **Spotlight**, and **Applications** like any other app.
4. First launch from `/Applications` prompts for **Accessibility** on `LinBar.app` (not the
   terminal) — document this clearly.
5. Optional: "Open at login" toggle (via `app.setLoginItemSettings`).
6. Optional later: Homebrew cask for one-command install.

### Settings — **v1 shipped; clock added**

Preferences (`renderer/settings.html`) covers login item, Dock tile, screen reservation,
and **clock** (show date, 12/24-hour, date format with month-first / day-first presets).
Changes broadcast to the panel via `taskbar:configUpdated`.

---

## 2. Next priority: installable app (Phase 6)

Make LinBar behave like a shipped macOS utility before adding more panel features.

### 6.1 Packaging & distribution

1. **Build scripts**
   - Add `"dist": "electron-builder"` (and optionally `"dist:dir": "electron-builder --dir"`).
   - Keep `"pack"` as alias for unpacked dev testing.
2. **App icon**
   - Add `build/icon.icns` (512×512 source PNG → `.icns`).
   - Set `build.mac.icon` in `package.json`.
3. **Bundle metadata**
   - `productName`, `appId` (`com.linbar.app`) — already set.
   - Consider `LSUIElement: true` in `Info.plist` extras — hides Dock icon since LinBar
     *is* the bar; pair with a menu-bar icon so users can quit. Decide early; XFCE panels
     don't have a Dock tile either.
4. **Helper in packaged builds**
   - `asarUnpack` for `helper/linbar-helper` — already correct; verify after every dist build.
5. **Install instructions** (README)
   - Build → open DMG → drag to Applications → grant Accessibility → optionally enable
     login item + hide Dock.
6. **Signing / notarization** (when distributing beyond yourself)
   - Apple Developer ID, hardened runtime, staple notarization ticket.
   - Sign the embedded helper binary too.
   - Until signed: document right-click → Open for first launch.

### 6.2 App lifecycle (required for a good installed experience)

1. **Single-instance lock** — `app.requestSingleInstanceLock()`. Second launch focuses the
   existing panel instead of spawning a duplicate bar.
2. **Launch at login** — `app.setLoginItemSettings({ openAtLogin })` backed by config.
3. **Quit / relaunch surface** — since the panel has no title bar:
   - macOS app menu: add **Preferences…**, **Quit LinBar** (currently only Quit).
   - Menu-bar status item (recommended): LinBar icon → Preferences, Launch at Login ✓,
     Quit. This is how most "always-on" Mac utilities work.
4. **First-run onboarding** (small modal or popup above the bar):
   - Grant Accessibility (deep link to System Settings).
   - Optional: "Hide the Dock?" with one-click `defaults write com.apple.dock autohide -bool true`.
   - Optional: "Start LinBar at login?" toggle.

### Acceptance

- `npm run dist` produces a DMG; drag-install to `/Applications` works.
- Launching from Applications shows the bar within 2s; helper connects; no terminal needed.
- Only one instance runs; login item toggle persists across restarts.
- User can quit without Force Quit.

---

## 3. Next priority: settings & preferences (Phase 7)

Start with a **small, useful v1** — not a full XFCE panel-properties clone. Extend
`lib/config.js` schema; all new keys get defaults so old configs keep working.

### 3.1 Settings UI — where to put it (pick one for v1)

| Option | Pros | Cons |
| --- | --- | --- |
| **A. macOS app menu → Preferences…** | Standard, zero bar clutter | Separate window |
| **B. Menu-bar icon → Preferences** | Always reachable | Extra UI to build |
| **C. App drawer → Settings entry** | Matches Linux "Settings" in menu | Hidden inside drawer |
| **D. Right-click empty bar area** | Fast for power users | Undiscoverable |

**Recommendation:** A + B together — app menu for discoverability, menu-bar icon for
day-to-day control (quit, login item, preferences).

Implementation: a small `BrowserWindow` (400×500, non-resizable) loading
`renderer/settings.html` + `renderer/settings.js`. IPC: `config:get`, `config:set`,
`config:reset`. Changes apply live via existing `loadConfig()` call sites + a
`config:changed` broadcast to the panel renderer.

### 3.2 Settings v1 — concrete keys worth adding now

These map directly to behavior that already exists (hardcoded or env-var-only):

| Key | Type | Default | Why now |
| --- | --- | --- | --- |
| `launchAtLogin` | bool | `false` | Installable-app must-have |
| `hideDockIcon` | bool | `true` | Panel apps shouldn't duplicate Dock presence |
| `drawerView` | `"icons"`\|`"list"` | `"icons"` | Already persisted; expose in UI |
| `showBattery` | bool | `true` | Tray widget toggle |
| `showVolume` | bool | `true` | Tray widget toggle |
| `showClipboard` | bool | `true` | Tray widget toggle |
| `clickActiveMinimizes` | bool | `true` | XFCE signature; some users hate it |
| `middleClickCloses` | bool | `true` | Same |
| `volumeScrollStep` | number | `5` | Currently hardcoded 5% per notch |
| `onboardingComplete` | bool | `false` | First-run wizard state |
| `reserveScreenSpace` | bool | `true` | ✅ Shipped — native helper bottom inset |
| `clockShowDate` | bool | `false` | ✅ Shipped — date line under time on bar |
| `clockHour12` | bool | `false` | ✅ Shipped — `false` = 24h, `true` = 12h |
| `clockDateFormat` | string | `"long"` | ✅ Shipped — see `CLOCK_DATE_FORMATS` in `lib/config.js` |

### 3.3 Settings v2 — panel layout (after v1 ships)

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `panelHeight` | number | `48` | Requires CSS + window resize logic |
| `panelPosition` | `"bottom"`\|`"top"` | `"bottom"` | Flip anchor in `positionPanelWindow` |
| `panelOpacity` | number | `1.0` | CSS `--panel-opacity` |
| `autohide` | bool | `false` | Slide off-screen; reveal on edge hover |
| `autohideDelayMs` | number | `300` | |
| `theme` | string | `"greybird"` | Needs theme system first |
| `windowGrouping` | `"never"`\|`"always"`\|`"when-full"` | `"never"` | Major task-list change |
| `currentSpaceOnly` | bool | `false` | Maps to existing env var behavior |
| `clipboardHistorySize` | number | `20` | Currently unbounded in memory |
| `showDesktopButton` | bool | `true` | ✅ Shipped (always on bar); no toggle yet |

### 3.4 Settings v3 — diagnostics & advanced

| Key | Type | Notes |
| --- | --- | --- |
| `backend` | `"auto"`\|`"native"`\|`"applescript"` | Maps to `LINBAR_FORCE_APPLESCRIPT` |
| `debugTasks` | bool | Maps to `LINBAR_DEBUG_TASKS` (dev only?) |
| Permission status rows | read-only | Accessibility, Automation, Screen Recording — deep links |
| `configPath` | read-only | Show `~/.config/linbar/config.json` + Reveal in Finder |
| Export / import config | action | For backup or sharing dotfiles |

### 3.5 Not settings (keep out of v1)

- Per-app pin order (drag-reorder pins) — separate UX, not a toggle.
- Network indicator — feature doesn't exist yet.
- Spaces pager — no API; don't expose a broken toggle.
- Individual app exclusions — powerful but complex; defer.

---

## 4. Completed work (historical — Tracks A & B, Phases 3–5 partial)

<details>
<summary>Track A — AppleScript performance (done)</summary>

- `lsappinfo` wired for frontmost detection
- System Events serialization + osascript timeouts
- Fast frontmost poll decoupled from full window scan
- Optimistic UI on click
- Task-list caching, stale snapshot fallback, incremental DOM reconciliation

</details>

<details>
<summary>Track B — native helper (done)</summary>

- `helper/main.swift` compiled on `npm install`
- NDJSON event stream; raise/minimize/close via AX
- Hot-swap to AppleScript fallback on helper exit or missing binary
- Real app icons via `NSWorkspace.icon(forFile:)`

</details>

<details>
<summary>Phase 3 — XFCE window buttons (partial)</summary>

- ✅ Click/minimize/middle-close, minimized styling, stable order, optimistic highlight
- ❌ Urgency flash, grouping, drag-reorder, hover previews

</details>

<details>
<summary>Phase 4 — panel features (partial)</summary>

- ✅ Pins, calendar, volume, battery, clipboard, app drawer
- ❌ Show-desktop, network, Spaces pager, autohide, settings UI

</details>

---

## 5. Future work (after install + settings)

### Phase 8 — remaining XFCE parity

- Urgency / attention flash on Dock bounce
- Window grouping (never / per-app / when-full)
- Drag-to-reorder task buttons; persist order in config
- Hover tooltips with ScreenCaptureKit thumbnails (fallback to title)
- Show-desktop button

### Phase 9 — panel layout & polish

- Autohide (slide down, edge reveal)
- Top/bottom position, height, opacity
- Multi-monitor: panel per display or follow primary
- Greybird / Mint-Y / native vibrancy themes
- Spaces: current-Space awareness via helper; pager as stretch goal

### Phase 10 — distribution hardening

- Universal binary helper (`arm64` + `x86_64`)
- CI build + signed/notarized DMG
- Homebrew cask (`brew install --cask linbar`)
- Auto-update (electron-updater) — only if distributing publicly

---

## 6. Suggested commit sequence (from here)

**Installable app (do first):**

1. `chore:` add app icon asset and `npm run dist` script
2. `feat:` single-instance lock and improved app menu (Preferences placeholder, Quit)
3. `feat:` menu-bar status item with quit and launch-at-login toggle
4. `feat:` first-run onboarding (Accessibility prompt, optional Dock hide)
5. `docs:` install-from-DMG instructions and permission guide for packaged app

**Settings v1 (do second):**

6. `feat:` extend config schema with v1 settings keys + validation
7. `feat:` preferences window (IPC + live apply for tray toggles and click behavior)
8. `feat:` wire launch-at-login and onboarding flags to config
9. `feat:` diagnostics section in preferences (permission status, config path)

**Then resume feature work:**

10. `feat:` urgency flash on attention requests
11. `feat:` window grouping option
12. `feat:` autohide + panel position/height settings (needs v2 config keys)
13. `style:` Greybird theme + CSS variable theming
14. `chore:` code signing, notarization, Homebrew cask

---

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Accessibility prompt differs for packaged vs dev build | First-run onboarding; README callout; bundle ID stable (`com.linbar.app`) |
| Unsigned builds blocked by Gatekeeper | Document right-click Open; sign when distributing |
| Helper missing in packaged app | CI check: assert `app.asar.unpacked/helper/linbar-helper` exists post-build |
| `LSUIElement` hides Dock icon — user can't find app | Menu-bar icon + app menu Quit; don't enable until menu-bar exists |
| Settings scope creep | Ship v1 with ~10 toggles; defer layout/theme to v2 |
| Screen Recording for window titles | Fall back to AX titles; show status in diagnostics |
| macOS can't reserve panel space | Dock autohide prompt; accept overlay model |
| Spaces have no public API | Ship without pager; optional yabai integration later |
