import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum Screenshot {
    private static let outputDir = "/tmp/termcanvas-cu"
    private static let lock = NSLock()
    private static var latestByPid: [Int32: ScreenshotInfo] = [:]
    private static var latestZoomByPid: [Int32: ZoomContext] = [:]

    struct ZoomContext {
        let originX: Double
        let originY: Double
        let sourceCaptureId: String
    }

    static func latestCapture(pid: Int32) -> ScreenshotInfo? {
        lock.lock()
        defer { lock.unlock() }
        return latestByPid[pid]
    }

    static func latestZoom(pid: Int32) -> ZoomContext? {
        lock.lock()
        defer { lock.unlock() }
        return latestZoomByPid[pid]
    }

    static func captureWindow(pid: Int32, windowFrame: Frame?) -> ScreenshotInfo? {
        guard let target = firstLayerZeroWindow(pid: pid) else { return nil }
        return captureWindow(
            pid: pid,
            windowID: target.windowID,
            windowFrame: target.frame ?? windowFrame
        )
    }

    static func captureWindow(pid: Int32, windowID: CGWindowID, windowFrame: Frame?) -> ScreenshotInfo? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: outputDir) {
            try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        }

        let targetWindowFrame = WindowEnumerator
            .window(windowId: UInt32(windowID), pid: pid)?
            .bounds ?? windowFrame

        guard let image = CGWindowListCreateImage(
            .null,
            .optionIncludingWindow,
            windowID,
            [.boundsIgnoreFraming]
        ) else {
            return nil
        }

        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let captureId = "\(pid):\(windowID):\(timestamp)"
        let path = "\(outputDir)/\(pid)_\(windowID)_\(timestamp).png"
        let url = URL(fileURLWithPath: path) as CFURL

        guard let dest = CGImageDestinationCreateWithURL(
            url, UTType.png.identifier as CFString, 1, nil
        ) else {
            return nil
        }

        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }

        let pixelSize = PixelSize(width: image.width, height: image.height)
        let scale: Double
        if let frame = targetWindowFrame, frame.width > 0 {
            scale = Double(image.width) / frame.width
        } else {
            scale = 1
        }

        let info = ScreenshotInfo(
            captureId: captureId,
            path: path,
            pixelSize: pixelSize,
            scale: scale,
            windowFrame: targetWindowFrame,
            coordinateSpace: "screenshot"
        )
        lock.lock()
        latestByPid[pid] = info
        lock.unlock()
        return info
    }

    static func captureMainDisplay() -> ScreenshotInfo? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: outputDir) {
            try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        }

        guard let image = CGDisplayCreateImage(CGMainDisplayID()) else {
            return nil
        }

        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let captureId = "display:\(CGMainDisplayID()):\(timestamp)"
        let path = "\(outputDir)/display_\(timestamp).png"
        let url = URL(fileURLWithPath: path) as CFURL

        guard let dest = CGImageDestinationCreateWithURL(
            url, UTType.png.identifier as CFString, 1, nil
        ) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }

        let scale = Double(NSScreen.main?.backingScaleFactor ?? 1)
        let frame = NSScreen.main?.frame
        return ScreenshotInfo(
            captureId: captureId,
            path: path,
            pixelSize: PixelSize(width: image.width, height: image.height),
            scale: scale,
            windowFrame: frame.map {
                Frame(x: $0.origin.x, y: $0.origin.y, width: $0.width, height: $0.height)
            },
            coordinateSpace: "screen"
        )
    }

    static func zoom(
        pid: Int32,
        captureId: String?,
        x1: Double,
        y1: Double,
        x2: Double,
        y2: Double
    ) -> ScreenshotInfo? {
        guard x2 > x1, y2 > y1 else { return nil }
        guard let source = latestCapture(pid: pid) else { return nil }
        if let captureId, source.captureId != captureId {
            return nil
        }

        guard let imageSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: source.path) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
        else {
            return nil
        }

        let requested = CGRect(x: x1, y: y1, width: x2 - x1, height: y2 - y1)
        let padX = requested.width * 0.20
        let padY = requested.height * 0.20
        let padded = requested.insetBy(dx: -padX, dy: -padY)
        let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        let crop = padded.intersection(imageBounds).integral
        guard !crop.isNull, crop.width > 0, crop.height > 0,
              let cropped = image.cropping(to: crop)
        else {
            return nil
        }

        let fm = FileManager.default
        if !fm.fileExists(atPath: outputDir) {
            try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        }

        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let zoomCaptureId = "\(source.captureId):zoom:\(timestamp)"
        let path = "\(outputDir)/\(pid)_zoom_\(timestamp).png"
        let url = URL(fileURLWithPath: path) as CFURL
        guard let dest = CGImageDestinationCreateWithURL(
            url, UTType.png.identifier as CFString, 1, nil
        ) else {
            return nil
        }
        CGImageDestinationAddImage(dest, cropped, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }

        lock.lock()
        latestZoomByPid[pid] = ZoomContext(
            originX: crop.origin.x,
            originY: crop.origin.y,
            sourceCaptureId: source.captureId
        )
        lock.unlock()

        return ScreenshotInfo(
            captureId: zoomCaptureId,
            path: path,
            pixelSize: PixelSize(width: cropped.width, height: cropped.height),
            scale: source.scale,
            windowFrame: source.windowFrame,
            coordinateSpace: "zoom"
        )
    }

    private static func firstLayerZeroWindow(pid: Int32) -> (windowID: CGWindowID, frame: Frame?)? {
        guard let windowList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] else {
            return nil
        }

        for window in windowList {
            guard let ownerPID = window[kCGWindowOwnerPID as String] as? Int32,
                  ownerPID == pid,
                  let windowID = window[kCGWindowNumber as String] as? Int
            else { continue }

            let layer = window[kCGWindowLayer as String] as? Int ?? 0
            if layer == 0 {
                return (
                    CGWindowID(windowID),
                    frameFromCGWindowBounds(window[kCGWindowBounds as String])
                )
            }
        }
        return nil
    }

    private static func frameFromCGWindowBounds(_ value: Any?) -> Frame? {
        guard let bounds = value as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary)
        else {
            return nil
        }

        return Frame(
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.width,
            height: rect.height
        )
    }
}
