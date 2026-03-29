import { useEffect, useRef } from "react";
import type { ReflowResult } from "./agentReflow";

export interface AgentReflowOverlayProps {
  reflowResult: ReflowResult;
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  fontFamily: string;
  fontSize: number;
  fgColor: string;
  bgColor: string;
}

export function AgentReflowOverlay({
  reflowResult,
  width,
  height,
  cellWidth,
  cellHeight,
  fontFamily,
  fontSize,
  fgColor,
  bgColor,
}: AgentReflowOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = fgColor;
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";

    const { rows } = reflowResult;
    const visibleRows = Math.floor(height / cellHeight);
    const startRow = Math.max(0, rows.length - visibleRows);

    for (let i = startRow; i < rows.length; i++) {
      const y = (i - startRow) * cellHeight;
      if (y > height) break;
      ctx.fillText(rows[i], 0, y);
    }
  }, [reflowResult, width, height, cellWidth, cellHeight, fontFamily, fontSize, fgColor, bgColor]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  );
}
