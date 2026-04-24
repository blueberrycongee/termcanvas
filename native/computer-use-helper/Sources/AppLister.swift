import AppKit
import Foundation

enum AppLister {
    static func listApps() -> [AppInfo] {
        let workspace = NSWorkspace.shared
        return workspace.runningApplications
            .filter { $0.activationPolicy == .regular }
            .map { app in
                AppInfo(
                    name: app.localizedName ?? "Unknown",
                    bundleId: app.bundleIdentifier,
                    pid: app.processIdentifier,
                    isFrontmost: app.isActive
                )
            }
    }

    static func resolvePid(appName: String) -> Int32? {
        let query = appName.lowercased()
        let running = NSWorkspace.shared.runningApplications.first { app in
            app.localizedName?.lowercased() == query ||
                app.bundleIdentifier?.lowercased() == query
        }
        return running?.processIdentifier
    }

    static func openApp(bundleId: String?, name: String?) -> OpenAppResponse {
        let workspace = NSWorkspace.shared

        if let bundleId = bundleId {
            guard let appURL = workspace.urlForApplication(withBundleIdentifier: bundleId) else {
                return OpenAppResponse(ok: false, pid: nil, error: "App not found: \(bundleId)")
            }
            return launchApp(at: appURL)
        }

        if let name = name {
            let running = workspace.runningApplications.first {
                $0.localizedName?.lowercased() == name.lowercased()
            }
            if let app = running {
                app.activate()
                return OpenAppResponse(ok: true, pid: app.processIdentifier, error: nil)
            }

            let appPath = "/Applications/\(name).app"
            let appURL = URL(fileURLWithPath: appPath)
            if FileManager.default.fileExists(atPath: appPath) {
                return launchApp(at: appURL)
            }

            return OpenAppResponse(ok: false, pid: nil, error: "App not found: \(name)")
        }

        return OpenAppResponse(ok: false, pid: nil, error: "Provide bundle_id or name")
    }

    private static func launchApp(at url: URL) -> OpenAppResponse {
        let semaphore = DispatchSemaphore(value: 0)
        var resultApp: NSRunningApplication?
        var resultError: Error?

        let config = NSWorkspace.OpenConfiguration()
        config.activates = true

        NSWorkspace.shared.openApplication(at: url, configuration: config) { app, error in
            resultApp = app
            resultError = error
            semaphore.signal()
        }

        _ = semaphore.wait(timeout: .now() + 10)

        if let error = resultError {
            return OpenAppResponse(ok: false, pid: nil, error: error.localizedDescription)
        }
        if let app = resultApp {
            return OpenAppResponse(ok: true, pid: app.processIdentifier, error: nil)
        }
        return OpenAppResponse(ok: false, pid: nil, error: "Launch timed out")
    }
}
