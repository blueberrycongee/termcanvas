import type { PetPosition, PetMoveTarget } from "./petStore";

const MOVE_SPEED = 1.5; // pixels per frame (canvas world space)
const ARRIVAL_THRESHOLD = 4;
const TITLE_BAR_HEIGHT = 34;

export interface MovementResult {
  position: PetPosition;
  arrived: boolean;
  facingRight: boolean;
}

export function stepToward(
  current: PetPosition,
  target: PetMoveTarget,
): MovementResult {
  const targetY = target.onTitleBar
    ? target.y - TITLE_BAR_HEIGHT - 48 // sit on top of the title bar (48 = pet height)
    : target.y;

  const dx = target.x - current.x;
  const dy = targetY - current.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= ARRIVAL_THRESHOLD) {
    return {
      position: { x: target.x, y: targetY },
      arrived: true,
      facingRight: dx >= 0,
    };
  }

  const ratio = MOVE_SPEED / dist;
  return {
    position: {
      x: current.x + dx * ratio,
      y: current.y + dy * ratio,
    },
    arrived: false,
    facingRight: dx >= 0,
  };
}

export function pickIdleWanderTarget(
  current: PetPosition,
  bounds: { x: number; y: number; w: number; h: number },
): PetMoveTarget {
  const margin = 60;
  return {
    x: bounds.x + margin + Math.random() * Math.max(0, bounds.w - margin * 2),
    y: bounds.y + margin + Math.random() * Math.max(0, bounds.h - margin * 2),
  };
}

export function getTerminalTitleBarTarget(
  terminal: { x: number; y: number; width: number },
): PetMoveTarget {
  return {
    x: terminal.x + terminal.width / 2 - 24, // center pet on terminal (48/2 = 24)
    y: terminal.y,
    terminalId: undefined,
    onTitleBar: true,
  };
}
