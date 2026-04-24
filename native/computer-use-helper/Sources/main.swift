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
    let server = try HTTPServer(port: port, token: token)

    server.routeHandler = { method, path, headers, body in
        return route(method: method, path: path, body: body)
    }

    server.start()
} catch {
    fputs("Failed to start server: \(error)\n", stderr)
    exit(1)
}

dispatchMain()

// MARK: - Router

func route(method: String, path: String, body: Data?) -> (Int, Data) {
    do {
        switch path {
        case "/health":
            return ok(HealthResponse(ok: true, version: "0.1.0"))

        case "/status":
            return ok(handleStatus())

        case "/list_apps":
            return ok(ListAppsResponse(apps: AppLister.listApps()))

        case "/open_app":
            let req: OpenAppRequest = try decode(body)
            return ok(AppLister.openApp(bundleId: req.bundleId, name: req.name))

        case "/get_app_state":
            let req: GetAppStateRequest = try decode(body)
            let state = AXTree.getAppState(
                pid: req.pid,
                includeScreenshot: req.includeScreenshot ?? false,
                maxDepth: req.maxDepth ?? 4
            )
            return ok(state)

        case "/click":
            let req: ClickRequest = try decode(body)
            return handleClick(req)

        case "/type_text":
            let req: TypeTextRequest = try decode(body)
            InputSimulator.stopRequested = false
            InputSimulator.typeText(req.text)
            return ok(OkResponse())

        case "/press_key":
            let req: PressKeyRequest = try decode(body)
            InputSimulator.pressKey(req.key, modifiers: req.modifiers ?? [])
            return ok(OkResponse())

        case "/scroll":
            let req: ScrollRequest = try decode(body)
            return handleScroll(req)

        case "/drag":
            let req: DragRequest = try decode(body)
            return handleDrag(req)

        case "/stop":
            InputSimulator.stopRequested = true
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
    return StatusResponse(accessibilityGranted: axTrusted, screenRecordingGranted: screenGranted)
}

func handleClick(_ req: ClickRequest) -> (Int, Data) {
    let button = req.button ?? "left"

    if let elementId = req.elementId, let pid = req.pid {
        guard let element = AXTree.resolveElement(pid: pid, elementId: elementId) else {
            return ok(OkResponse(ok: false, error: "Element not found: \(elementId)"))
        }

        if button == "left" {
            let result = AXTree.performAction(element, action: kAXPressAction as String)
            if result == .success {
                return ok(OkResponse())
            }
        }

        guard let center = AXTree.getElementCenter(element) else {
            return ok(OkResponse(ok: false, error: "Cannot determine element position"))
        }
        try? InputSimulator.click(x: center.x, y: center.y, button: button)
        return ok(OkResponse())
    }

    if let x = req.x, let y = req.y {
        try? InputSimulator.click(x: x, y: y, button: button)
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide element_id+pid or x+y coordinates"))
}

func handleScroll(_ req: ScrollRequest) -> (Int, Data) {
    if let elementId = req.elementId, let pid = req.pid {
        guard let element = AXTree.resolveElement(pid: pid, elementId: elementId),
              let center = AXTree.getElementCenter(element)
        else {
            return ok(OkResponse(ok: false, error: "Element not found"))
        }

        let amount = Int32(req.amount ?? 3)
        var dx: Int32 = 0
        var dy: Int32 = 0
        switch req.direction {
        case "up": dy = amount
        case "down": dy = -amount
        case "left": dx = amount
        case "right": dx = -amount
        default: break
        }

        InputSimulator.scroll(x: center.x, y: center.y, dx: dx, dy: dy)
        return ok(OkResponse())
    }

    if let x = req.x, let y = req.y {
        InputSimulator.scroll(
            x: x, y: y,
            dx: Int32(req.dx ?? 0),
            dy: Int32(req.dy ?? 0)
        )
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide element_id+pid or x+y+dx+dy"))
}

func handleDrag(_ req: DragRequest) -> (Int, Data) {
    if let fromId = req.fromElementId, let toId = req.toElementId, let pid = req.pid {
        guard let fromEl = AXTree.resolveElement(pid: pid, elementId: fromId),
              let toEl = AXTree.resolveElement(pid: pid, elementId: toId),
              let fromCenter = AXTree.getElementCenter(fromEl),
              let toCenter = AXTree.getElementCenter(toEl)
        else {
            return ok(OkResponse(ok: false, error: "Element(s) not found"))
        }
        InputSimulator.stopRequested = false
        InputSimulator.drag(fromX: fromCenter.x, fromY: fromCenter.y,
                            toX: toCenter.x, toY: toCenter.y)
        return ok(OkResponse())
    }

    if let fx = req.fromX, let fy = req.fromY, let tx = req.toX, let ty = req.toY {
        InputSimulator.stopRequested = false
        InputSimulator.drag(fromX: fx, fromY: fy, toX: tx, toY: ty)
        return ok(OkResponse())
    }

    return ok(OkResponse(ok: false, error: "Provide from/to coordinates or element IDs"))
}

// MARK: - Helpers

func decode<T: Decodable>(_ data: Data?) throws -> T {
    guard let data = data else {
        throw DecodingError.dataCorrupted(
            DecodingError.Context(codingPath: [], debugDescription: "Missing request body")
        )
    }
    return try sharedDecoder.decode(T.self, from: data)
}

func ok<T: Encodable>(_ value: T) -> (Int, Data) {
    return (200, try! sharedEncoder.encode(value))
}
