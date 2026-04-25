import AppKit
import CoreGraphics
import Foundation

private var _stopRequested = false
private let _stopLock = NSLock()

enum InputSimulator {
    static var stopRequested: Bool {
        get { _stopLock.lock(); defer { _stopLock.unlock() }; return _stopRequested }
        set { _stopLock.lock(); _stopRequested = newValue; _stopLock.unlock() }
    }

    // MARK: - Click

    static func click(
        x: Double,
        y: Double,
        button: String = "left",
        pid: Int32? = nil,
        windowId: UInt32? = nil,
        modifiers: [String] = []
    ) throws {
        let point = CGPoint(x: x, y: y)
        if let pid, shouldUsePidMousePath(pid: pid) {
            if try clickViaPid(
                point: point,
                pid: pid,
                windowId: windowId,
                button: button,
                modifiers: modifiers
            ) {
                return
            }
        }

        let flags = modifierFlags(from: modifiers)
        let moveButton = cgMouseButton(for: button)
        VirtualCursor.shared.move(to: point, animated: false)
        postMouseEvent(.mouseMoved, at: point, button: moveButton, clickCount: 0, flags: flags)
        usleep(30_000)

        VirtualCursor.shared.setPressed(true)
        defer { VirtualCursor.shared.setPressed(false) }

        switch button {
        case "right":
            postMouseEvent(.rightMouseDown, at: point, button: .right, flags: flags)
            usleep(50_000)
            postMouseEvent(.rightMouseUp, at: point, button: .right, flags: flags)

        case "middle":
            postMouseEvent(.otherMouseDown, at: point, button: .center, flags: flags)
            usleep(50_000)
            postMouseEvent(.otherMouseUp, at: point, button: .center, flags: flags)

        case "double":
            postMouseEvent(.leftMouseDown, at: point, button: .left, clickCount: 1, flags: flags)
            postMouseEvent(.leftMouseUp, at: point, button: .left, clickCount: 1, flags: flags)
            usleep(50_000)
            postMouseEvent(.leftMouseDown, at: point, button: .left, clickCount: 2, flags: flags)
            postMouseEvent(.leftMouseUp, at: point, button: .left, clickCount: 2, flags: flags)

        default:
            postMouseEvent(.leftMouseDown, at: point, button: .left, flags: flags)
            usleep(50_000)
            postMouseEvent(.leftMouseUp, at: point, button: .left, flags: flags)
        }
    }

    private static func shouldUsePidMousePath(pid: Int32) -> Bool {
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            return false
        }
        return !app.isActive
    }

    private static func clickViaPid(
        point: CGPoint,
        pid: Int32,
        windowId: UInt32?,
        button: String,
        modifiers: [String]
    ) throws -> Bool {
        let targetWindow = resolveTargetWindow(pid: pid, windowId: windowId)
        if let targetWindow {
            _ = FocusWithoutRaise.activateWithoutRaise(
                targetPid: pid,
                targetWindowId: CGWindowID(targetWindow.windowId)
            )
            usleep(50_000)
        }

        VirtualCursor.shared.move(to: point, animated: false)
        VirtualCursor.shared.setPressed(true)
        defer { VirtualCursor.shared.setPressed(false) }

        if button == "left" || button == "double" {
            try clickLeftViaSkyLight(
                point: point,
                pid: pid,
                window: targetWindow,
                count: button == "double" ? 2 : 1,
                modifiers: modifiers
            )
            return true
        }

        try clickGenericViaPid(
            point: point,
            pid: pid,
            window: targetWindow,
            button: button,
            modifiers: modifiers
        )
        return true
    }

    private static func clickLeftViaSkyLight(
        point: CGPoint,
        pid: Int32,
        window: WindowServerWindowInfo?,
        count: Int,
        modifiers: [String]
    ) throws {
        let windowNumber = window.map { Int($0.windowId) } ?? 0
        let windowLocalTarget = windowLocalPoint(point, window: window)
        let offscreen = CGPoint(x: -1, y: -1)
        let nsFlags = nsModifierFlags(from: modifiers)
        let cgFlags = modifierFlags(from: modifiers)

        func makeEvent(_ type: NSEvent.EventType, clickCount: Int) throws -> CGEvent {
            guard let event = NSEvent.mouseEvent(
                with: type,
                location: .zero,
                modifierFlags: nsFlags,
                timestamp: 0,
                windowNumber: windowNumber,
                context: nil,
                eventNumber: 0,
                clickCount: clickCount,
                pressure: 1
            )?.cgEvent else {
                throw InputSimulatorError.eventCreationFailed
            }
            return event
        }

        func stamp(
            _ event: CGEvent,
            screenPoint: CGPoint,
            windowLocalPoint: CGPoint,
            clickState: Int64
        ) {
            event.location = screenPoint
            event.flags = cgFlags
            event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
            event.setIntegerValueField(.mouseEventSubtype, value: 3)
            event.setIntegerValueField(.mouseEventClickState, value: clickState)
            if let window {
                let windowId = Int64(window.windowId)
                event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: windowId)
                event.setIntegerValueField(
                    .mouseEventWindowUnderMousePointerThatCanHandleThisEvent,
                    value: windowId
                )
            }
            _ = SkyLightEventPost.setWindowLocation(event, windowLocalPoint)
            _ = SkyLightEventPost.setIntegerField(event, field: 40, value: Int64(pid))
        }

        let move = try makeEvent(.mouseMoved, clickCount: 0)
        stamp(move, screenPoint: point, windowLocalPoint: windowLocalTarget, clickState: 1)

        let primerDown = try makeEvent(.leftMouseDown, clickCount: 1)
        let primerUp = try makeEvent(.leftMouseUp, clickCount: 1)
        stamp(primerDown, screenPoint: offscreen, windowLocalPoint: offscreen, clickState: 1)
        stamp(primerUp, screenPoint: offscreen, windowLocalPoint: offscreen, clickState: 1)

        let pairs = max(1, min(2, count))
        var targetPairs: [(down: CGEvent, up: CGEvent)] = []
        for pairIndex in 1...pairs {
            let down = try makeEvent(.leftMouseDown, clickCount: pairIndex)
            let up = try makeEvent(.leftMouseUp, clickCount: pairIndex)
            stamp(
                down,
                screenPoint: point,
                windowLocalPoint: windowLocalTarget,
                clickState: Int64(pairIndex)
            )
            stamp(
                up,
                screenPoint: point,
                windowLocalPoint: windowLocalTarget,
                clickState: Int64(pairIndex)
            )
            targetPairs.append((down, up))
        }

        postPidMouse(move, pid: pid, skyLightOnly: true)
        usleep(15_000)
        postPidMouse(primerDown, pid: pid, skyLightOnly: true)
        usleep(1_000)
        postPidMouse(primerUp, pid: pid, skyLightOnly: true)
        usleep(100_000)
        for (index, pair) in targetPairs.enumerated() {
            postPidMouse(pair.down, pid: pid, skyLightOnly: true)
            usleep(1_000)
            postPidMouse(pair.up, pid: pid, skyLightOnly: true)
            if index < targetPairs.count - 1 {
                usleep(80_000)
            }
        }
    }

    private static func clickGenericViaPid(
        point: CGPoint,
        pid: Int32,
        window: WindowServerWindowInfo?,
        button: String,
        modifiers: [String]
    ) throws {
        let (downType, upType, mouseButton, nsDown, nsUp): (
            CGEventType,
            CGEventType,
            CGMouseButton,
            NSEvent.EventType,
            NSEvent.EventType
        )
        switch button {
        case "right":
            (downType, upType, mouseButton, nsDown, nsUp) =
                (.rightMouseDown, .rightMouseUp, .right, .rightMouseDown, .rightMouseUp)
        case "middle":
            (downType, upType, mouseButton, nsDown, nsUp) =
                (.otherMouseDown, .otherMouseUp, .center, .otherMouseDown, .otherMouseUp)
        default:
            (downType, upType, mouseButton, nsDown, nsUp) =
                (.leftMouseDown, .leftMouseUp, .left, .leftMouseDown, .leftMouseUp)
        }
        let windowNumber = window.map { Int($0.windowId) } ?? 0
        let windowLocal = windowLocalPoint(point, window: window)
        let nsFlags = nsModifierFlags(from: modifiers)
        let cgFlags = modifierFlags(from: modifiers)

        let down = NSEvent.mouseEvent(
            with: nsDown,
            location: .zero,
            modifierFlags: nsFlags,
            timestamp: 0,
            windowNumber: windowNumber,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: 1
        )?.cgEvent ?? CGEvent(
            mouseEventSource: nil,
            mouseType: downType,
            mouseCursorPosition: point,
            mouseButton: mouseButton
        )
        let up = NSEvent.mouseEvent(
            with: nsUp,
            location: .zero,
            modifierFlags: nsFlags,
            timestamp: 0,
            windowNumber: windowNumber,
            context: nil,
            eventNumber: 0,
            clickCount: 1,
            pressure: 1
        )?.cgEvent ?? CGEvent(
            mouseEventSource: nil,
            mouseType: upType,
            mouseCursorPosition: point,
            mouseButton: mouseButton
        )
        guard let down, let up else {
            throw InputSimulatorError.eventCreationFailed
        }
        for event in [down, up] {
            event.location = point
            event.flags = cgFlags
            event.setIntegerValueField(.mouseEventClickState, value: 1)
            event.setIntegerValueField(
                .mouseEventButtonNumber,
                value: button == "right" ? 1 : button == "middle" ? 2 : 0
            )
            if let window {
                let windowId = Int64(window.windowId)
                event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: windowId)
                event.setIntegerValueField(
                    .mouseEventWindowUnderMousePointerThatCanHandleThisEvent,
                    value: windowId
                )
            }
            _ = SkyLightEventPost.setWindowLocation(event, windowLocal)
            _ = SkyLightEventPost.setIntegerField(event, field: 40, value: Int64(pid))
        }
        postPidMouse(down, pid: pid)
        usleep(30_000)
        postPidMouse(up, pid: pid)
    }

    private static func postPidMouse(_ event: CGEvent, pid: Int32, skyLightOnly: Bool = false) {
        event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        let posted = SkyLightEventPost.postToPid(pid, event: event, attachAuthMessage: false)
        if !skyLightOnly || !posted {
            event.postToPid(pid)
        }
    }

    private static func resolveTargetWindow(
        pid: Int32,
        windowId: UInt32?
    ) -> WindowServerWindowInfo? {
        if let windowId,
           let window = WindowEnumerator.window(windowId: windowId, pid: pid) {
            return window
        }
        let windows = WindowEnumerator.listWindows(pid: pid, onScreenOnly: false).windows
        return windows.first { $0.isOnScreen && ($0.onCurrentSpace ?? true) }
            ?? windows.first
    }

    private static func windowLocalPoint(
        _ point: CGPoint,
        window: WindowServerWindowInfo?
    ) -> CGPoint {
        guard let frame = window?.bounds else {
            return point
        }
        return CGPoint(x: point.x - frame.x, y: point.y - frame.y)
    }

    private static func postMouseEvent(
        _ type: CGEventType, at point: CGPoint,
        button: CGMouseButton,
        clickCount: Int64 = 1,
        flags: CGEventFlags = []
    ) {
        guard let event = CGEvent(
            mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type,
            mouseCursorPosition: point, mouseButton: button
        ) else { return }
        event.flags = flags
        if button == .center {
            event.setIntegerValueField(.mouseEventButtonNumber, value: 2)
        }
        event.setIntegerValueField(.mouseEventClickState, value: clickCount)
        event.post(tap: .cghidEventTap)
    }

    private static func cgMouseButton(for button: String) -> CGMouseButton {
        switch button {
        case "right": return .right
        case "middle": return .center
        default: return .left
        }
    }

    // MARK: - Move Cursor

    static func moveCursor(
        x: Double,
        y: Double,
        pid: Int32? = nil,
        windowId: UInt32? = nil
    ) {
        let point = CGPoint(x: x, y: y)
        if let pid, shouldUsePidMousePath(pid: pid) {
            let window = resolveTargetWindow(pid: pid, windowId: windowId)
            if let window {
                _ = FocusWithoutRaise.activateWithoutRaise(
                    targetPid: pid,
                    targetWindowId: CGWindowID(window.windowId)
                )
            }
            VirtualCursor.shared.move(to: point, animated: false)
            postPidMouseEvent(.mouseMoved, at: point, pid: pid, window: window)
            return
        }

        VirtualCursor.shared.move(to: point, animated: false)
        CGWarpMouseCursorPosition(point)
        postMouseEvent(.mouseMoved, at: point, button: .left, clickCount: 0)
    }

    // MARK: - Type Text

    static func typeText(_ text: String, delayMilliseconds: Int = 30, pid: Int32? = nil) {
        let clampedDelay = max(0, min(delayMilliseconds, 200))
        for char in text {
            if stopRequested { break }
            let utf16 = Array(String(char).utf16)
            guard let downEvent = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let upEvent = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            else { continue }

            downEvent.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            upEvent.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)

            postKeyboardEvent(downEvent, pid: pid)
            postKeyboardEvent(upEvent, pid: pid)
            if clampedDelay > 0 {
                usleep(UInt32(clampedDelay) * 1_000)
            }
        }
    }

    // MARK: - Press Key

    static func pressKey(_ key: String, modifiers: [String], pid: Int32? = nil) {
        let flags = modifierFlags(from: modifiers)

        if key.contains("+") {
            let parts = key.split(separator: "+")
            var combinedFlags = flags
            for part in parts.dropLast() {
                combinedFlags.insert(modifierFlag(String(part)))
            }
            let actualKey = String(parts.last ?? "")
            pressAndRelease(key: actualKey, flags: combinedFlags, pid: pid)
        } else {
            pressAndRelease(key: key, flags: flags, pid: pid)
        }
    }

    private static func pressAndRelease(key: String, flags: CGEventFlags, pid: Int32?) {
        guard let keyCode = keyCodes[key.lowercased()] else { return }

        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
        else { return }

        down.flags = flags
        up.flags = flags
        postKeyboardEvent(down, pid: pid)
        postKeyboardEvent(up, pid: pid)
    }

    private static func postKeyboardEvent(_ event: CGEvent, pid: Int32?) {
        if let pid {
            if !SkyLightEventPost.postToPid(pid, event: event, attachAuthMessage: true) {
                event.postToPid(pid)
            }
        } else {
            event.post(tap: .cghidEventTap)
        }
    }

    private static func modifierFlags(from names: [String]) -> CGEventFlags {
        var flags = CGEventFlags()
        for name in names {
            flags.insert(modifierFlag(name))
        }
        return flags
    }

    private static func modifierFlag(_ name: String) -> CGEventFlags {
        switch name.lowercased() {
        case "command", "cmd": return .maskCommand
        case "super", "meta": return .maskCommand
        case "shift": return .maskShift
        case "option", "alt", "opt": return .maskAlternate
        case "control", "ctrl": return .maskControl
        case "fn", "function": return .maskSecondaryFn
        default: return CGEventFlags()
        }
    }

    private static func nsModifierFlags(from names: [String]) -> NSEvent.ModifierFlags {
        var flags = NSEvent.ModifierFlags()
        for name in names {
            switch name.lowercased() {
            case "command", "cmd", "super", "meta": flags.insert(.command)
            case "shift": flags.insert(.shift)
            case "option", "alt", "opt": flags.insert(.option)
            case "control", "ctrl": flags.insert(.control)
            case "fn", "function": flags.insert(.function)
            default: break
            }
        }
        return flags
    }

    // MARK: - Scroll

    static func scroll(
        x: Double,
        y: Double,
        dx: Int32,
        dy: Int32,
        pid: Int32? = nil,
        windowId: UInt32? = nil
    ) {
        let point = CGPoint(x: x, y: y)
        if let pid, shouldUsePidMousePath(pid: pid) {
            let window = resolveTargetWindow(pid: pid, windowId: windowId)
            if let event = CGEvent(
                scrollWheelEvent2Source: nil,
                units: .pixel,
                wheelCount: 2,
                wheel1: dy,
                wheel2: dx,
                wheel3: 0
            ) {
                event.location = point
                if let window {
                    _ = FocusWithoutRaise.activateWithoutRaise(
                        targetPid: pid,
                        targetWindowId: CGWindowID(window.windowId)
                    )
                    _ = SkyLightEventPost.setWindowLocation(
                        event,
                        windowLocalPoint(point, window: window)
                    )
                }
                postPidMouse(event, pid: pid)
                return
            }
        }

        VirtualCursor.shared.move(to: point, animated: false)
        postMouseEvent(.mouseMoved, at: point, button: .left, clickCount: 0)
        usleep(30_000)

        if let scrollEvent = CGEvent(
            scrollWheelEvent2Source: CGEventSource(stateID: .hidSystemState), units: .pixel,
            wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0
        ) {
            scrollEvent.post(tap: .cghidEventTap)
        }
        VirtualCursor.shared.setPressed(false)
    }

    // MARK: - Drag

    static func drag(
        fromX: Double,
        fromY: Double,
        toX: Double,
        toY: Double,
        pid: Int32? = nil,
        windowId: UInt32? = nil
    ) {
        let from = CGPoint(x: fromX, y: fromY)
        let to = CGPoint(x: toX, y: toY)
        if let pid, shouldUsePidMousePath(pid: pid) {
            let window = resolveTargetWindow(pid: pid, windowId: windowId)
            if let window {
                _ = FocusWithoutRaise.activateWithoutRaise(
                    targetPid: pid,
                    targetWindowId: CGWindowID(window.windowId)
                )
            }
            postPidDrag(from: from, to: to, pid: pid, window: window)
            return
        }

        VirtualCursor.shared.move(to: from, animated: false)
        postMouseEvent(.mouseMoved, at: from, button: .left, clickCount: 0)
        usleep(30_000)
        VirtualCursor.shared.setPressed(true)
        defer { VirtualCursor.shared.setPressed(false) }

        postMouseEvent(.leftMouseDown, at: from, button: .left)
        usleep(50_000)

        let steps = 10
        for i in 1...steps {
            if stopRequested { break }
            let t = Double(i) / Double(steps)
            let x = from.x + (to.x - from.x) * t
            let y = from.y + (to.y - from.y) * t
            let point = CGPoint(x: x, y: y)
            if let moveEvent = CGEvent(
                mouseEventSource: CGEventSource(stateID: .hidSystemState),
                mouseType: .leftMouseDragged,
                mouseCursorPosition: point, mouseButton: .left
            ) {
                VirtualCursor.shared.move(to: point, animated: false)
                moveEvent.post(tap: .cghidEventTap)
            }
            usleep(10_000)
        }

        postMouseEvent(.leftMouseUp, at: to, button: .left)
    }

    private static func postPidDrag(
        from: CGPoint,
        to: CGPoint,
        pid: Int32,
        window: WindowServerWindowInfo?
    ) {
        VirtualCursor.shared.move(to: from, animated: false)
        VirtualCursor.shared.setPressed(true)
        defer { VirtualCursor.shared.setPressed(false) }

        postPidMouseEvent(.leftMouseDown, at: from, pid: pid, window: window)
        usleep(30_000)
        let steps = 10
        for i in 1...steps {
            if stopRequested { break }
            let t = Double(i) / Double(steps)
            let point = CGPoint(
                x: from.x + (to.x - from.x) * t,
                y: from.y + (to.y - from.y) * t
            )
            postPidMouseEvent(.leftMouseDragged, at: point, pid: pid, window: window)
            usleep(10_000)
        }
        postPidMouseEvent(.leftMouseUp, at: to, pid: pid, window: window)
    }

    private static func postPidMouseEvent(
        _ type: CGEventType,
        at point: CGPoint,
        pid: Int32,
        window: WindowServerWindowInfo?
    ) {
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: .left
        ) else { return }
        event.location = point
        event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
        if let window {
            let windowId = Int64(window.windowId)
            event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: windowId)
            event.setIntegerValueField(
                .mouseEventWindowUnderMousePointerThatCanHandleThisEvent,
                value: windowId
            )
            _ = SkyLightEventPost.setWindowLocation(
                event,
                windowLocalPoint(point, window: window)
            )
        }
        _ = SkyLightEventPost.setIntegerField(event, field: 40, value: Int64(pid))
        postPidMouse(event, pid: pid)
    }

    // MARK: - Key Codes (macOS virtual key codes)

    static let keyCodes: [String: UInt16] = [
        "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03,
        "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
        "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C,
        "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
        "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14,
        "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19,
        "7": 0x1A, "8": 0x1C, "0": 0x1D, "o": 0x1F,
        "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25,
        "j": 0x26, "k": 0x28, "n": 0x2D, "m": 0x2E,

        "return": 0x24, "enter": 0x24,
        "tab": 0x30,
        "space": 0x31,
        "delete": 0x33, "backspace": 0x33,
        "escape": 0x35, "esc": 0x35,
        "del": 0x75,

        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
        "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
        "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,

        "up": 0x7E, "uparrow": 0x7E,
        "down": 0x7D, "downarrow": 0x7D,
        "left": 0x7B, "leftarrow": 0x7B,
        "right": 0x7C, "rightarrow": 0x7C,
        "home": 0x73, "end": 0x77,
        "pageup": 0x74, "page_up": 0x74, "pgup": 0x74,
        "pagedown": 0x79, "page_down": 0x79, "pgdn": 0x79,
        "forwarddelete": 0x75, "forward_delete": 0x75,
        "kp_0": 0x52, "kp_1": 0x53, "kp_2": 0x54, "kp_3": 0x55,
        "kp_4": 0x56, "kp_5": 0x57, "kp_6": 0x58, "kp_7": 0x59,
        "kp_8": 0x5B, "kp_9": 0x5C, "kp_decimal": 0x41,
        "kp_enter": 0x4C,

        "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
        "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
        ".": 0x2F, "/": 0x2C, "`": 0x32,
    ]
}

enum InputSimulatorError: Error {
    case eventCreationFailed
}
