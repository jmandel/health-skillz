#!/usr/bin/env bun
// Create a new health record session and write a local descriptor file.

import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

type JsonObject = Record<string, unknown>;

const BASE_URL = '{{BASE_URL}}';
const DEFAULT_DESCRIPTOR_PATH = './health-session.json';

interface SessionDescriptor {
  version: 1;
  createdAt: string;
  sessionId: string;
  userUrl: string;
  pollUrl: string;
  publicKeyJwk: JsonObject;
  privateKeyJwk: JsonObject;
}

function encodeBase64UrlUtf8(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function buildUserUrlWithBootstrap(sessionId: string, userUrl: string, publicKeyJwk: JsonObject): string {
  const bootstrap = encodeBase64UrlUtf8(JSON.stringify({
    version: 1,
    sessionId,
    publicKey: publicKeyJwk,
  }));
  return `${userUrl}#hs_session=${bootstrap}`;
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveBits', 'deriveKey']
);

const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonObject;
const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey) as JsonObject;

const res = await fetch(`${BASE_URL}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});

if (!res.ok) {
  const detail = await res.text();
  console.error(JSON.stringify({ error: `Failed to create session: ${res.status}`, detail }));
  process.exit(1);
}

const { sessionId, userUrl, pollUrl } = await res.json();
const descriptorPath = resolve(process.argv[2] || DEFAULT_DESCRIPTOR_PATH);
const descriptor: SessionDescriptor = {
  version: 1,
  createdAt: new Date().toISOString(),
  sessionId,
  userUrl: buildUserUrlWithBootstrap(sessionId, userUrl, publicKeyJwk),
  pollUrl,
  publicKeyJwk,
  privateKeyJwk,
};

mkdirSync(dirname(descriptorPath), { recursive: true });
await Bun.write(descriptorPath, JSON.stringify(descriptor, null, 2));

console.log(JSON.stringify({
  sessionId,
  descriptorPath,
  userUrl: descriptor.userUrl,
  pollUrl,
  createdAt: descriptor.createdAt,
}, null, 2));
