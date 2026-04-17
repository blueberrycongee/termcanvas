/**
 * CPU-side comparative benchmark for the two TermCanvas terminal backends.
 *
 * Runs in Node with `npx tsx benchmarks/terminal-backend.bench.ts`. It does
 * NOT measure GPU frame time — this host has no GPU, so renderer cost is
 * deliberately excluded. We measure the work that is hardware-independent:
 *
 *  - VT parser throughput (MB/s) on a mixed agent-like workload
 *  - Viewport read cost (cost to snapshot the visible grid once)
 *  - Steady-state "streaming" round-trip: write a chunk, read viewport,
 *    loop, which is what the renderer process does under real agent load
 *
 * The numbers are comparable between backends on the same host because the
 * same workload bytes are fed to both. On a host with a GPU, a separate
 * end-to-end frame-time benchmark is still required.
 */

import { performance } from "node:perf_hooks";
import xtermHeadless from "@xterm/headless";
import { loadGhosttyInNode } from "../src/terminal/backend/loadGhostty.ts";
import { GhosttyWasmCore } from "../src/terminal/backend/GhosttyWasmCore.ts";

// xterm-headless ships CJS; tsx exposes the CJS `module.exports` as the
// default export of the synthetic namespace. Destructuring after the
// default-import captures the real class.
const { Terminal: XtermTerminalCtor } = xtermHeadless;
type XtermHeadlessTerminal = InstanceType<typeof XtermTerminalCtor>;

const WORKLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
const CHUNK_SIZE = 64 * 1024; // 64 KB
const STEADY_STATE_ROUNDS = 2_000;
const STEADY_STATE_CHUNK = 256; // bytes written per round in the streaming sim
const COLS = 120;
const ROWS = 40;
const SCROLLBACK = 10_000;

interface BenchmarkSummary {
  name: string;
  workloadMB: number;
  writeMs: number;
  writeThroughputMBps: number;
  viewportReadMs: number;
  steadyStateRounds: number;
  steadyStateTotalMs: number;
  steadyStateMeanMs: number;
  heapUsedMB: number;
}

function reportTable(rows: BenchmarkSummary[]): void {
  const headers = [
    "backend",
    "workload MB",
    "write ms",
    "MB/s",
    "viewport read ms",
    "steady rounds",
    "steady total ms",
    "steady mean ms",
    "heap MB",
  ];
  const format = (v: number, digits: number) => v.toFixed(digits);
  const table = rows.map((r) => [
    r.name,
    format(r.workloadMB, 2),
    format(r.writeMs, 1),
    format(r.writeThroughputMBps, 1),
    format(r.viewportReadMs, 2),
    r.steadyStateRounds.toString(),
    format(r.steadyStateTotalMs, 1),
    format(r.steadyStateMeanMs, 3),
    format(r.heapUsedMB, 1),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...table.map((row) => row[i].length)),
  );
  const pad = (text: string, w: number) => text.padEnd(w);
  console.log(headers.map((h, i) => pad(h, widths[i])).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of table) {
    console.log(row.map((v, i) => pad(v, widths[i])).join("  "));
  }
}

/**
 * Produce a deterministic byte stream that resembles coding-agent output:
 * mostly text, frequent SGR colour changes, regular cursor positioning,
 * newlines, and occasional alt-screen toggles plus clears. Same bytes are
 * fed to both backends so their work is directly comparable.
 */
function generateWorkload(byteTarget: number): string {
  const parts: string[] = [];
  let produced = 0;
  let rng = 0x2a_bd_3c_7e >>> 0;

  const nextRand = () => {
    rng = (Math.imul(rng, 1_664_525) + 1_013_904_223) >>> 0;
    return rng / 0xffff_ffff;
  };

  const pickSgr = () => {
    const fg = 30 + Math.floor(nextRand() * 8);
    const bg = 40 + Math.floor(nextRand() * 8);
    const bold = nextRand() < 0.2 ? ";1" : "";
    return `\x1b[${fg};${bg}${bold}m`;
  };

  while (produced < byteTarget) {
    const pick = nextRand();
    let chunk: string;
    if (pick < 0.5) {
      // plain ascii run
      const len = 4 + Math.floor(nextRand() * 40);
      let s = "";
      for (let i = 0; i < len; i += 1) {
        s += String.fromCharCode(32 + Math.floor(nextRand() * 95));
      }
      chunk = s;
    } else if (pick < 0.7) {
      chunk = pickSgr();
    } else if (pick < 0.85) {
      const row = 1 + Math.floor(nextRand() * ROWS);
      const col = 1 + Math.floor(nextRand() * COLS);
      chunk = `\x1b[${row};${col}H`;
    } else if (pick < 0.95) {
      chunk = "\r\n";
    } else if (pick < 0.97) {
      chunk = "\x1b[2J\x1b[H"; // clear + home
    } else if (pick < 0.985) {
      chunk = "\x1b[?1049h"; // alt screen enter
    } else {
      chunk = "\x1b[?1049l"; // alt screen leave
    }
    parts.push(chunk);
    produced += chunk.length;
  }
  return parts.join("");
}

async function benchGhostty(workload: string): Promise<BenchmarkSummary> {
  const ghostty = await loadGhosttyInNode();
  const core = new GhosttyWasmCore(ghostty, {
    cols: COLS,
    rows: ROWS,
    scrollbackLimit: SCROLLBACK,
  });

  try {
    const startWrite = performance.now();
    for (let offset = 0; offset < workload.length; offset += CHUNK_SIZE) {
      core.write(workload.slice(offset, offset + CHUNK_SIZE));
    }
    core.update();
    const writeMs = performance.now() - startWrite;

    const startView = performance.now();
    core.getViewport();
    const viewportReadMs = performance.now() - startView;

    const startSteady = performance.now();
    let workloadIdx = 0;
    for (let i = 0; i < STEADY_STATE_ROUNDS; i += 1) {
      const start = workloadIdx % (workload.length - STEADY_STATE_CHUNK);
      core.write(workload.slice(start, start + STEADY_STATE_CHUNK));
      core.update();
      core.getViewport();
      core.markClean();
      workloadIdx += STEADY_STATE_CHUNK;
    }
    const steadyStateTotalMs = performance.now() - startSteady;

    const heapUsedMB = process.memoryUsage().heapUsed / (1024 * 1024);

    return {
      name: "ghostty-wasm",
      workloadMB: workload.length / (1024 * 1024),
      writeMs,
      writeThroughputMBps: workload.length / (1024 * 1024) / (writeMs / 1_000),
      viewportReadMs,
      steadyStateRounds: STEADY_STATE_ROUNDS,
      steadyStateTotalMs,
      steadyStateMeanMs: steadyStateTotalMs / STEADY_STATE_ROUNDS,
      heapUsedMB,
    };
  } finally {
    core.dispose();
  }
}

function snapshotXtermBuffer(term: XtermHeadlessTerminal): void {
  const active = term.buffer.active;
  for (let y = 0; y < term.rows; y += 1) {
    const line = active.getLine(y);
    if (line) {
      line.translateToString(false);
    }
  }
}

async function benchXterm(workload: string): Promise<BenchmarkSummary> {
  const term = new XtermTerminalCtor({
    cols: COLS,
    rows: ROWS,
    scrollback: SCROLLBACK,
    allowProposedApi: true,
  });

  try {
    // xterm's write is async-ish (batched); wait for each chunk to drain
    // before moving on so the timing measures real parse work, not queue
    // depth.
    const writeChunk = (data: string) =>
      new Promise<void>((resolve) => term.write(data, () => resolve()));

    const startWrite = performance.now();
    for (let offset = 0; offset < workload.length; offset += CHUNK_SIZE) {
      await writeChunk(workload.slice(offset, offset + CHUNK_SIZE));
    }
    const writeMs = performance.now() - startWrite;

    const startView = performance.now();
    snapshotXtermBuffer(term);
    const viewportReadMs = performance.now() - startView;

    const startSteady = performance.now();
    let workloadIdx = 0;
    for (let i = 0; i < STEADY_STATE_ROUNDS; i += 1) {
      const start = workloadIdx % (workload.length - STEADY_STATE_CHUNK);
      await writeChunk(workload.slice(start, start + STEADY_STATE_CHUNK));
      snapshotXtermBuffer(term);
      workloadIdx += STEADY_STATE_CHUNK;
    }
    const steadyStateTotalMs = performance.now() - startSteady;

    const heapUsedMB = process.memoryUsage().heapUsed / (1024 * 1024);

    return {
      name: "xterm-headless",
      workloadMB: workload.length / (1024 * 1024),
      writeMs,
      writeThroughputMBps: workload.length / (1024 * 1024) / (writeMs / 1_000),
      viewportReadMs,
      steadyStateRounds: STEADY_STATE_ROUNDS,
      steadyStateTotalMs,
      steadyStateMeanMs: steadyStateTotalMs / STEADY_STATE_ROUNDS,
      heapUsedMB,
    };
  } finally {
    term.dispose();
  }
}

async function main() {
  console.log(
    `Generating ${(WORKLOAD_BYTES / 1024 / 1024).toFixed(1)} MB of ` +
      "agent-like VT workload...",
  );
  const workload = generateWorkload(WORKLOAD_BYTES);
  console.log(`Workload size: ${workload.length} bytes\n`);

  // Warm both engines once before the real run so JIT warmup and WASM
  // parse costs don't skew the first-measured backend's numbers.
  const warmup = workload.slice(0, 64 * 1024);
  const ghostty = await loadGhosttyInNode();
  new GhosttyWasmCore(ghostty, { cols: COLS, rows: ROWS }).write(warmup);
  new XtermTerminalCtor({
    cols: COLS,
    rows: ROWS,
    allowProposedApi: true,
  }).write(warmup);

  const ghosttyResult = await benchGhostty(workload);
  const xtermResult = await benchXterm(workload);

  console.log();
  reportTable([ghosttyResult, xtermResult]);

  const writeRatio =
    ghosttyResult.writeThroughputMBps / xtermResult.writeThroughputMBps;
  const steadyRatio =
    xtermResult.steadyStateMeanMs / ghosttyResult.steadyStateMeanMs;
  console.log(
    `\nParser throughput: ghostty ${writeRatio.toFixed(2)}x ${
      writeRatio >= 1 ? "faster" : "slower"
    } than xterm`,
  );
  console.log(
    `Steady-state round-trip: ghostty ${steadyRatio.toFixed(2)}x ${
      steadyRatio >= 1 ? "faster" : "slower"
    } than xterm`,
  );
  console.log(
    "\nCaveats: no GPU on this host, so these numbers are CPU-only " +
      "(parser + buffer read). The Ghostty backend's renderer still lives " +
      "on the Canvas path for now — real frame-time gains require a GPU " +
      "harness against the real Electron window.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
