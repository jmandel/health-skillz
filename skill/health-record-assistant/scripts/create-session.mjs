#!/usr/bin/env node
// Create a new health record session with E2E encryption keypair

import { webcrypto } from 'node:crypto';

// Proxy-aware fetch: Node's built-in fetch ignores https_proxy env var (Bun doesn't need this)
let _fetch = globalThis.fetch;
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    const dispatcher = new ProxyAgent(proxyUrl);
    _fetch = (url, opts) => undiciFetch(url, { ...opts, dispatcher });
  } catch {}
}

const BASE_URL = process.env.BASE_URL || '{{BASE_URL}}';

const keyPair = await webcrypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveBits', 'deriveKey']
);

const publicKeyJwk = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey);
const privateKeyJwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);

const res = await _fetch(`${BASE_URL}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ publicKey: publicKeyJwk })
});

if (!res.ok) {
  console.error(JSON.stringify({ error: `Failed to create session: ${res.status}` }));
  process.exit(1);
}

const { sessionId, userUrl, pollUrl } = await res.json();

console.log(JSON.stringify({
  sessionId,
  userUrl,
  pollUrl,
  privateKeyJwk
}, null, 2));
