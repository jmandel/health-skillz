#!/usr/bin/env bun
// Finalize a health record session: poll until ready, decrypt, save to files
// Usage: bun finalize-session.ts <sessionId> <privateKeyJwk> <outputDir>

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE_URL = '{{BASE_URL}}';

const sessionId = process.argv[2];
const privateKeyJwkStr = process.argv[3];
const outputDir = process.argv[4];

if (!sessionId || !privateKeyJwkStr || !outputDir) {
  console.error('Usage: bun finalize-session.ts <sessionId> <privateKeyJwk> <outputDir>');
  process.exit(1);
}

const privateKeyJwk = JSON.parse(privateKeyJwkStr);

// Poll until ready
console.log(JSON.stringify({ status: 'polling', sessionId }));

let attempts = 0;
const maxAttempts = 60; // 30 mins with 30s polls
let pollResult: any = null;

while (attempts < maxAttempts) {
  const pollRes = await fetch(`${BASE_URL}/api/poll/${sessionId}?timeout=30`);
  
  if (!pollRes.ok) {
    console.log(JSON.stringify({ status: 'error', error: `Poll failed: ${pollRes.status}` }));
    process.exit(1);
  }

  pollResult = await pollRes.json();
  
  if (pollResult.ready) {
    console.log(JSON.stringify({ 
      status: 'ready', 
      providerCount: pollResult.encryptedProviders?.length || 0 
    }));
    break;
  }

  console.log(JSON.stringify({ 
    status: 'waiting', 
    sessionStatus: pollResult.status,
    providerCount: pollResult.providerCount || 0,
    attempt: attempts + 1
  }));
  
  attempts++;
}

if (!pollResult?.ready) {
  console.log(JSON.stringify({ status: 'timeout', message: 'Session not finalized within time limit' }));
  process.exit(1);
}

// Decrypt
console.log(JSON.stringify({ status: 'decrypting' }));

const privateKey = await crypto.subtle.importKey(
  'jwk',
  privateKeyJwk,
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  ['deriveBits']
);

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

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

  // v2 payloads are gzip compressed; v1 are plain JSON
  let jsonBytes: Uint8Array;
  if (encrypted.version === 2) {
    jsonBytes = await decompress(new Uint8Array(decrypted));
  } else {
    jsonBytes = new Uint8Array(decrypted);
  }

  return JSON.parse(new TextDecoder().decode(jsonBytes));
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
const files: string[] = [];
const usedNames = new Map<string, number>();

for (const encrypted of pollResult.encryptedProviders) {
  const provider = await decryptProvider(encrypted);
  const baseSlug = slugify(provider.name);
  
  // Handle duplicate names
  const count = usedNames.get(baseSlug) || 0;
  usedNames.set(baseSlug, count + 1);
  const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
  
  const filename = `${slug}.json`;
  const filepath = join(outputDir, filename);
  
  writeFileSync(filepath, JSON.stringify(provider, null, 2));
  files.push(filepath);
  
  const resourceCount = Object.values(provider.fhir || {}).reduce((sum: number, arr: any) => sum + (arr?.length || 0), 0);
  console.log(JSON.stringify({ 
    status: 'wrote_file', 
    file: filepath, 
    provider: provider.name,
    resources: resourceCount, 
    attachments: provider.attachments?.length || 0 
  }));
}

console.log(JSON.stringify({ status: 'done', files }));
