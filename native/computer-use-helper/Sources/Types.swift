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
    let skylightPostToPidAvailable: Bool
    let focusWithoutRaiseAvailable: Bool
    let windowLocationAvailable: Bool
    let screenCaptureKitAvailable: Bool
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

// MARK: - List Windows

struct ListWindowsRequest: Codable {
    let pid: Int32?
    let onScreenOnly: Bool?
}

struct WindowServerWindowInfo: Codable {
    let windowId: Int
    let pid: Int32
    let appName: String
    let title: String
    let bounds: Frame
    let layer: Int
    let zIndex: Int
    let isOnScreen: Bool
    let onCurrentSpace: Bool?
    let spaceIds: [UInt64]?
}

struct ListWindowsResponse: Codable {
    let windows: [WindowServerWindowInfo]
    let currentSpaceId: UInt64?
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
    let pid: Int32?
    let appName: String?
    let includeScreenshot: Bool?
    let maxDepth: Int?
    let captureMode: String?
    let maxImageDimension: Int?
}

struct GetWindowStateRequest: Codable {
    let pid: Int32
    let windowId: UInt32
    let includeScreenshot: Bool?
    let maxDepth: Int?
    let captureMode: String?
    let maxImageDimension: Int?
}

// MARK: - Screenshot / Screen

struct ScreenshotRequest: Codable {
    let pid: Int32?
    let windowId: UInt32?
}

struct ZoomRequest: Codable {
    let pid: Int32
    let captureId: String?
    let x1: Double
    let y1: Double
    let x2: Double
    let y2: Double
}

struct ScreenSizeResponse: Codable {
    let width: Int
    let height: Int
    let scale: Double
}

struct Frame: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct WindowInfo: Codable {
    let id: String
    let windowId: UInt32?
    let title: String?
    let frame: Frame
    let onCurrentSpace: Bool?
    let spaceIds: [UInt64]?

    init(
        id: String,
        windowId: UInt32? = nil,
        title: String?,
        frame: Frame,
        onCurrentSpace: Bool? = nil,
        spaceIds: [UInt64]? = nil
    ) {
        self.id = id
        self.windowId = windowId
        self.title = title
        self.frame = frame
        self.onCurrentSpace = onCurrentSpace
        self.spaceIds = spaceIds
    }
}

struct PixelSize: Codable {
    let width: Int
    let height: Int
}

struct ScreenshotInfo: Codable {
    let captureId: String
    let path: String
    let pixelSize: PixelSize
    let scale: Double
    let windowFrame: Frame?
    let coordinateSpace: String
    let captureBackend: String?
}

struct ElementInfo: Codable {
    let index: Int
    let id: String
    let role: String
    let subrole: String?
    let label: String?
    let title: String?
    let description: String?
    let value: String?
    let frame: Frame?
    let enabled: Bool?
    let focused: Bool?
    let selected: Bool?
    let expanded: Bool?
    let help: String?
    let actions: [String]
}

struct AccessibilityNode: Codable {
    let index: Int
    let id: String
    let role: String
    let subrole: String?
    let label: String?
    let title: String?
    let description: String?
    let value: String?
    let frame: Frame?
    let enabled: Bool?
    let focused: Bool?
    let selected: Bool?
    let expanded: Bool?
    let help: String?
    let actions: [String]
    let children: [AccessibilityNode]
}

struct AppSummary: Codable {
    let name: String
    let bundleId: String?
    let pid: Int32
}

struct AppStateResponse: Codable {
    let app: AppSummary
    let windows: [WindowInfo]
    let currentSpaceId: UInt64?
    let elements: [ElementInfo]
    let accessibilityTree: [AccessibilityNode]
    let screenshotPath: String?
    let screenshot: ScreenshotInfo?
    let screenshotCaptureId: String?
    let screenshotPixelSize: PixelSize?
    let screenshotScale: Double?
    let windowFrame: Frame?
    let coordinateSpace: String
}

// MARK: - Click

struct ClickRequest: Codable {
    let elementId: String?
    let element: Int?
    let elementIndex: Int?
    let windowId: UInt32?
    let pid: Int32?
    let appName: String?
    let x: Double?
    let y: Double?
    let captureId: String?
    let coordinateSpace: String?
    let button: String?
    let mouseButton: String?
    let clickCount: Int?
    let modifiers: [String]?
    let modifier: [String]?
    let fromZoom: Bool?
    let debugImageOut: String?
    let maxImageDimension: Int?
}

struct MoveCursorRequest: Codable {
    let pid: Int32?
    let appName: String?
    let windowId: UInt32?
    let x: Double
    let y: Double
    let captureId: String?
    let coordinateSpace: String?
}

// MARK: - Type Text

struct TypeTextRequest: Codable {
    let text: String
    let pid: Int32?
    let windowId: UInt32?
    let elementIndex: Int?
}

// MARK: - Press Key

struct PressKeyRequest: Codable {
    let key: String
    let modifiers: [String]?
    let pid: Int32?
    let windowId: UInt32?
    let elementIndex: Int?
}

// MARK: - Set Value / Actions

struct SetValueRequest: Codable {
    let elementId: String?
    let element: Int?
    let elementIndex: Int?
    let windowId: UInt32?
    let pid: Int32?
    let appName: String?
    let value: String
}

struct PerformActionRequest: Codable {
    let elementId: String?
    let element: Int?
    let elementIndex: Int?
    let windowId: UInt32?
    let pid: Int32?
    let appName: String?
    let action: String
}

// MARK: - Scroll

struct ScrollRequest: Codable {
    let x: Double?
    let y: Double?
    let dx: Double?
    let dy: Double?
    let elementId: String?
    let element: Int?
    let elementIndex: Int?
    let windowId: UInt32?
    let pid: Int32?
    let appName: String?
    let direction: String?
    let amount: Double?
    let captureId: String?
    let coordinateSpace: String?
}

// MARK: - Drag

struct DragRequest: Codable {
    let fromX: Double?
    let fromY: Double?
    let toX: Double?
    let toY: Double?
    let startX: Double?
    let startY: Double?
    let endX: Double?
    let endY: Double?
    let fromElementId: String?
    let toElementId: String?
    let fromElement: Int?
    let toElement: Int?
    let fromElementIndex: Int?
    let toElementIndex: Int?
    let windowId: UInt32?
    let pid: Int32?
    let appName: String?
    let captureId: String?
    let coordinateSpace: String?
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
