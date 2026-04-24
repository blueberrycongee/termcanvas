import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum Screenshot {
    private static let outputDir = "/tmp/termcanvas-cu"

    static func captureWindow(pid: Int32) -> String? {
        let fm = FileManager.default
        if !fm.fileExists(atPath: outputDir) {
            try? fm.createDirectory(atPath: outputDir, withIntermediateDirectories: true)
        }

        guard let windowList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
        ) as? [[String: Any]] else {
            return nil
        }

        var targetWindowID: CGWindowID?
        for window in windowList {
            guard let ownerPID = window[kCGWindowOwnerPID as String] as? Int32,
                  ownerPID == pid,
                  let windowID = window[kCGWindowNumber as String] as? Int
            else { continue }

            let layer = window[kCGWindowLayer as String] as? Int ?? 0
            if layer == 0 {
                targetWindowID = CGWindowID(windowID)
                break
            }
        }

        guard let windowID = targetWindowID else { return nil }

        guard let image = CGWindowListCreateImage(
            .null,
            .optionIncludingWindow,
            windowID,
            [.boundsIgnoreFraming]
        ) else {
            return nil
        }

        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let path = "\(outputDir)/\(pid)_\(timestamp).png"
        let url = URL(fileURLWithPath: path) as CFURL

        guard let dest = CGImageDestinationCreateWithURL(
            url, UTType.png.identifier as CFString, 1, nil
        ) else {
            return nil
        }

        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }

        return path
    }
}
