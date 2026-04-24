import Foundation

let sharedEncoder: JSONEncoder = {
    let e = JSONEncoder()
    e.keyEncodingStrategy = .convertToSnakeCase
    return e
}()

let sharedDecoder: JSONDecoder = {
    let d = JSONDecoder()
    d.keyDecodingStrategy = .convertFromSnakeCase
    return d
}()

// MARK: - Health

struct HealthResponse: Codable {
    let ok: Bool
    let version: String
}

// MARK: - Status

struct StatusResponse: Codable {
    let accessibilityGranted: Bool
    let screenRecordingGranted: Bool
}

// MARK: - List Apps

struct AppInfo: Codable {
    let name: String
    let bundleId: String?
    let pid: Int32
    let isFrontmost: Bool
}

struct ListAppsResponse: Codable {
    let apps: [AppInfo]
}

// MARK: - Open App

struct OpenAppRequest: Codable {
    let bundleId: String?
    let name: String?
}

struct OpenAppResponse: Codable {
    let ok: Bool
    let pid: Int32?
    let error: String?
}

// MARK: - Get App State

struct GetAppStateRequest: Codable {
    let pid: Int32
    let includeScreenshot: Bool?
    let maxDepth: Int?
}

struct Frame: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowInfo: Codable {
    let id: String
    let title: String?
    let frame: Frame
}

struct ElementInfo: Codable {
    let id: String
    let role: String
    let subrole: String?
    let title: String?
    let description: String?
    let value: String?
    let frame: Frame?
    let enabled: Bool?
    let focused: Bool?
    let actions: [String]
}

struct AppSummary: Codable {
    let name: String
    let bundleId: String?
    let pid: Int32
}

struct AppStateResponse: Codable {
    let app: AppSummary
    let windows: [WindowInfo]
    let elements: [ElementInfo]
    let screenshotPath: String?
    let coordinateSpace: String
}

// MARK: - Click

struct ClickRequest: Codable {
    let elementId: String?
    let pid: Int32?
    let x: Double?
    let y: Double?
    let coordinateSpace: String?
    let button: String?
}

// MARK: - Type Text

struct TypeTextRequest: Codable {
    let text: String
}

// MARK: - Press Key

struct PressKeyRequest: Codable {
    let key: String
    let modifiers: [String]?
}

// MARK: - Scroll

struct ScrollRequest: Codable {
    let x: Double?
    let y: Double?
    let dx: Int?
    let dy: Int?
    let elementId: String?
    let pid: Int32?
    let direction: String?
    let amount: Int?
}

// MARK: - Drag

struct DragRequest: Codable {
    let fromX: Double?
    let fromY: Double?
    let toX: Double?
    let toY: Double?
    let fromElementId: String?
    let toElementId: String?
    let pid: Int32?
}

// MARK: - Generic

struct OkResponse: Codable {
    let ok: Bool
    let error: String?

    init(ok: Bool = true, error: String? = nil) {
        self.ok = ok
        self.error = error
    }
}

struct ErrorResponse: Codable {
    let error: String
}
