// Renders every capybara sprite state to a single static HTML preview file.
// Usage: npx tsx scripts/pet-preview.ts > /tmp/pet-preview.html

import { idleFrames } from "../src/pet/sprites/idle.ts";
import { walkingFrames } from "../src/pet/sprites/walking.ts";
import { sleepingFrames } from "../src/pet/sprites/sleeping.ts";
import { workingFrames } from "../src/pet/sprites/working.ts";
import { celebratingFrames } from "../src/pet/sprites/celebrating.ts";
import { worriedFrames } from "../src/pet/sprites/worried.ts";
import {
  curiousFrames,
  waitingFrames,
  commandingFrames,
  confusedFrames,
  wakingFrames,
  goodbyeFrames,
} from "../src/pet/sprites/extras.ts";
import { C } from "../src/pet/sprites/colors.ts";

type Frame = (string | null)[][];

const STATES: [string, Frame[]][] = [
  ["idle", idleFrames],
  ["walking", walkingFrames],
  ["sleeping", sleepingFrames],
  ["working", workingFrames],
  ["celebrating", celebratingFrames],
  ["worried", worriedFrames],
  ["curious", curiousFrames],
  ["waiting", waitingFrames],
  ["commanding", commandingFrames],
  ["confused", confusedFrames],
  ["waking", wakingFrames],
  ["goodbye", goodbyeFrames],
];

const PIXEL = 6;

function renderFrameSVG(frame: Frame): string {
  const rects: string[] = [];
  for (let y = 0; y < frame.length; y++) {
    for (let x = 0; x < frame[y].length; x++) {
      const fill = frame[y][x];
      if (!fill) continue;
      rects.push(
        `<rect x="${x * PIXEL}" y="${y * PIXEL}" width="${PIXEL}" height="${PIXEL}" fill="${fill}"/>`,
      );
    }
  }
  const W = 24 * PIXEL;
  const H = 24 * PIXEL;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#1F1F1F;border:1px solid #444">
    <ellipse cx="${W / 2}" cy="${H - 40}" rx="${W * 0.3}" ry="6" fill="${C.shadow}" />
    ${rects.join("")}
  </svg>`;
}

const sections = STATES.map(([name, frames]) => {
  const frameEls = frames
    .map((f, i) => `<figure><figcaption>#${i}</figcaption>${renderFrameSVG(f)}</figure>`)
    .join("");
  return `<section>
    <h2>${name}</h2>
    <div class="row">${frameEls}</div>
  </section>`;
}).join("\n");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Capybara Pet Preview</title>
<style>
  body { background:#0D0D0D; color:#DDD; font-family:ui-sans-serif,system-ui,sans-serif; padding:24px; }
  h1 { margin-top:0; }
  h2 { color:#F5C244; font-size:14px; margin:16px 0 8px; text-transform:uppercase; letter-spacing:.05em; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  figure { margin:0; text-align:center; }
  figcaption { color:#888; font-size:11px; padding:4px 0; }
  section { border-bottom:1px solid #333; padding:8px 0; }
</style>
</head>
<body>
  <h1>TermCanvas — Capybara Pet Preview</h1>
  <p style="color:#888">Every state/frame rendered with the updated palette and shadow ellipse.</p>
  ${sections}
</body>
</html>`;

process.stdout.write(html);
