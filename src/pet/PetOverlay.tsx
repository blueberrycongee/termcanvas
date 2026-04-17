import { useEffect, useRef, useCallback, useState } from "react";
import { usePetStore } from "./petStore";
import type { AttentionPriority } from "./petStore";
import { useCanvasStore } from "../stores/canvasStore";
import { SpriteRenderer } from "./SpriteRenderer";
import { getCurrentFrame, getFrameInterval } from "./sprites";
import { stepToward } from "./petMovement";
import { usePetEventBridge } from "./eventBridge";
import {
  getCanvasLeftInset,
  getCanvasRightInset,
} from "../canvas/viewportBounds";
import { C } from "./sprites/colors";
import { zzzOffsets } from "./sprites/sleeping";
import { sparklePositions } from "./sprites/celebrating";
import { PET_SIZE } from "./constants";
import { ParticleLayer, type Particle } from "./ParticleLayer";

const PRIORITY_COLORS: Record<AttentionPriority, string> = {
  error: "#EF4444",
  stuck: "#F59E0B",
  approval: "#3B82F6",
  success: "#10B981",
};

// Celebrating cadence: [crouch, peak, peak, crouch, landing, landing]
// We trigger a dust puff when the frame index crosses INTO `landing`.
const CELEBRATING_LANDING_FRAME = 4;

function spawnHearts(): Particle[] {
  const now = Date.now();
  const count = 4;
  const half = PET_SIZE / 2;
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i - (count - 1) / 2) * 0.45;
    const speed = 22 + Math.random() * 10;
    return {
      id: `heart-${now}-${i}-${Math.random().toString(36).slice(2, 5)}`,
      kind: "heart" as const,
      ox: half + (Math.random() - 0.5) * 6,
      oy: 18 + (Math.random() - 0.5) * 6,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      spawnedAt: now + i * 50,
      durationMs: 1100,
    };
  });
}

function spawnDust(): Particle[] {
  const now = Date.now();
  const baseY = PET_SIZE - 16;
  return [
    {
      id: `dust-l-${now}`,
      kind: "dust" as const,
      ox: 16,
      oy: baseY,
      dx: -16,
      dy: -6,
      spawnedAt: now,
      durationMs: 550,
    },
    {
      id: `dust-r-${now}`,
      kind: "dust" as const,
      ox: PET_SIZE - 16,
      oy: baseY,
      dx: 16,
      dy: -6,
      spawnedAt: now,
      durationMs: 550,
    },
  ];
}

function spawnWalkDust(facingRight: boolean): Particle {
  const now = Date.now();
  // Trailing foot = opposite of the facing direction.
  const trailX = facingRight ? 18 : PET_SIZE - 18;
  return {
    id: `walkdust-${now}-${Math.random().toString(36).slice(2, 5)}`,
    kind: "dust" as const,
    ox: trailX,
    oy: PET_SIZE - 14,
    dx: facingRight ? -8 : 8,
    dy: -2,
    spawnedAt: now,
    durationMs: 420,
  };
}

function spawnIdleEmote(): Particle {
  const now = Date.now();
  const roll = Math.random();
  const kind: Particle["kind"] =
    roll < 0.45 ? "heart" : roll < 0.85 ? "note" : "star";
  const dxSign = Math.random() < 0.5 ? -1 : 1;
  return {
    id: `emote-${now}-${Math.random().toString(36).slice(2, 5)}`,
    kind,
    ox: PET_SIZE / 2 + (Math.random() - 0.5) * 10,
    oy: 18 + Math.random() * 4,
    dx: dxSign * (4 + Math.random() * 10),
    dy: -28 - Math.random() * 10,
    spawnedAt: now,
    durationMs: 1400,
  };
}

export function PetOverlay() {
  usePetEventBridge();

  const stateInfo = usePetStore((s) => s.stateInfo);
  const position = usePetStore((s) => s.position);
  const moveTarget = usePetStore((s) => s.moveTarget);
  const isMoving = usePetStore((s) => s.isMoving);
  const facingRight = usePetStore((s) => s.facingRight);
  const animationFrame = usePetStore((s) => s.animationFrame);
  const showBubble = usePetStore((s) => s.showBubble);
  const bubbleText = usePetStore((s) => s.bubbleText);
  const currentAttention = usePetStore((s) => s.currentAttention);
  const attentionQueue = usePetStore((s) => s.attentionQueue);
  const isGrabbed = usePetStore((s) => s.isGrabbed);
  const isThrown = usePetStore((s) => s.isThrown);
  const rotation = usePetStore((s) => s.rotation);
  const dispatch = usePetStore((s) => s.dispatch);
  const setPosition = usePetStore((s) => s.setPosition);
  const setMoveTarget = usePetStore((s) => s.setMoveTarget);
  const setIsMoving = usePetStore((s) => s.setIsMoving);
  const setFacingRight = usePetStore((s) => s.setFacingRight);
  const advanceFrame = usePetStore((s) => s.advanceFrame);
  const showSpeechBubble = usePetStore((s) => s.showSpeechBubble);
  const grabPet = usePetStore((s) => s.grabPet);
  const dragPetTo = usePetStore((s) => s.dragPetTo);
  const releasePet = usePetStore((s) => s.releasePet);
  const tickThrow = usePetStore((s) => s.tickThrow);
  const landThrow = usePetStore((s) => s.landThrow);

  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);

  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef(0);
  const lastWalkDustRef = useRef(0);

  const [particles, setParticles] = useState<Particle[]>([]);

  const spawnParticles = useCallback((batch: Particle[]) => {
    setParticles((prev) => [...prev, ...batch]);
  }, []);

  const spawnParticle = useCallback((p: Particle) => {
    setParticles((prev) => [...prev, p]);
  }, []);

  // Main animation loop
  useEffect(() => {
    let running = true;
    let lastTickTime = performance.now();

    function tick(timestamp: number) {
      if (!running) return;
      const dt = timestamp - lastTickTime;
      lastTickTime = timestamp;

      const state = usePetStore.getState();
      const interval = getFrameInterval(
        state.isMoving ? "walking" : state.stateInfo.state,
      );

      if (timestamp - lastFrameTimeRef.current >= interval) {
        lastFrameTimeRef.current = timestamp;
        advanceFrame();
      }

      // Grabbed: user is holding the pet via mouse. All auto-move
      // paths below must be inert; position is driven entirely by
      // the grab/drag pointer handlers below.
      if (state.isGrabbed) {
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Thrown: simulate friction-decayed linear motion until the
      // velocity drops below a land threshold, then land with a
      // dust puff and hand control back to the normal loop.
      if (state.isThrown) {
        tickThrow(dt);
        const next = usePetStore.getState();
        const speed = Math.hypot(next.velocity.vx, next.velocity.vy);
        // Emit walk dust periodically while skidding; reads as
        // ground friction.
        if (speed > 60 && timestamp - lastWalkDustRef.current > 90) {
          lastWalkDustRef.current = timestamp;
          spawnParticle(spawnWalkDust(next.facingRight));
        }
        if (speed < 12) {
          // Land: one last dust poof + state reset.
          spawnParticles(spawnDust());
          landThrow();
        }
        animFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      // Normal auto-move path (idle wander, attention chases, etc.).
      if (state.moveTarget) {
        const result = stepToward(state.position, state.moveTarget);
        setPosition(result.position);
        setFacingRight(result.facingRight);

        if (result.arrived) {
          setMoveTarget(null);
          setIsMoving(false);
        } else if (!state.isMoving) {
          setIsMoving(true);
        }

        // Drop a small dust puff behind the trailing foot while walking
        if (!result.arrived && timestamp - lastWalkDustRef.current > 420) {
          lastWalkDustRef.current = timestamp;
          spawnParticle(spawnWalkDust(result.facingRight));
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [
    advanceFrame,
    setPosition,
    setMoveTarget,
    setIsMoving,
    setFacingRight,
    spawnParticle,
    spawnParticles,
    tickThrow,
    landThrow,
  ]);

  // Random idle emote — while the pet is peacefully idling, occasionally
  // drift a heart, music note, or sparkle upward to signal personality.
  useEffect(() => {
    if (stateInfo.state !== "idle" || isMoving) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = 7000 + Math.random() * 11000;
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        spawnParticle(spawnIdleEmote());
        scheduleNext();
      }, delay);
    };

    // First emote arrives sooner the first time so the pet feels alive quickly
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      spawnParticle(spawnIdleEmote());
      scheduleNext();
    }, 3500 + Math.random() * 5000);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [stateInfo.state, isMoving, spawnParticle]);

  // Prune expired particles periodically
  useEffect(() => {
    if (particles.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setParticles((prev) =>
        prev.filter((p) => now - p.spawnedAt < p.durationMs + 200),
      );
    }, 250);
    return () => clearInterval(interval);
  }, [particles.length]);

  // Dust-puff on celebrating landing frame
  const prevCelebrateFrameRef = useRef(-1);
  useEffect(() => {
    if (stateInfo.state !== "celebrating" && stateInfo.state !== "triumph") {
      prevCelebrateFrameRef.current = -1;
      return;
    }
    const frameIdx = animationFrame % 6;
    const prev = prevCelebrateFrameRef.current;
    const justLanded =
      frameIdx === CELEBRATING_LANDING_FRAME &&
      prev !== CELEBRATING_LANDING_FRAME &&
      prev !== CELEBRATING_LANDING_FRAME + 1;
    if (justLanded) {
      spawnParticles(spawnDust());
    }
    prevCelebrateFrameRef.current = frameIdx;
  }, [animationFrame, stateInfo.state, spawnParticles]);

  // Click handler — fires only when a press ends without meaningful
  // drag. Kept as a stable callback so we can trigger it from the
  // pointer-up path without re-registering listeners.
  const handleClick = useCallback(() => {
    dispatch({ type: "CLICK" });
    spawnParticles(spawnHearts());

    const messages = [
      "(*^▽^*)",
      "~(=^‥^)ノ",
      "zzZ... huh?",
      "(◕ᴗ◕✿)",
      "♪♪♪",
      "カピバラ！",
      "(・ω・)ノ",
      "♥",
      "*notices you*",
      "(=^･ω･^=)",
    ];
    showSpeechBubble(
      messages[Math.floor(Math.random() * messages.length)],
      2000,
    );
  }, [dispatch, showSpeechBubble, spawnParticles]);

  // --- Grab / drag / throw state (pointer-driven) ---
  //
  // Kept as refs rather than React state because these values update
  // on every mousemove (~60–120 Hz); re-rendering the whole overlay
  // at that rate just to track pointer history would waste a lot of
  // work. React state is only touched when we actually want a
  // re-render (grab start, release, land).
  const grabStateRef = useRef<{
    active: boolean;
    downAt: number;
    downX: number;
    downY: number;
    // Offset from pet's top-left to where the cursor grabbed it, in
    // world units. Lets us preserve the relative grip point so the
    // cursor doesn't "snap" to the pet's origin.
    offsetX: number;
    offsetY: number;
    // Ring buffer of recent (time, worldX, worldY) samples for the
    // velocity calculation at release. Keeping a small window keeps
    // "flick" responsive without over-weighting old samples.
    samples: Array<{ t: number; x: number; y: number }>;
    // Set to true once the pointer has moved beyond DRAG_THRESHOLD
    // — below that, we treat pointerup as a click rather than a
    // throw, preserving the existing heart-spawn / speech-bubble
    // easter egg.
    movedPastThreshold: boolean;
  }>({
    active: false,
    downAt: 0,
    downX: 0,
    downY: 0,
    offsetX: 0,
    offsetY: 0,
    samples: [],
    movedPastThreshold: false,
  });

  const DRAG_THRESHOLD_PX = 5; // screen pixels
  const VELOCITY_WINDOW_MS = 80; // how far back we look for release velocity
  const MAX_THROW_SPEED = 2400; // world-units-per-second clamp

  // Convert a window-space mouse event to world coordinates (the
  // space the pet's `position` lives in). The overlay SVG is
  // anchored at `left: leftInset, top: 0`, and the viewport transform
  // (pan + zoom) sits on top of that. We resolve these at call time
  // via `useCanvasStore.getState()` rather than closing over the
  // hook-subscribed values — this callback fires on every pointermove
  // and we don't want a stale snapshot if the viewport changes
  // mid-drag.
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = useCanvasStore.getState();
    const inset = getCanvasLeftInset(
      canvas.leftPanelCollapsed,
      canvas.leftPanelWidth,
    );
    const sx = clientX - inset;
    const sy = clientY;
    return {
      x: (sx - canvas.viewport.x) / canvas.viewport.scale,
      y: (sy - canvas.viewport.y) / canvas.viewport.scale,
    };
  }, []);

  const handlePetPointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      // Only primary button (left mouse / touch).
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();

      const world = clientToWorld(event.clientX, event.clientY);
      const state = usePetStore.getState();

      grabStateRef.current = {
        active: true,
        downAt: performance.now(),
        downX: event.clientX,
        downY: event.clientY,
        offsetX: world.x - state.position.x,
        offsetY: world.y - state.position.y,
        samples: [{ t: performance.now(), x: world.x, y: world.y }],
        movedPastThreshold: false,
      };

      // Engage grab state immediately — even before the user has
      // moved. This means the visual tilt + auto-move pause happens
      // on mousedown, which reads as "ok, I've picked it up".
      grabPet();

      // Capture pointer so subsequent pointermove / pointerup land
      // on this element even if the cursor leaves the SVG bounds.
      (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    },
    [clientToWorld, grabPet],
  );

  const handlePetPointerMove = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      const grab = grabStateRef.current;
      if (!grab.active) return;

      const dx = event.clientX - grab.downX;
      const dy = event.clientY - grab.downY;
      if (
        !grab.movedPastThreshold &&
        Math.hypot(dx, dy) > DRAG_THRESHOLD_PX
      ) {
        grab.movedPastThreshold = true;
      }

      const world = clientToWorld(event.clientX, event.clientY);
      const petPos = {
        x: world.x - grab.offsetX,
        y: world.y - grab.offsetY,
      };
      dragPetTo(petPos);

      // Trim samples older than the velocity window.
      const nowT = performance.now();
      grab.samples.push({ t: nowT, x: world.x, y: world.y });
      while (
        grab.samples.length > 2 &&
        nowT - grab.samples[0].t > VELOCITY_WINDOW_MS
      ) {
        grab.samples.shift();
      }
    },
    [clientToWorld, dragPetTo],
  );

  const handlePetPointerUp = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      const grab = grabStateRef.current;
      if (!grab.active) return;
      grab.active = false;

      try {
        (event.currentTarget as SVGGElement).releasePointerCapture(
          event.pointerId,
        );
      } catch {
        // Pointer capture may already be lost (e.g. window blur); fine.
      }

      if (!grab.movedPastThreshold) {
        // Treat as click — preserves the original tap behaviour.
        // Revert grab visuals so the heart-spawn renders normally.
        landThrow();
        handleClick();
        return;
      }

      // Compute velocity from the recent sample window.
      const samples = grab.samples;
      let vx = 0;
      let vy = 0;
      if (samples.length >= 2) {
        const first = samples[0];
        const last = samples[samples.length - 1];
        const dtSec = Math.max(1, last.t - first.t) / 1000;
        vx = (last.x - first.x) / dtSec;
        vy = (last.y - first.y) / dtSec;
        const speed = Math.hypot(vx, vy);
        if (speed > MAX_THROW_SPEED) {
          const k = MAX_THROW_SPEED / speed;
          vx *= k;
          vy *= k;
        }
      }

      // Below a minimum fling threshold, just drop in place — no
      // throw animation, no dust. Reads as "gently put down".
      if (Math.hypot(vx, vy) < 30) {
        landThrow();
        return;
      }

      releasePet(vx, vy);
    },
    [handleClick, landThrow, releasePet],
  );

  // Transform pet world coordinates to screen coordinates
  const leftInset = getCanvasLeftInset(leftPanelCollapsed, leftPanelWidth);
  const rightInset = getCanvasRightInset(rightPanelCollapsed);
  const svgWidth = Math.max(0, window.innerWidth - leftInset - rightInset);
  const svgHeight = window.innerHeight;

  const displayState = isMoving ? "walking" : stateInfo.state;
  const frame = getCurrentFrame(displayState, animationFrame);

  // Pet position in screen space
  const screenX = viewport.x + position.x * viewport.scale;
  const screenY = viewport.y + position.y * viewport.scale;
  const scale = viewport.scale;

  // Attention bubble properties
  const hasAttention = !!currentAttention;
  const queueCount = attentionQueue.length;
  const attnColor = currentAttention
    ? PRIORITY_COLORS[currentAttention.priority]
    : "#D1D5DB";
  const attnText = currentAttention?.message ?? "";
  const attnBubbleWidth = Math.max(50, attnText.length * 7 + 16);

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{
        position: "absolute",
        top: 0,
        left: leftInset,
        pointerEvents: "none",
        zIndex: 50,
        overflow: "visible",
      }}
    >
      <g
        transform={`translate(${screenX}, ${screenY}) scale(${scale}) rotate(${
          (rotation * 180) / Math.PI
        } ${PET_SIZE / 2} ${PET_SIZE / 2})`}
        style={{
          cursor: isGrabbed ? "grabbing" : isThrown ? "default" : "grab",
          pointerEvents: "auto",
          // Subtle scale bump while held tells the user "you've got
          // it" without needing a whole new sprite.
          transition: isThrown ? "none" : "transform 80ms ease-out",
        }}
        onPointerDown={handlePetPointerDown}
        onPointerMove={handlePetPointerMove}
        onPointerUp={handlePetPointerUp}
        onPointerCancel={handlePetPointerUp}
      >
        <SpriteRenderer
          frame={frame}
          x={0}
          y={0}
          flipX={!facingRight}
        />

        {/* Hit area for click — invisible rect covering the pet */}
        <rect
          x={0}
          y={0}
          width={PET_SIZE}
          height={PET_SIZE}
          fill="transparent"
        />

        {/* Sleeping Z particles + spa yuzu on head (onsen capybara tribute) */}
        {displayState === "sleeping" && (
          <g>
            {zzzOffsets.map((offset, i) => {
              const floatY =
                offset.dy -
                Math.sin(Date.now() / 600 + i * 1.2) * 4;
              return (
                <text
                  key={i}
                  x={PET_SIZE + offset.dx}
                  y={floatY}
                  fontSize={8 + i * 2}
                  fill={C.zzz}
                  opacity={0.7 - i * 0.15}
                  fontFamily="monospace"
                >
                  Z
                </text>
              );
            })}
            {/* Pixel yuzu perched on the sleeping head (col ~14, above row 8) */}
            <g transform="translate(54, 22)">
              {/* leaf */}
              <rect x={3} y={0} width={3} height={2} fill={C.yuzuLeaf} />
              <rect x={4} y={2} width={1} height={2} fill={C.yuzuLeaf} />
              {/* citrus body */}
              <rect x={2} y={4} width={6} height={2} fill={C.yuzu} />
              <rect x={1} y={6} width={8} height={4} fill={C.yuzu} />
              <rect x={2} y={10} width={6} height={2} fill={C.yuzu} />
              {/* shading */}
              <rect x={6} y={6} width={2} height={4} fill={C.yuzuShade} />
              <rect x={5} y={10} width={3} height={1} fill={C.yuzuShade} />
              {/* highlight */}
              <rect x={2} y={6} width={1} height={1} fill="#FFEBA0" />
            </g>
          </g>
        )}

        {/* Celebrating sparkles */}
        {(displayState === "celebrating" || displayState === "triumph") && (
          <g>
            {sparklePositions.map((pos, i) => {
              const pulse = Math.sin(Date.now() / 200 + i * 1.5);
              const size = 3 + pulse * 2;
              return (
                <rect
                  key={i}
                  x={PET_SIZE / 2 + pos.dx - size / 2}
                  y={pos.dy - size / 2}
                  width={size}
                  height={size}
                  fill={C.sparkle}
                  opacity={0.6 + pulse * 0.3}
                  transform={`rotate(45 ${PET_SIZE / 2 + pos.dx} ${pos.dy})`}
                />
              );
            })}
          </g>
        )}

        {/* Confused — a bobbing question mark plus a faint ghost behind it */}
        {displayState === "confused" && (
          <g>
            <text
              x={PET_SIZE + 4}
              y={-2 + Math.sin(Date.now() / 260) * 1.5}
              fontSize={10}
              fill={C.sparkle}
              opacity={0.35}
              fontFamily="monospace"
              fontWeight="bold"
            >
              ?
            </text>
            <text
              x={PET_SIZE + 6}
              y={-6 + Math.sin(Date.now() / 220) * 2}
              fontSize={14}
              fill={C.sparkle}
              fontFamily="monospace"
              fontWeight="bold"
            >
              ?
            </text>
          </g>
        )}

        {/* Particle overlay (hearts / dust / notes) */}
        <ParticleLayer particles={particles} />

        {/* Attention bubble — persistent, colored, with queue badge */}
        {hasAttention ? (
          <g transform={`translate(${PET_SIZE + 4}, ${-20})`}>
            <rect
              x={0}
              y={0}
              width={attnBubbleWidth}
              height={22}
              rx={4}
              fill={C.bubble}
              stroke={attnColor}
              strokeWidth={1.5}
            />
            {/* Bubble tail */}
            <polygon
              points="-2,11 4,11 4,17"
              fill={C.bubble}
              stroke={attnColor}
              strokeWidth={1.5}
            />
            <rect x={-1} y={10} width={6} height={3} fill={C.bubble} />
            <text
              x={6}
              y={15}
              fontSize={10}
              fill="#374151"
              fontFamily="monospace"
            >
              {attnText}
            </text>
            {/* Queue count badge */}
            {queueCount > 0 && (
              <g transform={`translate(${attnBubbleWidth - 2}, ${-4})`}>
                <circle r={7} fill={attnColor} />
                <text
                  x={0}
                  y={3.5}
                  fontSize={9}
                  fill="white"
                  textAnchor="middle"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {queueCount > 9 ? "9+" : queueCount}
                </text>
              </g>
            )}
          </g>
        ) : (
          /* Regular speech bubble — transient */
          showBubble &&
          bubbleText && (
            <g transform={`translate(${PET_SIZE + 4}, ${-16})`}>
              <rect
                x={0}
                y={0}
                width={Math.max(30, bubbleText.length * 7 + 12)}
                height={20}
                rx={4}
                fill={C.bubble}
                stroke={C.bubbleBorder}
                strokeWidth={1}
              />
              {/* Bubble tail */}
              <polygon
                points="-2,10 4,10 4,16"
                fill={C.bubble}
                stroke={C.bubbleBorder}
                strokeWidth={1}
              />
              <rect x={-1} y={9} width={6} height={3} fill={C.bubble} />
              <text
                x={6}
                y={14}
                fontSize={10}
                fill="#374151"
                fontFamily="monospace"
              >
                {bubbleText}
              </text>
            </g>
          )
        )}
      </g>
    </svg>
  );
}
