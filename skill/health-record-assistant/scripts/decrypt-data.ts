#!/usr/bin/env bun
// Decrypt health record data and save to files
// Usage: bun decrypt-data.ts <sessionId> <privateKeyJwk> <outputDir>

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = '{{BASE_URL}}';

const sessionId = process.argv[2];
const privateKeyJwkStr = process.argv[3];
const outputDir = process.argv[4];

if (!sessionId || !privateKeyJwkStr || !outputDir) {
  console.error('Usage: bun decrypt-data.ts <sessionId> <privateKeyJwk> <outputDir>');
  process.exit(1);
}

const privateKeyJwk = JSON.parse(privateKeyJwkStr);

// Poll for data
console.log(`Polling session ${sessionId}...`);
const pollRes = await fetch(`${BASE_URL}/api/poll/${sessionId}?timeout=5`);
if (!pollRes.ok) {
  console.error(`Poll failed: ${pollRes.status}`);
  process.exit(1);
}

const pollResult = await pollRes.json();
if (!pollResult.ready || !pollResult.encryptedProviders?.length) {
  console.error('No data ready. Status:', pollResult.status);
  process.exit(1);
}

console.log(`Decrypting ${pollResult.encryptedProviders.length} provider(s)...`);

// Import private key
const privateKey = await crypto.subtle.importKey(
  'jwk',
  privateKeyJwk,
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  ['deriveBits']
);

async function decryptProvider(encrypted: any) {
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'jwk',
    encrypted.ephemeralPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    256
  );

  const aesKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const iv = new Uint8Array(encrypted.iv);
  const ciphertext = new Uint8Array(encrypted.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Create output directory
mkdirSync(outputDir, { recursive: true });

// Decrypt and save each provider
for (const encrypted of pollResult.encryptedProviders) {
  const provider = await decryptProvider(encrypted);
  const slug = slugify(provider.name);
  const filename = `${slug}.json`;
  const filepath = join(outputDir, filename);
  
  writeFileSync(filepath, JSON.stringify(provider, null, 2));
  
  const resourceCount = Object.values(provider.fhir || {}).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
  console.log(`Wrote ${filepath} (${resourceCount} resources, ${provider.attachments?.length || 0} attachments)`);
}

console.log('Done.');
