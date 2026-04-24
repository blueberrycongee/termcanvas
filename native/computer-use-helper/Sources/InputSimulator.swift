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

    static func click(x: Double, y: Double, button: String = "left") throws {
        let point = CGPoint(x: x, y: y)

        switch button {
        case "right":
            postMouseEvent(.rightMouseDown, at: point, button: .right)
            usleep(50_000)
            postMouseEvent(.rightMouseUp, at: point, button: .right)

        case "double":
            postMouseEvent(.leftMouseDown, at: point, button: .left, clickCount: 1)
            postMouseEvent(.leftMouseUp, at: point, button: .left, clickCount: 1)
            usleep(50_000)
            postMouseEvent(.leftMouseDown, at: point, button: .left, clickCount: 2)
            postMouseEvent(.leftMouseUp, at: point, button: .left, clickCount: 2)

        default:
            postMouseEvent(.leftMouseDown, at: point, button: .left)
            usleep(50_000)
            postMouseEvent(.leftMouseUp, at: point, button: .left)
        }
    }

    private static func postMouseEvent(
        _ type: CGEventType, at point: CGPoint,
        button: CGMouseButton, clickCount: Int64 = 1
    ) {
        guard let event = CGEvent(
            mouseEventSource: nil, mouseType: type,
            mouseCursorPosition: point, mouseButton: button
        ) else { return }
        event.setIntegerValueField(.mouseEventClickState, value: clickCount)
        event.post(tap: .cghidEventTap)
    }

    // MARK: - Type Text

    static func typeText(_ text: String) {
        for char in text {
            if stopRequested { break }
            let utf16 = Array(String(char).utf16)
            guard let downEvent = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let upEvent = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            else { continue }

            downEvent.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            upEvent.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)

            downEvent.post(tap: .cghidEventTap)
            upEvent.post(tap: .cghidEventTap)
            usleep(10_000)
        }
    }

    // MARK: - Press Key

    static func pressKey(_ key: String, modifiers: [String]) {
        let flags = modifierFlags(from: modifiers)

        if key.contains("+") {
            let parts = key.split(separator: "+")
            var combinedFlags = flags
            for part in parts.dropLast() {
                combinedFlags.insert(modifierFlag(String(part)))
            }
            let actualKey = String(parts.last ?? "")
            pressAndRelease(key: actualKey, flags: combinedFlags)
        } else {
            pressAndRelease(key: key, flags: flags)
        }
    }

    private static func pressAndRelease(key: String, flags: CGEventFlags) {
        guard let keyCode = keyCodes[key.lowercased()] else { return }

        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
        else { return }

        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
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
        case "shift": return .maskShift
        case "option", "alt": return .maskAlternate
        case "control", "ctrl": return .maskControl
        default: return CGEventFlags()
        }
    }

    // MARK: - Scroll

    static func scroll(x: Double, y: Double, dx: Int32, dy: Int32) {
        let point = CGPoint(x: x, y: y)

        // Move cursor to position first
        if let moveEvent = CGEvent(
            mouseEventSource: nil, mouseType: .mouseMoved,
            mouseCursorPosition: point, mouseButton: .left
        ) {
            moveEvent.post(tap: .cghidEventTap)
            usleep(10_000)
        }

        if let scrollEvent = CGEvent(
            scrollWheelEvent2Source: nil, units: .pixel,
            wheelCount: 2, wheel1: dy, wheel2: dx
        ) {
            scrollEvent.post(tap: .cghidEventTap)
        }
    }

    // MARK: - Drag

    static func drag(fromX: Double, fromY: Double, toX: Double, toY: Double) {
        let from = CGPoint(x: fromX, y: fromY)
        let to = CGPoint(x: toX, y: toY)

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
                mouseEventSource: nil, mouseType: .leftMouseDragged,
                mouseCursorPosition: point, mouseButton: .left
            ) {
                moveEvent.post(tap: .cghidEventTap)
            }
            usleep(10_000)
        }

        postMouseEvent(.leftMouseUp, at: to, button: .left)
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

        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
        "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
        "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,

        "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
        "home": 0x73, "end": 0x77,
        "pageup": 0x74, "pagedown": 0x79,
        "forwarddelete": 0x75,

        "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
        "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
        ".": 0x2F, "/": 0x2C, "`": 0x32,
    ]
}
