#!/usr/bin/env node
import { connect } from 'node:net';

const socket = process.env.TERMCANVAS_SOCKET;
const terminalId = process.env.TERMCANVAS_TERMINAL_ID || '';
if (!socket) process.exit(0);

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    data.terminal_id = terminalId;
    const client = connect(socket, () => {
      client.end(JSON.stringify(data));
    });
    client.on('error', () => process.exit(0));
    client.setTimeout(3000, () => { client.destroy(); process.exit(0); });
  } catch {
    process.exit(0);
  }
});
process.stdin.on('error', () => process.exit(0));
