import CoreGraphics
import Foundation

enum FocusWithoutRaise {
    @discardableResult
    static func activateWithoutRaise(targetPid: pid_t, targetWindowId: CGWindowID) -> Bool {
        guard SkyLightEventPost.isFocusWithoutRaiseAvailable else {
            return false
        }

        var previousPSN = [UInt32](repeating: 0, count: 2)
        var targetPSN = [UInt32](repeating: 0, count: 2)

        let previousOk = previousPSN.withUnsafeMutableBytes { raw in
            SkyLightEventPost.getFrontProcess(raw.baseAddress!)
        }
        guard previousOk else { return false }

        let targetOk = targetPSN.withUnsafeMutableBytes { raw in
            SkyLightEventPost.getProcessPSN(forPid: targetPid, into: raw.baseAddress!)
        }
        guard targetOk else { return false }

        var record = [UInt8](repeating: 0, count: 0xF8)
        record[0x04] = 0xF8
        record[0x08] = 0x0D
        let windowId = UInt32(targetWindowId)
        record[0x3C] = UInt8(windowId & 0xFF)
        record[0x3D] = UInt8((windowId >> 8) & 0xFF)
        record[0x3E] = UInt8((windowId >> 16) & 0xFF)
        record[0x3F] = UInt8((windowId >> 24) & 0xFF)

        record[0x8A] = 0x02
        let defocusOk = previousPSN.withUnsafeBytes { psnRaw in
            record.withUnsafeBufferPointer { recordRaw in
                SkyLightEventPost.postEventRecordTo(
                    psn: psnRaw.baseAddress!,
                    bytes: recordRaw.baseAddress!
                )
            }
        }

        record[0x8A] = 0x01
        let focusOk = targetPSN.withUnsafeBytes { psnRaw in
            record.withUnsafeBufferPointer { recordRaw in
                SkyLightEventPost.postEventRecordTo(
                    psn: psnRaw.baseAddress!,
                    bytes: recordRaw.baseAddress!
                )
            }
        }

        return defocusOk && focusOk
    }
}
