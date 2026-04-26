import type { PetState } from "../stateMachine";
import { idleFrames } from "./idle";
import { sleepingFrames } from "./sleeping";
import { workingFrames } from "./working";
import { celebratingFrames } from "./celebrating";
import { worriedFrames } from "./worried";
import { walkingFrames } from "./walking";
import {
  curiousFrames,
  waitingFrames,
  commandingFrames,
  confusedFrames,
  triumphFrames,
  wakingFrames,
} from "./extras";

export type SpriteFrame = (string | null)[][];

const spriteMap: Record<PetState, SpriteFrame[]> = {
  idle: idleFrames,
  sleeping: sleepingFrames,
  waking: wakingFrames,
  curious: curiousFrames,
  working: workingFrames,
  waiting: waitingFrames,
  celebrating: celebratingFrames,
  worried: worriedFrames,
  confused: confusedFrames,
  commanding: commandingFrames,
  triumph: triumphFrames,
  walking: walkingFrames,
};

// Animation speed per state (ms per frame)
const frameIntervals: Record<PetState, number> = {
  idle: 400,
  sleeping: 800,
  waking: 300,
  curious: 300,
  working: 200,
  waiting: 350,
  celebrating: 150,
  worried: 100,
  confused: 400,
  commanding: 500,
  triumph: 150,
  walking: 200,
};

export function getFrames(state: PetState): SpriteFrame[] {
  return spriteMap[state];
}

export function getFrameInterval(state: PetState): number {
  return frameIntervals[state];
}

export function getCurrentFrame(state: PetState, frameIndex: number): SpriteFrame {
  const frames = spriteMap[state];
  return frames[frameIndex % frames.length];
}
