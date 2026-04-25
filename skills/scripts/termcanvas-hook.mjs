#!/usr/bin/env node
import { connect } from 'node:net';
import { appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const socket = process.env.TERMCANVAS_SOCKET;
const terminalId = process.env.TERMCANVAS_TERMINAL_ID || '';

const LOG_PATH = `${tmpdir()}/termcanvas-hook-errors.log`;
const MAX_LOG_BYTES = 1_048_576;

function logError(eventName, reason) {
  try {
    const ts = new Date().toISOString();
    const line = `${ts} event=${eventName || '?'} terminal=${terminalId} reason=${reason}\n`;
    try {
      if (statSync(LOG_PATH).size > MAX_LOG_BYTES) return;
    } catch { /* file doesn't exist yet — fine */ }
    appendFileSync(LOG_PATH, line);
  } catch { /* logging itself must never block */ }
}

function send(json) {
  return new Promise((resolve) => {
    if (!socket) {
      resolve(false);
      return;
    }
    const client = connect(socket, () => {
      client.end(JSON.stringify(json));
    });
    client.on('close', () => resolve(true));
    client.on('error', () => resolve(false));
    client.setTimeout(10_000, () => { client.destroy(); resolve(false); });
  });
}

// Consume stdin fully before any exit path to avoid breaking Codex's write_all.
async function runHook() {
  const input = await new Promise((resolve, reject) => {
    let chunks = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { chunks += chunk; });
    process.stdin.on('end', () => resolve(chunks));
    process.stdin.on('error', (err) => reject(err));
  });

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    logError(null, `stdin_json_parse_error input_length=${input.length}`);
    return;
  }

  data.terminal_id = terminalId;
  const eventName = data.hook_event_name || '?';

  if (!socket) {
    logError(eventName, 'TERMCANVAS_SOCKET_missing');
    return;
  }

  let ok = await send(data);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 200));
    ok = await send(data);
  }
  if (!ok) {
    logError(eventName, 'socket_connect_failed_after_retry');
  }
}

runHook()
  .then(() => process.exit(0))
  .catch((err) => {
    logError(null, `unhandled_exception: ${err?.message || err}`);
    process.exit(0);
  });
