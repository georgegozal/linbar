// linbar-helper — native window tracker for LinBar.
//
// Speaks newline-delimited JSON:
//   stdout events:  {"type":"status"|"snapshot", ...}
//   stdin commands: {"cmd":"raise"|"minimize"|"close"|"snapshot", "id":<windowID>, "pid":<pid>}
//
// Uses only Apple frameworks (Cocoa + Accessibility). Window data never leaves this
// process except over stdout to the LinBar parent process.

import Cocoa
import ApplicationServices

// Maps an AXUIElement window to its CGWindowID. Private but ABI-stable for many macOS
// releases (used by Hammerspoon, yabai, etc.); the only way to give windows a stable id.
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ wid: UnsafeMutablePointer<CGWindowID>) -> AXError

func emit(_ obj: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(obj),
          let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func axCopy(_ el: AXUIElement, _ attr: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &value) == .success else { return nil }
    return value
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    return axCopy(el, attr) as? String
}

func axBool(_ el: AXUIElement, _ attr: String) -> Bool {
    return (axCopy(el, attr) as? Bool) ?? false
}

func axPoint(_ el: AXUIElement, _ attr: String) -> CGPoint? {
    guard let val = axCopy(el, attr), AXValueGetType(val as! AXValue) == .cgPoint else { return nil }
    var point = CGPoint.zero
    guard AXValueGetValue(val as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

func axSize(_ el: AXUIElement, _ attr: String) -> CGSize? {
    guard let val = axCopy(el, attr), AXValueGetType(val as! AXValue) == .cgSize else { return nil }
    var size = CGSize.zero
    guard AXValueGetValue(val as! AXValue, .cgSize, &size) else { return nil }
    return size
}

func axSetPoint(_ el: AXUIElement, _ attr: String, _ point: CGPoint) {
    var p = point
    guard let val = AXValueCreate(.cgPoint, &p) else { return }
    AXUIElementSetAttributeValue(el, attr as CFString, val)
}

func axSetSize(_ el: AXUIElement, _ attr: String, _ size: CGSize) {
    var s = size
    guard let val = AXValueCreate(.cgSize, &s) else { return }
    AXUIElementSetAttributeValue(el, attr as CFString, val)
}

/// AX window position uses top-left global screen coordinates (Y grows downward).
private struct VisibleAreaTL {
    let top: CGFloat
    let bottom: CGFloat
    let left: CGFloat
    let width: CGFloat
}

private func globalFlipY() -> CGFloat {
    NSScreen.screens.map { $0.frame.maxY }.max() ?? NSScreen.main!.frame.maxY
}

private func visibleAreaTopLeft(on screen: NSScreen) -> VisibleAreaTL {
    let vf = screen.visibleFrame
    let flip = globalFlipY()
    return VisibleAreaTL(
        top: flip - vf.maxY,
        bottom: flip - vf.minY,
        left: vf.minX,
        width: vf.width
    )
}

private func screenForWindow(topLeft pos: CGPoint, size: CGSize) -> NSScreen? {
    let flip = globalFlipY()
    let centerBL = NSPoint(
        x: pos.x + size.width / 2,
        y: flip - (pos.y + size.height / 2)
    )
    return NSScreen.screens.first { $0.frame.contains(centerBL) } ?? NSScreen.main
}

func axWindowID(_ el: AXUIElement) -> CGWindowID? {
    var wid: CGWindowID = 0
    guard _AXUIElementGetWindow(el, &wid) == .success, wid != 0 else { return nil }
    return wid
}

final class TrackedApp {
    let pid: pid_t
    let name: String
    let bundleID: String
    let bundlePath: String
    let axApp: AXUIElement
    var observer: AXObserver?
    var observedWindows: Set<CGWindowID> = []

    init(app: NSRunningApplication) {
        self.pid = app.processIdentifier
        self.name = app.localizedName ?? app.bundleIdentifier ?? "pid \(app.processIdentifier)"
        self.bundleID = app.bundleIdentifier ?? ""
        self.bundlePath = app.bundleURL?.path ?? ""
        self.axApp = AXUIElementCreateApplication(app.processIdentifier)
    }

    func windows() -> [AXUIElement] {
        guard let arr = axCopy(axApp, kAXWindowsAttribute as String) as? [AXUIElement] else { return [] }
        return arr.filter { el in
            guard let role = axString(el, kAXRoleAttribute as String), role == kAXWindowRole as String else { return false }
            let subrole = axString(el, kAXSubroleAttribute as String) ?? ""
            return subrole == kAXStandardWindowSubrole as String || subrole == kAXDialogSubrole as String
        }
    }
}

func pngDataURL(for image: NSImage, size: Int) -> String? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return nil }
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero, operation: .copy, fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
}

let axNotificationCallback: AXObserverCallback = { _, _, notification, refcon in
    guard let refcon = refcon else { return }
    let manager = Unmanaged<Manager>.fromOpaque(refcon).takeUnretainedValue()
    manager.scheduleSnapshot(reason: notification as String)
}

final class Manager {
    static let shared = Manager()
    var apps: [pid_t: TrackedApp] = [:]
    private var pendingEmit: DispatchWorkItem?
    private var pendingReserve: DispatchWorkItem?
    var reservedBottom: CGFloat = 0
    var linbarPid: pid_t = 0
    private var lastAdjusted: [CGWindowID: TimeInterval] = [:]

    private var trustPollTimer: Timer?

    func start() {
        let trusted = AXIsProcessTrusted()
        emit(["type": "status", "trusted": trusted])
        if trusted {
            beginTracking()
            return
        }
        // Stay alive and poll until the user grants Accessibility, then hot-swap
        // to event-driven tracking without requiring an app restart.
        trustPollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] timer in
            guard AXIsProcessTrusted() else { return }
            timer.invalidate()
            self?.trustPollTimer = nil
            emit(["type": "status", "trusted": true])
            self?.beginTracking()
        }
    }

    func beginTracking() {
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            track(app)
        }

        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] note in
            if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
               app.activationPolicy == .regular {
                self?.track(app)
            }
            self?.scheduleSnapshot(reason: "appLaunched")
        }
        nc.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
                self?.untrack(app.processIdentifier)
            }
            self?.scheduleSnapshot(reason: "appTerminated")
        }
        nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            self?.scheduleSnapshot(reason: "appActivated")
        }
        nc.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.scheduleSnapshot(reason: "spaceChanged")
        }

        // Safety net for apps with unreliable AX notifications (some Java/legacy apps).
        Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.scheduleSnapshot(reason: "reconcile")
        }

        scheduleSnapshot(reason: "start")
    }

    func track(_ app: NSRunningApplication) {
        let pid = app.processIdentifier
        guard pid > 0, apps[pid] == nil else { return }
        let tracked = TrackedApp(app: app)
        apps[pid] = tracked

        var observer: AXObserver?
        guard AXObserverCreate(pid, axNotificationCallback, &observer) == .success, let obs = observer else { return }
        tracked.observer = obs
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for note in [kAXWindowCreatedNotification, kAXFocusedWindowChangedNotification] {
            AXObserverAddNotification(obs, tracked.axApp, note as CFString, refcon)
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        observeWindows(of: tracked)
    }

    func untrack(_ pid: pid_t) {
        if let tracked = apps[pid], let obs = tracked.observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        }
        apps.removeValue(forKey: pid)
    }

    /** Register per-window notifications for windows we have not seen yet. */
    func observeWindows(of tracked: TrackedApp) {
        guard let obs = tracked.observer else { return }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        for el in tracked.windows() {
            guard let wid = axWindowID(el), !tracked.observedWindows.contains(wid) else { continue }
            tracked.observedWindows.insert(wid)
            for note in [
                kAXUIElementDestroyedNotification,
                kAXTitleChangedNotification,
                kAXWindowMiniaturizedNotification,
                kAXWindowDeminiaturizedNotification,
                kAXWindowMovedNotification,
                kAXWindowResizedNotification,
            ] {
                AXObserverAddNotification(obs, el, note as CFString, refcon)
            }
        }
    }

    func scheduleSnapshot(reason: String) {
        pendingEmit?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.emitSnapshot(reason: reason)
            self?.scheduleReserveEnforcement()
        }
        pendingEmit = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: work)
    }

    func scheduleReserveEnforcement() {
        guard reservedBottom > 0 else { return }
        pendingReserve?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.enforceReservedSpace() }
        pendingReserve = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: work)
    }

    /// Inset windows that tile to the screen bottom so they stop above the LinBar strip.
    /// macOS has no public API to shrink NSScreen.visibleFrame like the Dock does.
    func enforceReservedSpace() {
        guard reservedBottom > 0 else { return }
        let reserve = reservedBottom
        let now = Date().timeIntervalSince1970

        for (pid, tracked) in apps {
            if pid == linbarPid { continue }
            if tracked.bundleID == "com.linbar.app" { continue }
            for el in tracked.windows() {
                guard let wid = axWindowID(el) else { continue }
                if axBool(el, kAXMinimizedAttribute as String) { continue }
                if let last = lastAdjusted[wid], now - last < 0.35 { continue }

                guard let pos = axPoint(el, kAXPositionAttribute as String),
                      let size = axSize(el, kAXSizeAttribute as String) else { continue }
                if size.width < 120 || size.height < 80 { continue }

                guard let screen = screenForWindow(topLeft: pos, size: size) else { continue }
                let area = visibleAreaTopLeft(on: screen)

                let winBottom = pos.y + size.height
                let allowedBottom = area.bottom - reserve
                let fullWidth = size.width >= area.width - 24
                let touchesBottom = winBottom >= area.bottom - 12
                let encroaches = winBottom > allowedBottom + 1

                guard encroaches || (fullWidth && touchesBottom) else { continue }

                var newPos = pos
                var newSize = size
                if fullWidth && touchesBottom {
                    newPos.x = area.left
                    newSize.width = area.width
                    newPos.y = area.top
                    newSize.height = max(120, allowedBottom - area.top)
                } else if encroaches {
                    newSize.height = max(120, allowedBottom - pos.y)
                } else {
                    continue
                }

                if abs(newPos.x - pos.x) < 1 && abs(newPos.y - pos.y) < 1 &&
                    abs(newSize.width - size.width) < 1 && abs(newSize.height - size.height) < 1 {
                    continue
                }

                axSetSize(el, kAXSizeAttribute as String, newSize)
                axSetPoint(el, kAXPositionAttribute as String, newPos)
                lastAdjusted[wid] = now
            }
        }
    }

    func emitSnapshot(reason: String) {
        var windows: [[String: Any]] = []
        var frontID: CGWindowID? = nil
        var liveWindowIDs: Set<CGWindowID> = []
        let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier

        for (pid, tracked) in apps {
            observeWindows(of: tracked)
            var focusedID: CGWindowID? = nil
            if pid == frontPid, let f = axCopy(tracked.axApp, kAXFocusedWindowAttribute as String) {
                focusedID = axWindowID(f as! AXUIElement)
            }
            for el in tracked.windows() {
                guard let wid = axWindowID(el) else { continue }
                liveWindowIDs.insert(wid)
                var title = axString(el, kAXTitleAttribute as String) ?? ""
                if title.isEmpty { title = tracked.name }
                let minimized = axBool(el, kAXMinimizedAttribute as String)
                let focused = (wid == focusedID)
                if focused { frontID = wid }
                windows.append([
                    "id": Int(wid),
                    "pid": Int(pid),
                    "app": tracked.name,
                    "bundle": tracked.bundleID,
                    "bundlePath": tracked.bundlePath,
                    "title": title,
                    "minimized": minimized,
                    "focused": focused,
                ])
            }
        }

        // Prune bookkeeping for windows that no longer exist so these maps do not
        // grow for the lifetime of the process. Re-registering notifications for a
        // window that reappears is harmless (AX reports "already registered").
        for (_, tracked) in apps {
            tracked.observedWindows.formIntersection(liveWindowIDs)
        }
        lastAdjusted = lastAdjusted.filter { liveWindowIDs.contains($0.key) }

        emit([
            "type": "snapshot",
            "reason": reason,
            "front": frontID.map { Int($0) } as Any,
            "windows": windows,
        ])
    }

    func findWindow(pid: pid_t, id: CGWindowID) -> AXUIElement? {
        guard let tracked = apps[pid] else { return nil }
        for el in tracked.windows() where axWindowID(el) == id {
            return el
        }
        return nil
    }

    func minimizeAllWindows() {
        for (pid, tracked) in apps {
            if pid == linbarPid { continue }
            if tracked.bundleID == "com.linbar.app" { continue }
            for el in tracked.windows() {
                if axBool(el, kAXMinimizedAttribute as String) { continue }
                AXUIElementSetAttributeValue(el, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
            }
        }
        scheduleSnapshot(reason: "minimizeAll")
    }

    func handle(command line: String) {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else { return }

        if cmd == "snapshot" {
            scheduleSnapshot(reason: "request")
            return
        }

        if cmd == "reserve" {
            if let h = obj["height"] as? Double, h > 0 {
                reservedBottom = CGFloat(h)
            } else if let h = obj["height"] as? Int, h > 0 {
                reservedBottom = CGFloat(h)
            } else {
                reservedBottom = 0
            }
            if let p = obj["pid"] as? Int { linbarPid = pid_t(p) }
            else if let p = obj["pid"] as? Double { linbarPid = pid_t(p) }
            scheduleReserveEnforcement()
            return
        }

        if cmd == "minimizeAll" {
            minimizeAllWindows()
            return
        }

        if cmd == "icon" {
            guard let p = obj["path"] as? String else { return }
            // NSWorkspace resolves the bundle's real icon (Electron's getFileIcon
            // only yields the generic application icon for .app bundles).
            let img = NSWorkspace.shared.icon(forFile: p)
            emit(["type": "icon", "path": p, "data": pngDataURL(for: img, size: 96) ?? ""])
            return
        }

        if cmd == "categories" {
            guard let paths = obj["paths"] as? [String] else { return }
            var items: [String: String] = [:]
            for p in paths {
                items[p] = (Bundle(path: p)?.infoDictionary?["LSApplicationCategoryType"] as? String) ?? ""
            }
            emit(["type": "categories", "items": items])
            return
        }

        guard let idNum = obj["id"] as? Int, let pidNum = obj["pid"] as? Int else { return }
        let pid = pid_t(pidNum)
        let wid = CGWindowID(idNum)
        guard let win = findWindow(pid: pid, id: wid) else {
            emit(["type": "error", "cmd": cmd, "id": idNum, "error": "window not found"])
            scheduleSnapshot(reason: "staleCommand")
            return
        }

        switch cmd {
        case "raise":
            if axBool(win, kAXMinimizedAttribute as String) {
                AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
            }
            AXUIElementPerformAction(win, kAXRaiseAction as CFString)
            NSRunningApplication(processIdentifier: pid)?.activate(options: [])
        case "minimize":
            AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
        case "close":
            if let btn = axCopy(win, kAXCloseButtonAttribute as String) {
                AXUIElementPerformAction(btn as! AXUIElement, kAXPressAction as CFString)
            }
        default:
            emit(["type": "error", "cmd": cmd, "error": "unknown command"])
        }
        scheduleSnapshot(reason: cmd)
    }
}

// Read commands off the main thread; exit when the parent closes our stdin.
Thread {
    while let line = readLine(strippingNewline: true) {
        let l = line.trimmingCharacters(in: .whitespaces)
        if l.isEmpty { continue }
        DispatchQueue.main.async { Manager.shared.handle(command: l) }
    }
    DispatchQueue.main.async { exit(0) }
}.start()

Manager.shared.start()
RunLoop.main.run()
