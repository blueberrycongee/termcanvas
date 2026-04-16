import { useEffect, useRef, useCallback } from "react";
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

const PRIORITY_COLORS: Record<AttentionPriority, string> = {
  error: "#EF4444",
  stuck: "#F59E0B",
  approval: "#3B82F6",
  success: "#10B981",
};

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
  const dispatch = usePetStore((s) => s.dispatch);
  const setPosition = usePetStore((s) => s.setPosition);
  const setMoveTarget = usePetStore((s) => s.setMoveTarget);
  const setIsMoving = usePetStore((s) => s.setIsMoving);
  const setFacingRight = usePetStore((s) => s.setFacingRight);
  const advanceFrame = usePetStore((s) => s.advanceFrame);
  const showSpeechBubble = usePetStore((s) => s.showSpeechBubble);

  const viewport = useCanvasStore((s) => s.viewport);
  const leftPanelCollapsed = useCanvasStore((s) => s.leftPanelCollapsed);
  const leftPanelWidth = useCanvasStore((s) => s.leftPanelWidth);
  const rightPanelCollapsed = useCanvasStore((s) => s.rightPanelCollapsed);

  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef(0);

  // Main animation loop
  useEffect(() => {
    let running = true;

    function tick(timestamp: number) {
      if (!running) return;

      const state = usePetStore.getState();
      const interval = getFrameInterval(
        state.isMoving ? "walking" : state.stateInfo.state,
      );

      if (timestamp - lastFrameTimeRef.current >= interval) {
        lastFrameTimeRef.current = timestamp;
        advanceFrame();
      }

      // Movement
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
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [advanceFrame, setPosition, setMoveTarget, setIsMoving, setFacingRight]);

  // Click handler
  const handleClick = useCallback(() => {
    dispatch({ type: "CLICK" });

    const messages = [
      "(*^▽^*)",
      "~(=^‥^)ノ",
      "zzZ... huh?",
      "(◕ᴗ◕✿)",
      "♪♪♪",
      "カピバラ！",
    ];
    showSpeechBubble(messages[Math.floor(Math.random() * messages.length)], 2000);
  }, [dispatch, showSpeechBubble]);

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
        transform={`translate(${screenX}, ${screenY}) scale(${scale})`}
        style={{ cursor: "pointer", pointerEvents: "auto" }}
        onClick={handleClick}
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

        {/* Sleeping Z particles */}
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

        {/* Confused question mark */}
        {displayState === "confused" && (
          <text
            x={PET_SIZE + 4}
            y={-2}
            fontSize={14}
            fill={C.sparkle}
            fontFamily="monospace"
            fontWeight="bold"
          >
            ?
          </text>
        )}

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
