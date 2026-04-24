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

            walkChildren(
                element: axWindow,
                path: windowId,
                depth: 1,
                maxDepth: maxDepth,
                elements: &elements
            )
        }

        elements = prioritizeElements(elements, limit: 200)

        var screenshotPath: String? = nil
        if includeScreenshot {
            screenshotPath = Screenshot.captureWindow(pid: pid)
        }

        return AppStateResponse(
            app: summary,
            windows: windows,
            elements: elements,
            screenshotPath: screenshotPath,
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

    // MARK: - Tree Walking

    private static func walkChildren(
        element: AXUIElement,
        path: String,
        depth: Int,
        maxDepth: Int,
        elements: inout [ElementInfo]
    ) {
        guard depth <= maxDepth else { return }

        let children = getAXArray(element, attribute: kAXChildrenAttribute)
        for (idx, child) in children.enumerated() {
            let childPath = "\(path)/child:\(idx)"

            let role = getStringAttribute(child, attribute: kAXRoleAttribute) ?? "AXUnknown"
            let subrole = getStringAttribute(child, attribute: kAXSubroleAttribute)
            let title = getStringAttribute(child, attribute: kAXTitleAttribute)
            let desc = getStringAttribute(child, attribute: kAXDescriptionAttribute)
            let value = getValueAsString(child)
            let frame = getFrame(child)
            let enabled = getBoolAttribute(child, attribute: kAXEnabledAttribute)
            let focused = getBoolAttribute(child, attribute: kAXFocusedAttribute)
            let actions = getActionNames(child)

            let info = ElementInfo(
                id: childPath,
                role: role,
                subrole: subrole,
                title: title,
                description: desc,
                value: value,
                frame: frame,
                enabled: enabled,
                focused: focused,
                actions: actions
            )
            elements.append(info)

            walkChildren(
                element: child,
                path: childPath,
                depth: depth + 1,
                maxDepth: maxDepth,
                elements: &elements
            )
        }
    }

    // MARK: - Prioritization

    private static let actionableRoles: Set<String> = [
        "AXButton", "AXTextField", "AXTextArea", "AXMenuItem",
        "AXCheckBox", "AXRadioButton", "AXSlider", "AXPopUpButton",
        "AXComboBox", "AXTab", "AXTabGroup", "AXLink",
        "AXIncrementor", "AXColorWell", "AXDisclosureTriangle",
    ]

    private static func prioritizeElements(_ elements: [ElementInfo], limit: Int) -> [ElementInfo] {
        if elements.count <= limit { return elements }

        var focused: [ElementInfo] = []
        var actionable: [ElementInfo] = []
        var rest: [ElementInfo] = []

        for el in elements {
            if el.focused == true {
                focused.append(el)
            } else if actionableRoles.contains(el.role) || !el.actions.isEmpty {
                actionable.append(el)
            } else {
                rest.append(el)
            }
        }

        var result = focused + actionable
        let remaining = limit - result.count
        if remaining > 0 {
            result.append(contentsOf: rest.prefix(remaining))
        } else {
            result = Array(result.prefix(limit))
        }
        return result
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
