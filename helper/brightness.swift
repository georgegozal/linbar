// linbar-brightness — read/set main display brightness (0.0–1.0 internally, CLI uses 0–100).
import Foundation
import CoreGraphics
import IOKit
import IOKit.graphics

private typealias DSGetBrightnessFn = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
private typealias DSSetBrightnessFn = @convention(c) (UInt32, Float) -> Int32
private typealias CDGetBrightnessFn = @convention(c) (UInt32) -> Double
private typealias CDSetBrightnessFn = @convention(c) (UInt32, Double) -> Void

private var dsGet: DSGetBrightnessFn?
private var dsSet: DSSetBrightnessFn?
private var cdGet: CDGetBrightnessFn?
private var cdSet: CDSetBrightnessFn?

private func loadPrivateApis() {
    if dsGet == nil || dsSet == nil {
        if let handle = dlopen(
            "/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices",
            RTLD_LAZY
        ) {
            dsGet = unsafeBitCast(dlsym(handle, "DisplayServicesGetBrightness"), to: DSGetBrightnessFn?.self)
            dsSet = unsafeBitCast(dlsym(handle, "DisplayServicesSetBrightness"), to: DSSetBrightnessFn?.self)
        }
    }
    if cdGet == nil || cdSet == nil {
        if let handle = dlopen(
            "/System/Library/PrivateFrameworks/CoreDisplay.framework/CoreDisplay",
            RTLD_LAZY
        ) {
            cdGet = unsafeBitCast(dlsym(handle, "CoreDisplay_Display_GetUserBrightness"), to: CDGetBrightnessFn?.self)
            cdSet = unsafeBitCast(dlsym(handle, "CoreDisplay_Display_SetUserBrightness"), to: CDSetBrightnessFn?.self)
        }
    }
}

private func ioService(for display: CGDirectDisplayID) -> io_service_t {
    let vendor = CGDisplayVendorNumber(display)
    let model = CGDisplayModelNumber(display)
    let serial = CGDisplaySerialNumber(display)

    let matching = IOServiceMatching("IODisplayConnect")
    var iter: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iter) == KERN_SUCCESS else {
        return 0
    }
    defer { IOObjectRelease(iter) }

    while true {
        let service = IOIteratorNext(iter)
        if service == 0 { break }
        defer { IOObjectRelease(service) }

        guard let infoUnmanaged = IODisplayCreateInfoDictionary(service, IOOptionBits(kIODisplayNoProductName)) else {
            continue
        }
        let dict = infoUnmanaged.takeRetainedValue() as NSDictionary

        let vendorID = dict[kDisplayVendorID] as? Int ?? 0
        let productID = dict[kDisplayProductID] as? Int ?? 0
        let serialNumber = dict[kDisplaySerialNumber] as? Int ?? 0
        if UInt32(vendorID) == vendor && UInt32(productID) == model && UInt32(serialNumber) == serial {
            IOObjectRetain(service)
            return service
        }
    }
    return 0
}

private func getBrightness(for display: CGDirectDisplayID) -> Float? {
    loadPrivateApis()
    let id = UInt32(display)

    if let getFn = dsGet {
        var value: Float = 0
        if getFn(id, &value) == 0 {
            return max(0, min(1, value))
        }
    }

    if let getFn = cdGet {
        let core = Float(getFn(id))
        if core >= 0 && core <= 1 { return core }
    }

    let service = ioService(for: display)
    guard service != 0 else { return nil }
    defer { IOObjectRelease(service) }

    var value: Float = 0
    let err = IODisplayGetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, &value)
    guard err == KERN_SUCCESS else { return nil }
    return max(0, min(1, value))
}

private func setBrightness(_ value: Float, for display: CGDirectDisplayID) -> Bool {
    loadPrivateApis()
    let clamped = max(0, min(1, value))
    let id = UInt32(display)

    if let setFn = dsSet, setFn(id, clamped) == 0 {
        return true
    }

    if let setFn = cdSet {
        setFn(id, Double(clamped))
        return true
    }

    let service = ioService(for: display)
    guard service != 0 else { return false }
    defer { IOObjectRelease(service) }

    return IODisplaySetFloatParameter(service, 0, kIODisplayBrightnessKey as CFString, clamped) == KERN_SUCCESS
}

private func usage() -> Never {
    fputs("usage: linbar-brightness get | set <0-100>\n", stderr)
    exit(2)
}

let args = CommandLine.arguments
guard args.count >= 2 else { usage() }

let display = CGMainDisplayID()
switch args[1] {
case "get":
    guard let value = getBrightness(for: display) else { exit(1) }
    print(Int((value * 100).rounded()))
case "set":
    guard args.count == 3, let pct = Int(args[2]) else { usage() }
    let level = Float(max(0, min(100, pct))) / 100
    guard setBrightness(level, for: display) else { exit(1) }
    print(max(0, min(100, pct)))
default:
    usage()
}
