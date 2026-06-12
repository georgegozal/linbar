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

    func start() {
        let trusted = AXIsProcessTrusted()
        emit(["type": "status", "trusted": trusted])
        guard trusted else {
            // Stay alive; parent may re-ask after the user grants Accessibility.
            return
        }

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
            ] {
                AXObserverAddNotification(obs, el, note as CFString, refcon)
            }
        }
    }

    func scheduleSnapshot(reason: String) {
        pendingEmit?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.emitSnapshot(reason: reason) }
        pendingEmit = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: work)
    }

    func emitSnapshot(reason: String) {
        var windows: [[String: Any]] = []
        var frontID: CGWindowID? = nil
        let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier

        for (pid, tracked) in apps {
            observeWindows(of: tracked)
            var focusedID: CGWindowID? = nil
            if pid == frontPid, let f = axCopy(tracked.axApp, kAXFocusedWindowAttribute as String) {
                focusedID = axWindowID(f as! AXUIElement)
            }
            for el in tracked.windows() {
                guard let wid = axWindowID(el) else { continue }
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

    func handle(command line: String) {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else { return }

        if cmd == "snapshot" {
            scheduleSnapshot(reason: "request")
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
