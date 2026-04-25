import CoreGraphics
import Darwin
import Foundation

enum SpaceInspector {
    private typealias MainConnectionFn = @convention(c) () -> UInt32
    private typealias GetActiveSpaceFn = @convention(c) (Int32) -> UInt64
    private typealias CopySpacesForWindowsFn = @convention(c) (Int32, Int32, CFArray) -> CFArray?

    private struct Resolved {
        let main: MainConnectionFn
        let getActiveSpace: GetActiveSpaceFn
        let copySpacesForWindows: CopySpacesForWindowsFn
    }

    private static let resolved: Resolved? = {
        _ = dlopen(
            "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
            RTLD_LAZY
        )
        let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)
        guard
            let main = dlsym(rtldDefault, "SLSMainConnectionID"),
            let active = dlsym(rtldDefault, "SLSGetActiveSpace"),
            let copy = dlsym(rtldDefault, "SLSCopySpacesForWindows")
        else {
            return nil
        }
        return Resolved(
            main: unsafeBitCast(main, to: MainConnectionFn.self),
            getActiveSpace: unsafeBitCast(active, to: GetActiveSpaceFn.self),
            copySpacesForWindows: unsafeBitCast(copy, to: CopySpacesForWindowsFn.self)
        )
    }()

    static func currentSpaceId() -> UInt64? {
        guard let resolved else { return nil }
        return resolved.getActiveSpace(Int32(bitPattern: resolved.main()))
    }

    static func spaceIds(windowId: UInt32) -> [UInt64]? {
        guard let resolved else { return nil }
        let connection = Int32(bitPattern: resolved.main())
        let windows = [NSNumber(value: windowId)] as CFArray
        guard let raw = resolved.copySpacesForWindows(connection, 7, windows) as? [NSNumber] else {
            return nil
        }
        return raw.map { $0.uint64Value }
    }
}
