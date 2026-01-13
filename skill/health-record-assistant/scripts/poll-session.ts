#!/usr/bin/env bun
// Poll a session until data is ready or timeout

const BASE_URL = process.env.HEALTH_SKILLZ_URL || 'https://health-skillz.exe.xyz:8000';

const sessionId = process.argv[2];
const timeout = process.argv[3] || '30';

if (!sessionId) {
  console.error(JSON.stringify({ error: 'Usage: poll-session.ts <sessionId> [timeout]' }));
  process.exit(1);
}

const res = await fetch(`${BASE_URL}/api/poll/${sessionId}?timeout=${timeout}`);

if (!res.ok) {
  console.error(JSON.stringify({ error: `Poll failed: ${res.status}` }));
  process.exit(1);
}

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
