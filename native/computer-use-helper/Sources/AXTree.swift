import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum AXTree {

    // MARK: - Public API

    static func getAppState(pid: Int32, includeScreenshot: Bool, maxDepth: Int) -> AppStateResponse {
        let app = AXUIElementCreateApplication(pid)

        // Enable AXManualAccessibility for Electron/Chromium apps
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

        let runningApp = NSRunningApplication(processIdentifier: pid)
        let appName = runningApp?.localizedName ?? "Unknown"
        let bundleId = runningApp?.bundleIdentifier

        let summary = AppSummary(name: appName, bundleId: bundleId, pid: pid)

        var windows: [WindowInfo] = []
        var elements: [ElementInfo] = []
        var accessibilityTree: [AccessibilityNode] = []
        var nextIndex = 0

        let axWindows = getAXArray(app, attribute: kAXWindowsAttribute)
        for (wIdx, axWindow) in axWindows.enumerated() {
            let windowId = "w\(wIdx)"
            let title = getStringAttribute(axWindow, attribute: kAXTitleAttribute)
            let frame = getFrame(axWindow)

            windows.append(WindowInfo(
                id: windowId,
                title: title,
                frame: frame ?? Frame(x: 0, y: 0, width: 0, height: 0)
            ))

            accessibilityTree.append(contentsOf: walkChildren(
                element: axWindow,
                path: windowId,
                depth: 1,
                maxDepth: maxDepth,
                elements: &elements,
                nextIndex: &nextIndex
            ))
        }

        var screenshot: ScreenshotInfo? = nil
        if includeScreenshot {
            screenshot = Screenshot.captureWindow(pid: pid, windowFrame: windows.first?.frame)
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

    // MARK: - Element Resolution

    static func resolveElement(pid: Int32, elementId: String) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

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
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

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

    static func primaryWindowFrame(pid: Int32) -> Frame? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
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

    // MARK: - Tree Walking

    private static func walkChildren(
        element: AXUIElement,
        path: String,
        depth: Int,
        maxDepth: Int,
        elements: inout [ElementInfo],
        nextIndex: inout Int
    ) -> [AccessibilityNode] {
        guard depth <= maxDepth else { return [] }

        let children = getAXArray(element, attribute: kAXChildrenAttribute)
        var nodes: [AccessibilityNode] = []
        for (idx, child) in children.enumerated() {
            let childPath = "\(path)/child:\(idx)"
            let index = nextIndex
            nextIndex += 1

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
                nextIndex: &nextIndex
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

    // MARK: - AX Helpers

    private static func getAXArray(_ element: AXUIElement, attribute: String) -> [AXUIElement] {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &ref) == .success,
              let array = ref as? [AXUIElement]
        else { return [] }
        return array
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
