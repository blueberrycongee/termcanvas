import AppKit
import CoreGraphics
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
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

    static func captureWindow(
        pid: Int32,
        windowFrame: Frame?,
        maxImageDimension: Int = 0
    ) -> ScreenshotInfo? {
        guard let target = firstLayerZeroWindow(pid: pid) else { return nil }
        return captureWindow(
            pid: pid,
            windowID: target.windowID,
            windowFrame: target.frame ?? windowFrame,
            maxImageDimension: maxImageDimension
        )
    }

    static func captureWindow(
        pid: Int32,
        windowID: CGWindowID,
        windowFrame: Frame?,
        maxImageDimension: Int = 0
    ) -> ScreenshotInfo? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: outputDir) {
            try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        }

        let targetWindowFrame = WindowEnumerator
            .window(windowId: UInt32(windowID), pid: pid)?
            .bounds ?? windowFrame

        let capture = captureWindowImage(windowID: windowID, windowFrame: targetWindowFrame)
        guard let capturedImage = capture.image else { return nil }
        let image = resizeIfNeeded(capturedImage, maxDimension: maxImageDimension)

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
            coordinateSpace: "screenshot",
            captureBackend: capture.backend
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

        let capture = captureMainDisplayImage()
        guard let image = capture.image else { return nil }

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
            coordinateSpace: "screen",
            captureBackend: capture.backend
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
            coordinateSpace: "zoom",
            captureBackend: source.captureBackend
        )
    }

    private static func captureWindowImage(
        windowID: CGWindowID,
        windowFrame: Frame?
    ) -> (image: CGImage?, backend: String) {
        if #available(macOS 14.0, *),
           let image = captureWindowWithScreenCaptureKit(windowID: windowID, windowFrame: windowFrame) {
            return (image, "screen_capture_kit")
        }
        return (
            CGWindowListCreateImage(
                .null,
                .optionIncludingWindow,
                windowID,
                [.boundsIgnoreFraming]
            ),
            "core_graphics"
        )
    }

    private static func captureMainDisplayImage() -> (image: CGImage?, backend: String) {
        if #available(macOS 14.0, *),
           let image = captureMainDisplayWithScreenCaptureKit() {
            return (image, "screen_capture_kit")
        }
        return (CGDisplayCreateImage(CGMainDisplayID()), "core_graphics")
    }

    @available(macOS 14.0, *)
    private static func captureWindowWithScreenCaptureKit(
        windowID: CGWindowID,
        windowFrame: Frame?
    ) -> CGImage? {
        return runScreenCaptureKit {
            let content = try await SCShareableContent.current
            guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
                return nil
            }

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let config = SCStreamConfiguration()
            let frame = windowFrame.map {
                CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
            } ?? window.frame
            let scale = displayScale(for: frame)
            config.width = max(1, Int(frame.width * scale))
            config.height = max(1, Int(frame.height * scale))
            config.showsCursor = false
            return try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: config
            )
        }
    }

    @available(macOS 14.0, *)
    private static func captureMainDisplayWithScreenCaptureKit() -> CGImage? {
        return runScreenCaptureKit {
            let content = try await SCShareableContent.current
            guard let display = content.displays.first else { return nil }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            config.width = display.width
            config.height = display.height
            config.showsCursor = true
            return try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: config
            )
        }
    }

    @available(macOS 14.0, *)
    private static func runScreenCaptureKit(
        _ operation: @escaping () async throws -> CGImage?
    ) -> CGImage? {
        let semaphore = DispatchSemaphore(value: 0)
        let resultQueue = DispatchQueue(label: "termcanvas.sck.capture.result")
        var image: CGImage?

        Task {
            let captured = try? await operation()
            resultQueue.sync { image = captured }
            semaphore.signal()
        }

        semaphore.wait()
        return resultQueue.sync { image }
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

    private static func displayScale(for frame: CGRect) -> CGFloat {
        var bestScreen: NSScreen?
        var bestArea: CGFloat = 0
        for screen in NSScreen.screens {
            let intersection = screen.frame.intersection(frame)
            guard !intersection.isNull else { continue }
            let area = intersection.width * intersection.height
            if area > bestArea {
                bestArea = area
                bestScreen = screen
            }
        }
        return (bestScreen ?? NSScreen.main)?.backingScaleFactor ?? 1
    }

    private static func resizeIfNeeded(_ image: CGImage, maxDimension: Int) -> CGImage {
        guard maxDimension > 0, max(image.width, image.height) > maxDimension else {
            return image
        }
        let scale = Double(maxDimension) / Double(max(image.width, image.height))
        let width = max(1, Int(Double(image.width) * scale))
        let height = max(1, Int(Double(image.height) * scale))
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue |
                CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return image
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage() ?? image
    }
}
