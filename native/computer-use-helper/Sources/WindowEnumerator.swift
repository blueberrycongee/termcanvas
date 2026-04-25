import CoreGraphics
import Foundation

enum WindowEnumerator {
    static func listWindows(pid: Int32? = nil, onScreenOnly: Bool = false) -> ListWindowsResponse {
        let currentSpaceId = SpaceInspector.currentSpaceId()
        let windows = allWindows(currentSpaceId: currentSpaceId)
            .filter { $0.layer == 0 }
            .filter { info in
                guard let pid else { return true }
                return info.pid == pid
            }
            .filter { info in
                !onScreenOnly || info.isOnScreen
            }
        return ListWindowsResponse(windows: windows, currentSpaceId: currentSpaceId)
    }

    static func allWindows(currentSpaceId: UInt64? = SpaceInspector.currentSpaceId()) -> [WindowServerWindowInfo] {
        guard let list = CGWindowListCopyWindowInfo(
            [.optionAll, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else {
            return []
        }

        var rows: [WindowServerWindowInfo] = []
        for (index, window) in list.enumerated() {
            guard let windowId = window[kCGWindowNumber as String] as? Int,
                  let ownerPid = window[kCGWindowOwnerPID as String] as? Int32
            else {
                continue
            }

            let bounds = frameFromCGWindowBounds(window[kCGWindowBounds as String])
                ?? Frame(x: 0, y: 0, width: 0, height: 0)
            let layer = window[kCGWindowLayer as String] as? Int ?? 0
            let ownerName = window[kCGWindowOwnerName as String] as? String ?? ""
            let title = window[kCGWindowName as String] as? String ?? ""
            let isOnScreen = (window[kCGWindowIsOnscreen as String] as? Bool) ?? false

            let spaceIds = SpaceInspector.spaceIds(windowId: UInt32(windowId))
            let onCurrentSpace = currentSpaceId.flatMap { current in
                spaceIds.map { $0.contains(current) }
            }

            rows.append(WindowServerWindowInfo(
                windowId: windowId,
                pid: ownerPid,
                appName: ownerName,
                title: title,
                bounds: bounds,
                layer: layer,
                zIndex: index,
                isOnScreen: isOnScreen,
                onCurrentSpace: onCurrentSpace,
                spaceIds: spaceIds
            ))
        }
        return rows
    }

    static func window(windowId: UInt32, pid: Int32? = nil) -> WindowServerWindowInfo? {
        allWindows().first { info in
            UInt32(info.windowId) == windowId && (pid == nil || info.pid == pid)
        }
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
