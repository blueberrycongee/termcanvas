import { memo, useEffect, useState, type ReactElement } from "react";
import { C } from "./sprites/colors";

export type ParticleKind = "heart" | "dust" | "note" | "star" | "splash";

export interface Particle {
  id: string;
  kind: ParticleKind;
  /** Origin offset (pet world coordinates, 0,0 = top-left of pet). */
  ox: number;
  oy: number;
  /** Drift in pet world pixels across the particle's lifetime. */
  dx: number;
  dy: number;
  spawnedAt: number;
  durationMs: number;
}

interface Props {
  particles: Particle[];
}

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}

function Heart({ size = 1 }: { size?: number }) {
  const s = size;
  // Simple pixel heart (centered roughly on (3*s, 3*s))
  return (
    <g transform={`translate(${-3 * s}, ${-2 * s})`}>
      <rect x={1 * s} y={0} width={2 * s} height={s} fill={C.heart} />
      <rect x={4 * s} y={0} width={2 * s} height={s} fill={C.heart} />
      <rect x={0} y={s} width={7 * s} height={s} fill={C.heart} />
      <rect x={0} y={2 * s} width={7 * s} height={s} fill={C.heart} />
      <rect x={s} y={3 * s} width={5 * s} height={s} fill={C.heart} />
      <rect x={2 * s} y={4 * s} width={3 * s} height={s} fill={C.heart} />
      <rect x={3 * s} y={5 * s} width={s} height={s} fill={C.heart} />
      {/* highlight */}
      <rect x={s} y={s} width={s} height={s} fill={C.heartLight} />
    </g>
  );
}

function Dust({ t }: { t: number }) {
  const r = 2 + t * 6;
  return (
    <g>
      <circle cx={0} cy={0} r={r} fill={C.dust} opacity={0.7 * (1 - t)} />
      <circle cx={-r * 0.4} cy={-r * 0.3} r={r * 0.6} fill={C.dust} opacity={0.5 * (1 - t)} />
      <circle cx={r * 0.5} cy={r * 0.1} r={r * 0.5} fill={C.dust} opacity={0.5 * (1 - t)} />
    </g>
  );
}

function Note() {
  // 8th note glyph in pixels
  return (
    <g transform="translate(-3, -5)">
      <rect x={3} y={0} width={1} height={8} fill={C.note} />
      <rect x={4} y={0} width={3} height={1} fill={C.note} />
      <rect x={0} y={6} width={4} height={3} fill={C.note} />
      <rect x={1} y={5} width={3} height={1} fill={C.note} />
    </g>
  );
}

function Star() {
  return (
    <g>
      <rect x={-1} y={-5} width={2} height={10} fill={C.sparkle} />
      <rect x={-5} y={-1} width={10} height={2} fill={C.sparkle} />
      <rect x={-1} y={-1} width={2} height={2} fill={C.sparkleAccent} />
    </g>
  );
}

function Splash({ t }: { t: number }) {
  const spread = 2 + t * 8;
  return (
    <g opacity={1 - t}>
      <rect x={-spread - 1} y={0} width={2} height={2} fill={C.water} />
      <rect x={spread - 1} y={0} width={2} height={2} fill={C.water} />
      <rect x={-2} y={-spread / 2} width={2} height={2} fill={C.splash} />
      <rect x={0} y={-spread / 2} width={2} height={2} fill={C.splash} />
    </g>
  );
}

function renderParticle(p: Particle, now: number) {
  const age = (now - p.spawnedAt) / p.durationMs;
  if (age < 0 || age >= 1) return null;

  const eased = easeOutQuad(age);
  const x = p.ox + p.dx * eased;
  const y = p.oy + p.dy * eased;
  // Hearts/notes drift with a subtle horizontal wobble.
  const wobble =
    p.kind === "heart" || p.kind === "note"
      ? Math.sin(age * Math.PI * 3) * 1.5
      : 0;

  const opacity =
    p.kind === "dust" || p.kind === "splash"
      ? 1 // handled inside shape
      : Math.min(1, 1.4 - age * 1.2);

  const scale =
    p.kind === "heart"
      ? 0.7 + Math.sin(age * Math.PI) * 0.4
      : p.kind === "star"
        ? Math.sin(age * Math.PI)
        : 1;

  let shape: ReactElement | null = null;
  switch (p.kind) {
    case "heart":
      shape = <Heart />;
      break;
    case "dust":
      shape = <Dust t={age} />;
      break;
    case "note":
      shape = <Note />;
      break;
    case "star":
      shape = <Star />;
      break;
    case "splash":
      shape = <Splash t={age} />;
      break;
  }

  return (
    <g
      key={p.id}
      transform={`translate(${x + wobble}, ${y}) scale(${scale})`}
      opacity={opacity}
    >
      {shape}
    </g>
  );
}

export const ParticleLayer = memo(function ParticleLayer({ particles }: Props) {
  const [now, setNow] = useState(() => Date.now());

  // While particles exist, drive a 60fps clock for smooth animation.
  useEffect(() => {
    if (particles.length === 0) return;
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [particles.length]);

  if (particles.length === 0) return null;

  return <g>{particles.map((p) => renderParticle(p, now))}</g>;
});
