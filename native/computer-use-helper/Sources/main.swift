import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Arg Parsing

var port: UInt16 = 17394
var token: String = ""

let args = CommandLine.arguments
var argIdx = 1
while argIdx < args.count {
    switch args[argIdx] {
    case "--port":
        argIdx += 1
        if argIdx < args.count { port = UInt16(args[argIdx]) ?? 17394 }
    case "--token":
        argIdx += 1
        if argIdx < args.count { token = args[argIdx] }
    default:
        break
    }
    argIdx += 1
}

// MARK: - Signal Handling

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigintSource.setEventHandler { exit(0) }
sigintSource.resume()
signal(SIGINT, SIG_IGN)

let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler { exit(0) }
sigtermSource.resume()
signal(SIGTERM, SIG_IGN)

// MARK: - Server Setup

do {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    VirtualCursor.shared.prepare()

    let server = try HTTPServer(port: port, token: token)

    server.routeHandler = { method, path, headers, body in
        return route(method: method, path: path, body: body)
    }

    server.start()
} catch {
    fputs("Failed to start server: \(error)\n", stderr)
    exit(1)
}

NSApplication.shared.run()

// MARK: - Router

func route(method: String, path: String, body: Data?) -> (Int, Data) {
    do {
        switch path {
        case "/health":
            return ok(HealthResponse(ok: true, version: "0.1.0"))

        case "/status":
            return ok(handleStatus())

        case "/request_permissions":
            return ok(handleRequestPermissions())

        case "/list_apps":
            return ok(ListAppsResponse(apps: AppLister.listApps()))

        case "/list_windows":
            let req: ListWindowsRequest = try decodeOrDefault(body, defaultValue: ListWindowsRequest(
                pid: nil,
                onScreenOnly: nil
            ))
            return ok(WindowEnumerator.listWindows(
                pid: req.pid,
                onScreenOnly: req.onScreenOnly ?? false
            ))

        case "/get_screen_size":
            return ok(handleGetScreenSize())

        case "/screenshot":
            let req: ScreenshotRequest = try decodeOrDefault(body, defaultValue: ScreenshotRequest(
                pid: nil,
                windowId: nil
            ))
            return ok(handleScreenshot(req))

        case "/zoom":
            let req: ZoomRequest = try decode(body)
            return ok(Screenshot.zoom(
                pid: req.pid,
                captureId: req.captureId,
                x1: req.x1,
                y1: req.y1,
                x2: req.x2,
                y2: req.y2
            ))

        case "/open_app":
            let req: OpenAppRequest = try decode(body)
            return ok(AppLister.openApp(bundleId: req.bundleId, name: req.name))

        case "/launch_app":
            let req: OpenAppRequest = try decode(body)
            return ok(AppLister.launchAppBackground(bundleId: req.bundleId, name: req.name))

        case "/get_app_state":
            let req: GetAppStateRequest = try decode(body)
            guard let pid = resolvePid(pid: req.pid, appName: req.appName) else {
                return ok(OkResponse(ok: false, error: "Provide pid or a running app_name"))
            }
            let state = AXTree.getAppState(
                pid: pid,
                includeScreenshot: req.includeScreenshot ?? false,
                maxDepth: req.maxDepth ?? 4,
                captureMode: normalizeCaptureMode(req.captureMode),
                maxImageDimension: req.maxImageDimension ?? 0
            )
            return ok(state)

        case "/get_window_state":
            let req: GetWindowStateRequest = try decode(body)
            guard let window = WindowEnumerator.window(windowId: req.windowId, pid: req.pid) else {
                return ok(OkResponse(
                    ok: false,
                    error: "No window_id \(req.windowId) belongs to pid \(req.pid). Call list_windows for current candidates."
                ))
            }
            let state = AXTree.getWindowState(
                pid: req.pid,
                windowId: UInt32(window.windowId),
                includeScreenshot: req.includeScreenshot ?? false,
                maxDepth: req.maxDepth ?? 4,
                captureMode: normalizeCaptureMode(req.captureMode),
                maxImageDimension: req.maxImageDimension ?? 0
            )
            return ok(state)

        case "/click":
            let req: ClickRequest = try decode(body)
            return handleClick(req)

        case "/type_text":
            let req: TypeTextRequest = try decode(body)
            InputSimulator.stopRequested = false
            if let element = resolveCachedElement(
                pid: req.pid,
                windowId: req.windowId,
                elementIndex: req.elementIndex
            ) {
                _ = AXTree.focus(element)
            }
            InputSimulator.typeText(req.text, pid: req.pid)
            return ok(OkResponse())

        case "/press_key":
            let req: PressKeyRequest = try decode(body)
            if let element = resolveCachedElement(
                pid: req.pid,
                windowId: req.windowId,
                elementIndex: req.elementIndex
            ) {
                _ = AXTree.focus(element)
            }
            InputSimulator.pressKey(req.key, modifiers: req.modifiers ?? [], pid: req.pid)
            return ok(OkResponse())

        case "/set_value":
            let req: SetValueRequest = try decode(body)
            return handleSetValue(req)

        case "/perform_secondary_action":
            let req: PerformActionRequest = try decode(body)
            return handlePerformAction(req)

        case "/scroll":
            let req: ScrollRequest = try decode(body)
            return handleScroll(req)

        case "/drag":
            let req: DragRequest = try decode(body)
            return handleDrag(req)

        case "/stop":
            InputSimulator.stopRequested = true
            VirtualCursor.shared.hide()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                exit(0)
            }
            return ok(OkResponse())

        default:
            return (404, try! sharedEncoder.encode(ErrorResponse(error: "unknown endpoint")))
        }
    } catch let error as DecodingError {
        let msg = "Invalid request body: \(error.localizedDescription)"
        return (400, try! sharedEncoder.encode(ErrorResponse(error: msg)))
    } catch {
        return (500, try! sharedEncoder.encode(ErrorResponse(error: error.localizedDescription)))
    }
}

// MARK: - Handlers

func handleStatus() -> StatusResponse {
    let axTrusted = AXIsProcessTrusted()
    let screenGranted = CGPreflightScreenCaptureAccess()
    return StatusResponse(
        accessibilityGranted: axTrusted,
        screenRecordingGranted: screenGranted,
        skylightPostToPidAvailable: SkyLightEventPost.isAvailable,
        focusWithoutRaiseAvailable: SkyLightEventPost.isFocusWithoutRaiseAvailable,
        windowLocationAvailable: SkyLightEventPost.isWindowLocationAvailable,
        screenCaptureKitAvailable: isScreenCaptureKitAvailable()
    )
}

func handleRequestPermissions() -> StatusResponse {
    var axTrusted = false
    var screenGranted = false

    DispatchQueue.main.sync {
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
        ] as CFDictionary
        axTrusted = AXIsProcessTrustedWithOptions(options)

        screenGranted = CGPreflightScreenCaptureAccess()
        if !screenGranted {
            screenGranted = CGRequestScreenCaptureAccess()
        }
    }

    return StatusResponse(
        accessibilityGranted: axTrusted,
        screenRecordingGranted: screenGranted,
        skylightPostToPidAvailable: SkyLightEventPost.isAvailable,
        focusWithoutRaiseAvailable: SkyLightEventPost.isFocusWithoutRaiseAvailable,
        windowLocationAvailable: SkyLightEventPost.isWindowLocationAvailable,
        screenCaptureKitAvailable: isScreenCaptureKitAvailable()
    )
}

func isScreenCaptureKitAvailable() -> Bool {
    if #available(macOS 14.0, *) {
        return true
    }
    return false
}

func handleGetScreenSize() -> ScreenSizeResponse {
    let screen = NSScreen.main ?? NSScreen.screens.first
    let frame = screen?.frame ?? .zero
    let scale = Double(screen?.backingScaleFactor ?? 1)
    return ScreenSizeResponse(
        width: Int(frame.width * scale),
        height: Int(frame.height * scale),
        scale: scale
    )
}

func handleScreenshot(_ req: ScreenshotRequest) -> ScreenshotInfo? {
    if let pid = req.pid, let windowId = req.windowId {
        return Screenshot.captureWindow(pid: pid, windowID: CGWindowID(windowId), windowFrame: nil)
    }
    if let pid = req.pid {
        return Screenshot.captureWindow(pid: pid, windowFrame: nil)
    }
    return Screenshot.captureMainDisplay()
}

func handleClick(_ req: ClickRequest) -> (Int, Data) {
    let button = req.mouseButton ?? req.button ?? "left"
    let clickCount = max(req.clickCount ?? (button == "double" ? 2 : 1), 1)
    let modifiers = req.modifiers ?? req.modifier ?? []
    if req.debugImageOut != nil && (req.x == nil || req.y == nil) {
        return ok(OkResponse(
            ok: false,
            error: "debug_image_out only applies to pixel clicks with x and y."
        ))
    }

    if let resolved = resolveElement(pid: req.pid, appName: req.appName,
                                     elementId: req.elementId,
                                     element: req.element ?? req.elementIndex,
                                     windowId: req.windowId) {
        let element = resolved.element
        if button == "left" && clickCount == 1 && modifiers.isEmpty {
            let result = AXTree.performAction(element, action: kAXPressAction as String)
            if result == .success {
                return ok(OkResponse())
            }
        }
        guard let center = AXTree.getElementCenter(element) else {
            return ok(OkResponse(ok: false, error: "Cannot determine element position"))
        }
        clickRepeated(
            x: center.x,
            y: center.y,
            button: button,
            clickCount: clickCount,
            pid: resolved.pid,
            windowId: req.windowId,
            modifiers: modifiers
        )
        return ok(OkResponse())
    }

    let targetPid = resolvePid(pid: req.pid, appName: req.appName)
    let zoomPoint = resolveZoomPoint(req)
    if let error = zoomPoint.error {
        return ok(OkResponse(ok: false, error: error))
    }
    if let debugImageOut = req.debugImageOut {
        guard let targetPid else {
            return ok(OkResponse(
                ok: false,
                error: "debug_image_out requires pid or app_name."
            ))
        }
        guard let debugX = zoomPoint.x ?? req.x,
              let debugY = zoomPoint.y ?? req.y
        else {
            return ok(OkResponse(
                ok: false,
                error: "debug_image_out requires x and y."
            ))
        }
        if let error = Screenshot.writeDebugCrosshair(
            pid: targetPid,
            windowId: req.windowId,
            captureId: zoomPoint.captureId ?? req.captureId,
            x: debugX,
            y: debugY,
            coordinateSpace: zoomPoint.coordinateSpace ?? req.coordinateSpace,
            outputPath: debugImageOut,
            maxImageDimension: req.maxImageDimension ?? 0
        ) {
            return ok(OkResponse(ok: false, error: error))
        }
    }
    let point = resolvePoint(
        x: zoomPoint.x ?? req.x,
        y: zoomPoint.y ?? req.y,
        captureId: zoomPoint.captureId ?? req.captureId,
        coordinateSpace: zoomPoint.coordinateSpace ?? req.coordinateSpace,
        pid: req.pid,
        appName: req.appName,
        windowId: req.windowId
    )
    if let error = point.error {
        return ok(OkResponse(ok: false, error: error))
    }
    if let resolvedPoint = point.point {
        clickRepeated(
            x: resolvedPoint.x,
            y: resolvedPoint.y,
            button: button,
            clickCount: clickCount,
            pid: targetPid,
            windowId: req.windowId,
            modifiers: modifiers
        )
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide element/element_id with pid/app_name or x+y coordinates"))
}

func handleSetValue(_ req: SetValueRequest) -> (Int, Data) {
    guard let resolved = resolveElement(
        pid: req.pid,
        appName: req.appName,
        elementId: req.elementId,
        element: req.element ?? req.elementIndex,
        windowId: req.windowId
    ) else {
        return ok(OkResponse(ok: false, error: "Element not found"))
    }

    let result = AXTree.setValue(resolved.element, value: req.value)
    if result == .success {
        return ok(OkResponse())
    }
    return ok(OkResponse(ok: false, error: "AXSetValue failed: \(result.rawValue)"))
}

func handlePerformAction(_ req: PerformActionRequest) -> (Int, Data) {
    guard let resolved = resolveElement(
        pid: req.pid,
        appName: req.appName,
        elementId: req.elementId,
        element: req.element ?? req.elementIndex,
        windowId: req.windowId
    ) else {
        return ok(OkResponse(ok: false, error: "Element not found"))
    }

    let result = AXTree.performAction(resolved.element, action: req.action)
    if result == .success {
        return ok(OkResponse())
    }
    return ok(OkResponse(ok: false, error: "AX action failed: \(result.rawValue)"))
}

func handleScroll(_ req: ScrollRequest) -> (Int, Data) {
    if let resolved = resolveElement(pid: req.pid, appName: req.appName,
                                     elementId: req.elementId,
                                     element: req.element ?? req.elementIndex,
                                     windowId: req.windowId) {
        guard let center = AXTree.getElementCenter(resolved.element) else {
            return ok(OkResponse(ok: false, error: "Element not found"))
        }
        let amount = Int32(req.amount ?? 3)
        var dx: Int32 = 0
        var dy: Int32 = 0
        if req.dx != nil || req.dy != nil {
            dx = Int32(req.dx ?? 0)
            dy = Int32(req.dy ?? 0)
        } else {
            switch req.direction {
            case "up": dy = amount
            case "down": dy = -amount
            case "left": dx = amount
            case "right": dx = -amount
            default:
                return ok(OkResponse(ok: false, error: "Provide direction or dx/dy for scroll."))
            }
        }

        InputSimulator.scroll(
            x: center.x,
            y: center.y,
            dx: dx,
            dy: dy,
            pid: resolved.pid,
            windowId: req.windowId
        )
        return ok(OkResponse())
    }

    let targetPid = resolvePid(pid: req.pid, appName: req.appName)
    let point = resolvePoint(
        x: req.x,
        y: req.y,
        captureId: req.captureId,
        coordinateSpace: req.coordinateSpace,
        pid: req.pid,
        appName: req.appName,
        windowId: req.windowId
    )
    if let error = point.error {
        return ok(OkResponse(ok: false, error: error))
    }
    if let resolvedPoint = point.point {
        let amount = Int32(req.amount ?? 3)
        var dx: Int32 = 0
        var dy: Int32 = 0
        if req.dx != nil || req.dy != nil {
            dx = Int32(req.dx ?? 0)
            dy = Int32(req.dy ?? 0)
        } else {
            switch req.direction {
            case "up": dy = amount
            case "down": dy = -amount
            case "left": dx = amount
            case "right": dx = -amount
            default:
                return ok(OkResponse(ok: false, error: "Provide direction or dx/dy for scroll."))
            }
        }
        InputSimulator.scroll(
            x: resolvedPoint.x, y: resolvedPoint.y,
            dx: dx,
            dy: dy,
            pid: targetPid,
            windowId: req.windowId
        )
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide element_id+pid or x+y+dx+dy"))
}

func handleDrag(_ req: DragRequest) -> (Int, Data) {
    if (req.fromElementId != nil || req.fromElement != nil || req.fromElementIndex != nil) &&
        (req.toElementId != nil || req.toElement != nil || req.toElementIndex != nil) {
        guard let fromResolved = resolveElement(pid: req.pid, appName: req.appName,
                                                elementId: req.fromElementId,
                                                element: req.fromElement ?? req.fromElementIndex,
                                                windowId: req.windowId),
              let toResolved = resolveElement(pid: req.pid, appName: req.appName,
                                              elementId: req.toElementId,
                                              element: req.toElement ?? req.toElementIndex,
                                              windowId: req.windowId),
              let fromCenter = AXTree.getElementCenter(fromResolved.element),
              let toCenter = AXTree.getElementCenter(toResolved.element)
        else {
            return ok(OkResponse(ok: false, error: "Element(s) not found"))
        }
        InputSimulator.stopRequested = false
        InputSimulator.drag(fromX: fromCenter.x, fromY: fromCenter.y,
                            toX: toCenter.x, toY: toCenter.y,
                            pid: fromResolved.pid,
                            windowId: req.windowId)
        return ok(OkResponse())
    }

    let fromX = req.fromX ?? req.startX
    let fromY = req.fromY ?? req.startY
    let toX = req.toX ?? req.endX
    let toY = req.toY ?? req.endY

    if let fx = fromX, let fy = fromY, let tx = toX, let ty = toY {
        let targetPid = resolvePid(pid: req.pid, appName: req.appName)
        let fromResolution = resolvePoint(x: fx, y: fy, captureId: req.captureId,
                                          coordinateSpace: req.coordinateSpace,
                                          pid: req.pid, appName: req.appName,
                                          windowId: req.windowId)
        let toResolution = resolvePoint(x: tx, y: ty, captureId: req.captureId,
                                        coordinateSpace: req.coordinateSpace,
                                        pid: req.pid, appName: req.appName,
                                        windowId: req.windowId)
        if let error = fromResolution.error ?? toResolution.error {
            return ok(OkResponse(ok: false, error: error))
        }
        let fromPoint = fromResolution.point ?? CGPoint(x: fx, y: fy)
        let toPoint = toResolution.point ?? CGPoint(x: tx, y: ty)
        InputSimulator.stopRequested = false
        InputSimulator.drag(fromX: fromPoint.x, fromY: fromPoint.y,
                            toX: toPoint.x, toY: toPoint.y,
                            pid: targetPid,
                            windowId: req.windowId)
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide from/to coordinates or element IDs"))
}

// MARK: - Helpers

func resolvePid(pid: Int32?, appName: String?) -> Int32? {
    if let pid = pid {
        return pid
    }
    if let appName = appName {
        return AppLister.resolvePid(appName: appName)
    }
    return nil
}

func normalizeCaptureMode(_ value: String?) -> String {
    switch value {
    case "vision", "screenshot":
        return "vision"
    case "ax":
        return "ax"
    default:
        return "som"
    }
}

func resolveElement(
    pid: Int32?,
    appName: String?,
    elementId: String?,
    element: Int?,
    windowId: UInt32? = nil
) -> (pid: Int32, element: AXUIElement)? {
    guard let pid = resolvePid(pid: pid, appName: appName) else {
        return nil
    }

    if let elementId = elementId,
       let axElement = AXTree.resolveElement(pid: pid, elementId: elementId) {
        return (pid, axElement)
    }
    if let element = element,
       let windowId = windowId,
       let axElement = AXTree.resolveElement(pid: pid, windowId: windowId, elementIndex: element) {
        return (pid, axElement)
    }
    if let element = element,
       let axElement = AXTree.resolveElement(pid: pid, elementIndex: element) {
        return (pid, axElement)
    }
    return nil
}

func resolveCachedElement(pid: Int32?, windowId: UInt32?, elementIndex: Int?) -> AXUIElement? {
    guard let pid, let windowId, let elementIndex else {
        return nil
    }
    return AXTree.resolveElement(pid: pid, windowId: windowId, elementIndex: elementIndex)
}

func resolvePoint(
    x: Double?,
    y: Double?,
    captureId: String?,
    coordinateSpace: String?,
    pid: Int32?,
    appName: String?,
    windowId: UInt32?
) -> (point: CGPoint?, error: String?) {
    guard let x = x, let y = y else {
        return (nil, nil)
    }

    if coordinateSpace == "screenshot" {
        guard let resolvedPid = resolvePid(pid: pid, appName: appName) else {
            return (nil, "screenshot coordinates require pid or app_name")
        }

        let screenshot: ScreenshotInfo?
        if let captureId = captureId {
            guard let latest = Screenshot.latestCapture(pid: resolvedPid, windowId: windowId) else {
                return (nil, "No current screenshot capture for target app. Call get_app_state again and retry with the returned capture_id.")
            }
            guard latest.captureId == captureId else {
                return (nil, "Stale screenshot capture_id. Call get_app_state again and retry with the current capture_id.")
            }
            screenshot = latest
        } else {
            screenshot = Screenshot.latestCapture(pid: resolvedPid, windowId: windowId)
                ?? windowId.map {
                    Screenshot.captureWindow(pid: resolvedPid, windowID: CGWindowID($0), windowFrame: nil)
                } ?? Screenshot.captureWindow(pid: resolvedPid, windowFrame: nil)
        }

        guard let screenshot = screenshot,
              let frame = screenshot.windowFrame,
              screenshot.scale > 0
        else {
            return (nil, "No current screenshot capture for target app. Call get_app_state again.")
        }
        if x < 0 || y < 0 ||
            x >= Double(screenshot.pixelSize.width) ||
            y >= Double(screenshot.pixelSize.height) {
            return (
                nil,
                "screenshot coordinates are outside the latest capture bounds (\(screenshot.pixelSize.width)x\(screenshot.pixelSize.height)). Call get_app_state again and retry."
            )
        }
        return (CGPoint(x: frame.x + x / screenshot.scale, y: frame.y + y / screenshot.scale), nil)
    }

    if coordinateSpace == "window" {
        guard let resolvedPid = resolvePid(pid: pid, appName: appName) else {
            return (nil, "window coordinates require pid/app_name with an accessible window")
        }
        let frame = windowId.flatMap {
            WindowEnumerator.window(windowId: $0, pid: resolvedPid)?.bounds
        } ?? AXTree.primaryWindowFrame(pid: resolvedPid)
        guard let frame else {
            return (nil, "window coordinates require pid/app_name with an accessible window")
        }
        return (CGPoint(x: frame.x + x, y: frame.y + y), nil)
    }

    return (CGPoint(x: x, y: y), nil)
}

func resolveZoomPoint(_ req: ClickRequest) -> (
    x: Double?,
    y: Double?,
    captureId: String?,
    coordinateSpace: String?,
    error: String?
) {
    guard req.fromZoom == true else {
        return (nil, nil, nil, nil, nil)
    }
    guard let pid = resolvePid(pid: req.pid, appName: req.appName) else {
        return (nil, nil, nil, nil, "from_zoom requires pid or app_name")
    }
    guard let x = req.x, let y = req.y else {
        return (nil, nil, nil, nil, "from_zoom requires x and y")
    }
    guard let zoom = Screenshot.latestZoom(pid: pid) else {
        return (nil, nil, nil, nil, "No zoom context for target app. Call zoom first.")
    }
    return (
        x + zoom.originX,
        y + zoom.originY,
        zoom.sourceCaptureId,
        "screenshot",
        nil
    )
}

func clickRepeated(
    x: Double,
    y: Double,
    button: String,
    clickCount: Int,
    pid: Int32?,
    windowId: UInt32?,
    modifiers: [String]
) {
    if button == "double" {
        try? InputSimulator.click(
            x: x,
            y: y,
            button: "double",
            pid: pid,
            windowId: windowId,
            modifiers: modifiers
        )
        return
    }
    for _ in 0..<clickCount {
        try? InputSimulator.click(
            x: x,
            y: y,
            button: button,
            pid: pid,
            windowId: windowId,
            modifiers: modifiers
        )
        usleep(50_000)
    }
}

func decode<T: Decodable>(_ data: Data?) throws -> T {
    guard let data = data else {
        throw DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "Missing request body")
        )
    }
    return try sharedDecoder.decode(T.self, from: data)
}

func decodeOrDefault<T: Decodable>(_ data: Data?, defaultValue: T) throws -> T {
    guard let data = data, !data.isEmpty else {
        return defaultValue
    }
    return try sharedDecoder.decode(T.self, from: data)
}

func ok<T: Encodable>(_ value: T) -> (Int, Data) {
    return (200, try! sharedEncoder.encode(value))
}
