import AppKit
import CoreGraphics
import Foundation

private final class CursorOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class CursorView: NSView {
    var pressed: Bool = false {
        didSet { needsDisplay = true }
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        dirtyRect.fill()

        if pressed {
            NSColor.systemBlue.withAlphaComponent(0.22).setFill()
            NSBezierPath(ovalIn: NSRect(x: 1, y: 1, width: 42, height: 42)).fill()
        }

        let cursor = NSBezierPath()
        cursor.move(to: NSPoint(x: 8, y: 6))
        cursor.line(to: NSPoint(x: 8, y: 34))
        cursor.line(to: NSPoint(x: 15.5, y: 27.5))
        cursor.line(to: NSPoint(x: 20.5, y: 39))
        cursor.line(to: NSPoint(x: 26, y: 36.6))
        cursor.line(to: NSPoint(x: 21, y: 25))
        cursor.line(to: NSPoint(x: 31, y: 25))
        cursor.close()

        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowOffset = NSSize(width: 0, height: 1)
        shadow.shadowBlurRadius = 5
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
        shadow.set()

        NSColor.white.setFill()
        cursor.fill()
        NSGraphicsContext.restoreGraphicsState()

        NSColor.black.withAlphaComponent(0.82).setStroke()
        cursor.lineWidth = 1.5
        cursor.stroke()

        NSColor.systemBlue.withAlphaComponent(0.9).setStroke()
        let accent = NSBezierPath()
        accent.move(to: NSPoint(x: 8, y: 6))
        accent.line(to: NSPoint(x: 8, y: 34))
        accent.lineWidth = 2
        accent.stroke()
    }
}

private struct CursorMotionPath {
    let start: CGPoint
    let control1: CGPoint
    let control2: CGPoint
    let end: CGPoint

    static func compute(from start: CGPoint, to end: CGPoint) -> CursorMotionPath {
        let dx = end.x - start.x
        let dy = end.y - start.y
        let distance = hypot(dx, dy)
        guard distance > 0 else {
            return CursorMotionPath(start: start, control1: start, control2: end, end: end)
        }

        let curve = min(max(distance * 0.12, 18), 120)
        let normal = CGPoint(x: -dy / distance * curve, y: dx / distance * curve)
        return CursorMotionPath(
            start: start,
            control1: CGPoint(x: start.x + dx * 0.28 + normal.x, y: start.y + dy * 0.28 + normal.y),
            control2: CGPoint(x: start.x + dx * 0.72 + normal.x, y: start.y + dy * 0.72 + normal.y),
            end: end
        )
    }

    func point(at progress: Double) -> CGPoint {
        let t = min(max(progress, 0), 1)
        let mt = 1 - t
        let a = mt * mt * mt
        let b = 3 * mt * mt * t
        let c = 3 * mt * t * t
        let d = t * t * t
        return CGPoint(
            x: start.x * a + control1.x * b + control2.x * c + end.x * d,
            y: start.y * a + control1.y * b + control2.y * c + end.y * d
        )
    }
}

final class VirtualCursor {
    static let shared = VirtualCursor()

    private let windowSize = CGSize(width: 48, height: 48)
    private let tipOffset = CGPoint(x: 8, y: 6)
    private var panel: CursorOverlayPanel?
    private var currentPoint: CGPoint?
    private var animationTimer: Timer?
    private var fadeTimer: Timer?
    private var fadeGeneration = 0

    private init() {}

    func prepare() {
        DispatchQueue.main.async {
            _ = self.ensurePanel()
        }
    }

    func moveAndWait(to point: CGPoint, animated: Bool = true) {
        if Thread.isMainThread {
            startMove(to: point, animated: animated, completion: {})
            return
        }

        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            self.startMove(to: point, animated: animated) {
                done.signal()
            }
        }
        _ = done.wait(timeout: .now() + .milliseconds(1600))
    }

    func move(to point: CGPoint, animated: Bool = false) {
        DispatchQueue.main.async {
            self.startMove(to: point, animated: animated, completion: {})
        }
    }

    func setPressed(_ pressed: Bool) {
        DispatchQueue.main.async {
            guard let view = self.ensurePanel()?.contentView as? CursorView else { return }
            view.pressed = pressed
            self.fadeTimer?.invalidate()
            if pressed {
                self.fadeGeneration += 1
            } else {
                self.scheduleFadeOut()
            }
        }
    }

    func hide() {
        DispatchQueue.main.async {
            self.animationTimer?.invalidate()
            self.fadeTimer?.invalidate()
            self.panel?.orderOut(nil)
        }
    }

    private func startMove(to point: CGPoint, animated: Bool, completion: @escaping () -> Void) {
        guard let panel = ensurePanel() else {
            completion()
            return
        }

        fadeTimer?.invalidate()
        fadeGeneration += 1
        panel.alphaValue = 1
        panel.orderFrontRegardless()

        let start = currentPoint ?? point
        currentPoint = point
        animationTimer?.invalidate()

        let distance = hypot(point.x - start.x, point.y - start.y)
        let duration = animated ? min(max(distance / 2400, 0.12), 0.7) : 0
        if duration <= 0.001 {
            positionPanel(at: point)
            completion()
            return
        }

        let path = CursorMotionPath.compute(from: start, to: point)
        let startedAt = Date().timeIntervalSinceReferenceDate
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }

            let elapsed = Date().timeIntervalSinceReferenceDate - startedAt
            let rawProgress = min(elapsed / duration, 1)
            let progress = self.easeInOut(rawProgress)
            self.positionPanel(at: path.point(at: progress))

            if rawProgress >= 1 {
                timer.invalidate()
                self.animationTimer = nil
                self.positionPanel(at: point)
                completion()
            }
        }
        animationTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func ensurePanel() -> CursorOverlayPanel? {
        if let panel = panel {
            return panel
        }

        let view = CursorView(frame: NSRect(origin: .zero, size: windowSize))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor

        let newPanel = CursorOverlayPanel(
            contentRect: NSRect(origin: .zero, size: windowSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        newPanel.isOpaque = false
        newPanel.backgroundColor = .clear
        newPanel.hasShadow = false
        newPanel.ignoresMouseEvents = true
        newPanel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.overlayWindow)))
        newPanel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle, .stationary, .fullScreenAuxiliary]
        newPanel.contentView = view

        panel = newPanel
        return newPanel
    }

    private func positionPanel(at quartzPoint: CGPoint) {
        guard let panel = ensurePanel() else { return }
        let origin = appKitWindowOrigin(for: quartzPoint)
        panel.setFrameOrigin(origin)
    }

    private func scheduleFadeOut() {
        fadeGeneration += 1
        let generation = fadeGeneration
        let timer = Timer(timeInterval: 1.25, repeats: false) { [weak self] _ in
            guard let self = self, let panel = self.panel else { return }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                panel.animator().alphaValue = 0
            } completionHandler: {
                guard self.fadeGeneration == generation else { return }
                panel.orderOut(nil)
                panel.alphaValue = 1
            }
        }
        fadeTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func easeInOut(_ t: Double) -> Double {
        if t < 0.5 {
            return 4 * t * t * t
        }
        return 1 - pow(-2 * t + 2, 3) / 2
    }

    private func appKitWindowOrigin(for quartzPoint: CGPoint) -> CGPoint {
        let topLeft = CGPoint(x: quartzPoint.x - tipOffset.x, y: quartzPoint.y - tipOffset.y)
        let screen = screenContaining(quartzPoint) ?? NSScreen.main
        guard let screen = screen else {
            return CGPoint(x: topLeft.x, y: topLeft.y)
        }

        let quartzFrame = Self.quartzFrame(for: screen)
        let appKitFrame = screen.frame
        return CGPoint(
            x: appKitFrame.minX + (topLeft.x - quartzFrame.minX),
            y: appKitFrame.minY + (quartzFrame.maxY - topLeft.y) - windowSize.height
        )
    }

    private func screenContaining(_ quartzPoint: CGPoint) -> NSScreen? {
        for screen in NSScreen.screens where Self.quartzFrame(for: screen).contains(quartzPoint) {
            return screen
        }
        return nil
    }

    private static func quartzFrame(for screen: NSScreen) -> CGRect {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        guard let number = screen.deviceDescription[key] as? NSNumber else {
            return screen.frame
        }
        return CGDisplayBounds(CGDirectDisplayID(number.uint32Value))
    }
}
