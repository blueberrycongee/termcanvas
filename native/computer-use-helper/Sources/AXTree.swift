import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowId: UnsafeMutablePointer<CGWindowID>) -> AXError

private let axObserverNoopCallback: AXObserverCallback = { _, _, _, _ in }

enum AXTree {
    private static let activationLock = NSLock()
    private static var pumpedPids = Set<Int32>()
    private static var accessibilityObservers: [Int32: AXObserver] = [:]
    private static let sessionLock = NSLock()
    private static var sessions: [SessionKey: [Int: AXUIElement]] = [:]

    private struct SessionKey: Hashable {
        let pid: Int32
        let windowId: UInt32
    }

    // MARK: - Public API

    static func getAppState(
        pid: Int32,
        includeScreenshot: Bool,
        maxDepth: Int,
        captureMode: String,
        maxImageDimension: Int
    ) -> AppStateResponse {
        let runningApp = NSRunningApplication(processIdentifier: pid)
        let appName = runningApp?.localizedName ?? "Unknown"
        let bundleId = runningApp?.bundleIdentifier

        let summary = AppSummary(name: appName, bundleId: bundleId, pid: pid)

        var windows: [WindowInfo] = []
        var elements: [ElementInfo] = []
        var accessibilityTree: [AccessibilityNode] = []
        var nextIndex = 0
        var elementCache: [Int: AXUIElement] = [:]

        if captureMode == "vision" {
            windows = WindowEnumerator.listWindows(pid: pid, onScreenOnly: false).windows.map {
                WindowInfo(
                    id: "\($0.windowId)",
                    windowId: UInt32(exactly: $0.windowId),
                    title: $0.title,
                    frame: $0.bounds
                )
            }
        } else {
            let app = AXUIElementCreateApplication(pid)
            activateAccessibilityIfNeeded(pid: pid, app: app)

            let axWindows = getAXArray(app, attribute: kAXWindowsAttribute)
            for (wIdx, axWindow) in axWindows.enumerated() {
                let windowId = "w\(wIdx)"
                let cgWindowId = cgWindowId(for: axWindow)
                let title = getStringAttribute(axWindow, attribute: kAXTitleAttribute)
                let frame = getFrame(axWindow)

                windows.append(WindowInfo(
                    id: windowId,
                    windowId: cgWindowId,
                    title: title,
                    frame: frame ?? Frame(x: 0, y: 0, width: 0, height: 0)
                ))

                accessibilityTree.append(contentsOf: walkChildren(
                    element: axWindow,
                    path: windowId,
                    depth: 1,
                    maxDepth: maxDepth,
                    elements: &elements,
                    nextIndex: &nextIndex,
                    elementCache: &elementCache
                ))
            }
        }

        var screenshot: ScreenshotInfo? = nil
        if includeScreenshot && captureMode != "ax" {
            screenshot = Screenshot.captureWindow(
                pid: pid,
                windowFrame: windows.first?.frame,
                maxImageDimension: maxImageDimension
            )
        }

        return AppStateResponse(
            app: summary,
            windows: windows,
            elements: elements,
            accessibilityTree: accessibilityTree,
            screenshotPath: screenshot?.path,
            screenshot: screenshot,
            screenshotCaptureId: screenshot?.captureId,
            screenshotPixelSize: screenshot?.pixelSize,
            screenshotScale: screenshot?.scale,
            windowFrame: screenshot?.windowFrame ?? Self.primaryFrame(from: windows),
            coordinateSpace: "screen"
        )
    }

    static func getWindowState(
        pid: Int32,
        windowId: UInt32,
        includeScreenshot: Bool,
        maxDepth: Int,
        captureMode: String,
        maxImageDimension: Int
    ) -> AppStateResponse {
        let runningApp = NSRunningApplication(processIdentifier: pid)
        let appName = runningApp?.localizedName ?? "Unknown"
        let bundleId = runningApp?.bundleIdentifier
        let summary = AppSummary(name: appName, bundleId: bundleId, pid: pid)

        let serverWindow = WindowEnumerator.window(windowId: windowId, pid: pid)

        var windows: [WindowInfo] = []
        var elements: [ElementInfo] = []
        var accessibilityTree: [AccessibilityNode] = []
        var nextIndex = 0
        var elementCache: [Int: AXUIElement] = [:]

        if captureMode == "vision" {
            if let serverWindow {
                windows.append(WindowInfo(
                    id: "\(windowId)",
                    windowId: windowId,
                    title: serverWindow.title,
                    frame: serverWindow.bounds
                ))
            }
            storeSession(pid: pid, windowId: windowId, elements: [:])
        } else {
            let app = AXUIElementCreateApplication(pid)
            activateAccessibilityIfNeeded(pid: pid, app: app)
            let axWindows = getAXArray(app, attribute: kAXWindowsAttribute)
            let targetWindow = axWindows.first { cgWindowId(for: $0) == windowId }

            if let targetWindow {
                let title = getStringAttribute(targetWindow, attribute: kAXTitleAttribute)
                    ?? serverWindow?.title
                let frame = getFrame(targetWindow) ?? serverWindow?.bounds
                windows.append(WindowInfo(
                    id: "\(windowId)",
                    windowId: windowId,
                    title: title,
                    frame: frame ?? Frame(x: 0, y: 0, width: 0, height: 0)
                ))

                accessibilityTree.append(contentsOf: walkChildren(
                    element: targetWindow,
                    path: "w:\(windowId)",
                    depth: 1,
                    maxDepth: maxDepth,
                    elements: &elements,
                    nextIndex: &nextIndex,
                    elementCache: &elementCache
                ))
            } else if let serverWindow {
                windows.append(WindowInfo(
                    id: "\(windowId)",
                    windowId: windowId,
                    title: serverWindow.title,
                    frame: serverWindow.bounds
                ))
            }
            storeSession(pid: pid, windowId: windowId, elements: elementCache)
        }

        var screenshot: ScreenshotInfo? = nil
        if includeScreenshot && captureMode != "ax" {
            screenshot = Screenshot.captureWindow(
                pid: pid,
                windowID: CGWindowID(windowId),
                windowFrame: windows.first?.frame ?? serverWindow?.bounds,
                maxImageDimension: maxImageDimension
            )
        }

        return AppStateResponse(
            app: summary,
            windows: windows,
            elements: elements,
            accessibilityTree: accessibilityTree,
            screenshotPath: screenshot?.path,
            screenshot: screenshot,
            screenshotCaptureId: screenshot?.captureId,
            screenshotPixelSize: screenshot?.pixelSize,
            screenshotScale: screenshot?.scale,
            windowFrame: screenshot?.windowFrame ?? windows.first?.frame,
            coordinateSpace: "screen"
        )
    }

    // MARK: - Element Resolution

    static func resolveElement(pid: Int32, elementId: String) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        activateAccessibilityIfNeeded(pid: pid, app: app)

        let parts = elementId.split(separator: "/")
        guard let first = parts.first, first.hasPrefix("w"),
              let windowIndex = Int(first.dropFirst())
        else { return nil }

        let axWindows = getAXArray(app, attribute: kAXWindowsAttribute)
        guard windowIndex < axWindows.count else { return nil }

        var current = axWindows[windowIndex]
        for part in parts.dropFirst() {
            let partStr = String(part)
            guard partStr.hasPrefix("child:"),
                  let childIndex = Int(partStr.dropFirst(6))
            else { return nil }

            let children = getAXArray(current, attribute: kAXChildrenAttribute)
            guard childIndex < children.count else { return nil }
            current = children[childIndex]
        }

        return current
    }

    static func resolveElement(pid: Int32, elementIndex: Int) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        activateAccessibilityIfNeeded(pid: pid, app: app)

        var nextIndex = 0
        for axWindow in getAXArray(app, attribute: kAXWindowsAttribute) {
            if let element = resolveChildByIndex(
                element: axWindow,
                targetIndex: elementIndex,
                nextIndex: &nextIndex
            ) {
                return element
            }
        }
        return nil
    }

    static func resolveElement(pid: Int32, windowId: UInt32, elementIndex: Int) -> AXUIElement? {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        return sessions[SessionKey(pid: pid, windowId: windowId)]?[elementIndex]
    }

    static func primaryWindowFrame(pid: Int32) -> Frame? {
        let app = AXUIElementCreateApplication(pid)
        activateAccessibilityIfNeeded(pid: pid, app: app)
        let frames = getAXArray(app, attribute: kAXWindowsAttribute)
            .compactMap { getFrame($0) }
            .filter { $0.width > 0 && $0.height > 0 }
        return frames.max { lhs, rhs in
            lhs.width * lhs.height < rhs.width * rhs.height
        }
    }

    static func getElementPosition(_ element: AXUIElement) -> CGPoint? {
        var posRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
              let axValue = posRef
        else { return nil }

        var point = CGPoint.zero
        AXValueGetValue(axValue as! AXValue, .cgPoint, &point)
        return point
    }

    static func getElementSize(_ element: AXUIElement) -> CGSize? {
        var sizeRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success,
              let axValue = sizeRef
        else { return nil }

        var size = CGSize.zero
        AXValueGetValue(axValue as! AXValue, .cgSize, &size)
        return size
    }

    static func getElementCenter(_ element: AXUIElement) -> CGPoint? {
        guard let pos = getElementPosition(element),
              let size = getElementSize(element)
        else { return nil }
        return CGPoint(x: pos.x + size.width / 2, y: pos.y + size.height / 2)
    }

    static func performAction(_ element: AXUIElement, action: String) -> AXError {
        return AXUIElementPerformAction(element, action as CFString)
    }

    static func setValue(_ element: AXUIElement, value: String) -> AXError {
        return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    }

    static func focus(_ element: AXUIElement) -> AXError {
        return AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    }

    // MARK: - Tree Walking

    private static func walkChildren(
        element: AXUIElement,
        path: String,
        depth: Int,
        maxDepth: Int,
        elements: inout [ElementInfo],
        nextIndex: inout Int,
        elementCache: inout [Int: AXUIElement]
    ) -> [AccessibilityNode] {
        guard depth <= maxDepth else { return [] }

        let children = getAXArray(element, attribute: kAXChildrenAttribute)
        var nodes: [AccessibilityNode] = []
        for (idx, child) in children.enumerated() {
            let childPath = "\(path)/child:\(idx)"
            let index = nextIndex
            nextIndex += 1
            elementCache[index] = child

            let role = getStringAttribute(child, attribute: kAXRoleAttribute) ?? "AXUnknown"
            let subrole = getStringAttribute(child, attribute: kAXSubroleAttribute)
            let title = getStringAttribute(child, attribute: kAXTitleAttribute)
            let desc = getStringAttribute(child, attribute: kAXDescriptionAttribute)
            let value = getValueAsString(child)
            let frame = getFrame(child)
            let enabled = getBoolAttribute(child, attribute: kAXEnabledAttribute)
            let focused = getBoolAttribute(child, attribute: kAXFocusedAttribute)
            let selected = getBoolAttribute(child, attribute: kAXSelectedAttribute)
            let expanded = getBoolAttribute(child, attribute: kAXExpandedAttribute)
            let help = getStringAttribute(child, attribute: kAXHelpAttribute)
            let actions = getActionNames(child)
            let label = title ?? desc ?? value

            let info = ElementInfo(
                index: index,
                id: childPath,
                role: role,
                subrole: subrole,
                label: label,
                title: title,
                description: desc,
                value: value,
                frame: frame,
                enabled: enabled,
                focused: focused,
                selected: selected,
                expanded: expanded,
                help: help,
                actions: actions
            )
            elements.append(info)

            let childNodes = walkChildren(
                element: child,
                path: childPath,
                depth: depth + 1,
                maxDepth: maxDepth,
                elements: &elements,
                nextIndex: &nextIndex,
                elementCache: &elementCache
            )
            nodes.append(AccessibilityNode(
                index: index,
                id: childPath,
                role: role,
                subrole: subrole,
                label: label,
                title: title,
                description: desc,
                value: value,
                frame: frame,
                enabled: enabled,
                focused: focused,
                selected: selected,
                expanded: expanded,
                help: help,
                actions: actions,
                children: childNodes
            ))
        }
        return nodes
    }

    private static func primaryFrame(from windows: [WindowInfo]) -> Frame? {
        return windows
            .map { $0.frame }
            .filter { $0.width > 0 && $0.height > 0 }
            .max { lhs, rhs in
                lhs.width * lhs.height < rhs.width * rhs.height
            }
    }

    private static func resolveChildByIndex(
        element: AXUIElement,
        targetIndex: Int,
        nextIndex: inout Int
    ) -> AXUIElement? {
        let children = getAXArray(element, attribute: kAXChildrenAttribute)
        for child in children {
            let currentIndex = nextIndex
            nextIndex += 1
            if currentIndex == targetIndex {
                return child
            }
            if let found = resolveChildByIndex(
                element: child,
                targetIndex: targetIndex,
                nextIndex: &nextIndex
            ) {
                return found
            }
        }
        return nil
    }

    private static func storeSession(
        pid: Int32,
        windowId: UInt32,
        elements: [Int: AXUIElement]
    ) {
        sessionLock.lock()
        sessions[SessionKey(pid: pid, windowId: windowId)] = elements
        sessionLock.unlock()
    }

    // MARK: - AX Helpers

    private static func getAXArray(_ element: AXUIElement, attribute: String) -> [AXUIElement] {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
              let array = ref as? [AXUIElement]
        else { return [] }
        return array
    }

    private static func activateAccessibilityIfNeeded(pid: Int32, app: AXUIElement) {
        let manualResult = AXUIElementSetAttributeValue(
            app,
            "AXManualAccessibility" as CFString,
            kCFBooleanTrue
        )
        let enhancedResult = AXUIElementSetAttributeValue(
            app,
            "AXEnhancedUserInterface" as CFString,
            kCFBooleanTrue
        )
        guard manualResult == .success || enhancedResult == .success else {
            return
        }

        activationLock.lock()
        let shouldPump = !pumpedPids.contains(pid)
        if shouldPump {
            pumpedPids.insert(pid)
        }
        activationLock.unlock()

        guard shouldPump else { return }
        registerAccessibilityObserver(pid: pid)
        pumpRunLoopForActivation(duration: 0.5)
    }

    private static func registerAccessibilityObserver(pid: Int32) {
        var observer: AXObserver?
        let result = AXObserverCreate(pid, axObserverNoopCallback, &observer)
        guard result == .success, let observer else { return }

        let source = AXObserverGetRunLoopSource(observer)
        CFRunLoopAddSource(
            CFRunLoopGetMain(),
            source,
            CFRunLoopMode.defaultMode
        )

        let root = AXUIElementCreateApplication(pid)
        for notification in [
            kAXFocusedUIElementChangedNotification,
            kAXFocusedWindowChangedNotification,
            kAXApplicationActivatedNotification,
            kAXApplicationDeactivatedNotification,
            kAXWindowCreatedNotification,
            kAXWindowMovedNotification,
            kAXWindowResizedNotification,
            kAXValueChangedNotification,
            kAXTitleChangedNotification,
            kAXSelectedChildrenChangedNotification,
            kAXLayoutChangedNotification,
        ] {
            _ = addObserverNotificationPreferRemote(
                observer: observer,
                element: root,
                notification: notification as CFString
            )
        }

        activationLock.lock()
        accessibilityObservers[pid] = observer
        activationLock.unlock()
    }

    private static func pumpRunLoopForActivation(duration: CFTimeInterval) {
        let endTime = CFAbsoluteTimeGetCurrent() + duration
        while CFAbsoluteTimeGetCurrent() < endTime {
            let remaining = endTime - CFAbsoluteTimeGetCurrent()
            _ = CFRunLoopRunInMode(.defaultMode, remaining, false)
        }
    }

    private static func addObserverNotificationPreferRemote(
        observer: AXObserver,
        element: AXUIElement,
        notification: CFString
    ) -> AXError {
        if let fn = axObserverAddNotificationAndCheckRemote {
            return fn(observer, element, notification, nil)
        }
        return AXObserverAddNotification(observer, element, notification, nil)
    }

    private static let axObserverAddNotificationAndCheckRemote:
        (@convention(c) (AXObserver, AXUIElement, CFString, UnsafeMutableRawPointer?) -> AXError)? = {
            guard let sym = dlsym(
                UnsafeMutableRawPointer(bitPattern: -2),
                "AXObserverAddNotificationAndCheckRemote"
            ) else {
                return nil
            }
            return unsafeBitCast(
                sym,
                to: (@convention(c) (AXObserver, AXUIElement, CFString, UnsafeMutableRawPointer?) -> AXError).self
            )
        }()

    private static func cgWindowId(for element: AXUIElement) -> UInt32? {
        var windowId: CGWindowID = 0
        guard _AXUIElementGetWindow(element, &windowId) == .success,
              windowId != 0
        else {
            return nil
        }
        return UInt32(windowId)
    }

    private static func getStringAttribute(_ element: AXUIElement, attribute: String) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
              let str = ref as? String
        else { return nil }
        return str
    }

    private static func getBoolAttribute(_ element: AXUIElement, attribute: String) -> Bool? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success else {
            return nil
        }
        if let num = ref as? NSNumber { return num.boolValue }
        if let val = ref as? Bool { return val }
        return nil
    }

    private static func getValueAsString(_ element: AXUIElement) -> String? {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &ref) == .success,
              let value = ref
        else { return nil }

        if let str = value as? String { return str }
        if let num = value as? NSNumber { return num.stringValue }
        return "\(value)"
    }

    private static func getFrame(_ element: AXUIElement) -> Frame? {
        guard let pos = getElementPosition(element),
              let size = getElementSize(element)
        else { return nil }
        return Frame(x: pos.x, y: pos.y, width: size.width, height: size.height)
    }

    private static func getActionNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success,
              let actionNames = names as? [String]
        else { return [] }
        return actionNames
    }
}
