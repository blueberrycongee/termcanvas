// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "computer-use-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "computer-use-helper",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("AppKit"),
                .linkedFramework("ImageIO"),
                .linkedFramework("ScreenCaptureKit"),
            ]
        )
    ]
)
