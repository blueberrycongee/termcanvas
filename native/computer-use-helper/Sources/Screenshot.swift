import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum Screenshot {
    private static let outputDir = "/tmp/termcanvas-cu"
    private static let lock = NSLock()
    private static var latestByPid: [Int32: ScreenshotInfo] = [:]

    static func latestCapture(pid: Int32) -> ScreenshotInfo? {
        lock.lock()
        defer { lock.unlock() }
        return latestByPid[pid]
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
