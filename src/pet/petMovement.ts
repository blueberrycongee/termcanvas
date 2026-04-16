import type { PetPosition, PetMoveTarget } from "./petStore";
import { PET_HALF_SIZE, PET_SIZE } from "./constants";

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
    ? target.y - TITLE_BAR_HEIGHT - PET_SIZE
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

/**
 * Get a move target on a terminal's title bar.
 * @param edge  If true, position pet at the right edge (to avoid blocking focused content).
 */
export function getTerminalTitleBarTarget(
  terminal: { x: number; y: number; width: number },
  edge?: boolean,
): PetMoveTarget {
  const petX = edge
    ? terminal.x + terminal.width - PET_SIZE - 8
    : terminal.x + terminal.width / 2 - PET_HALF_SIZE;
  return {
    x: petX,
    y: terminal.y,
    terminalId: undefined,
    onTitleBar: true,
  };
}

/**
 * Get a move target inside a terminal's content area (center).
 * Used for attention notifications — the pet stands inside the terminal
 * to clearly indicate which one needs the user's focus.
 */
export function getTerminalInsideTarget(
  terminal: { x: number; y: number; width: number; height: number },
): PetMoveTarget {
  return {
    x: terminal.x + terminal.width / 2 - PET_HALF_SIZE,
    y:
      terminal.y +
      TITLE_BAR_HEIGHT +
      (terminal.height - TITLE_BAR_HEIGHT) / 2 -
      PET_HALF_SIZE,
    terminalId: undefined,
    onTitleBar: false,
  };
}
