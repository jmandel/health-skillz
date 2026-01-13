#!/usr/bin/env bun
// Decrypt health record data from encrypted providers
// Usage: echo '<poll-result-json>' | bun decrypt-data.ts '<privateKeyJwk>'

const privateKeyJwkStr = process.argv[2];
if (!privateKeyJwkStr) {
  console.error(JSON.stringify({ error: 'Usage: echo <poll-json> | decrypt-data.ts <privateKeyJwk>' }));
  process.exit(1);
}

const privateKeyJwk = JSON.parse(privateKeyJwkStr);
const input = await Bun.stdin.text();
const pollResult = JSON.parse(input);

if (!pollResult.encryptedProviders?.length) {
  console.error(JSON.stringify({ error: 'No encrypted data in input' }));
  process.exit(1);
}

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

// Decrypt all providers
const providers = await Promise.all(
  pollResult.encryptedProviders.map(decryptProvider)
);

// Output with providers as separate slices (no merging)
console.log(JSON.stringify({ providers }, null, 2));
