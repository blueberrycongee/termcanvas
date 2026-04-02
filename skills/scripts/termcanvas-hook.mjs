#!/usr/bin/env node
import { connect } from 'node:net';
import { appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';

const socket = process.env.TERMCANVAS_SOCKET;
const terminalId = process.env.TERMCANVAS_TERMINAL_ID || '';
if (!socket) process.exit(0);

const LOG_PATH = `${tmpdir()}/termcanvas-hook-errors.log`;
const MAX_LOG_BYTES = 1_048_576; // 1 MB

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
    const client = connect(socket, () => {
      client.end(JSON.stringify(json));
    });
    client.on('close', () => resolve(true));
    client.on('error', () => resolve(false));
    client.setTimeout(10_000, () => { client.destroy(); resolve(false); });
  });
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    logError(null, 'stdin_json_parse_error');
    process.exit(0);
  }
  data.terminal_id = terminalId;
  const eventName = data.hook_event_name || '?';

  let ok = await send(data);
  if (!ok) {
    // Retry once after 200ms
    await new Promise((r) => setTimeout(r, 200));
    ok = await send(data);
  }
  if (!ok) {
    logError(eventName, 'socket_connect_failed_after_retry');
  }
  process.exit(0);
});
process.stdin.on('error', () => {
  logError(null, 'stdin_error');
  process.exit(0);
});
