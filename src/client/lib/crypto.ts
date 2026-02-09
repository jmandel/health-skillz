// E2E encryption using Web Crypto API
// No abstractions - direct browser API usage

export interface EncryptedPayload {
  encrypted: true;
  version: 2;  // v2 = compressed + base64
  ephemeralPublicKey: JsonWebKey;
  iv: string;  // base64 (server converts to number[] for backward compat)
  ciphertext: string;  // base64 of encrypted gzip data
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

export async function exportPrivateKey(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.privateKey);
}

export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey']
  );
}

export interface EncryptionInput {
  name: string;
  fhirBaseUrl: string;
  connectedAt: string;
  fhir: unknown;
  attachments?: unknown;
}

export async function encryptData(
  data: EncryptionInput,
  publicKeyJwk: JsonWebKey
): Promise<EncryptedPayload> {
  // Import recipient's public key
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Generate ephemeral keypair for this encryption
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );

  // Export ephemeral public key to send with ciphertext
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey(
    'jwk',
    ephemeralKeyPair.publicKey
  );

  // Derive shared secret
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    ephemeralKeyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Compress, then encrypt the full payload including metadata
  // This ensures server never sees any PHI or identifying info
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(data));
  
  // Compress with gzip using CompressionStream API
  const compressed = await compress(jsonBytes);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    compressed
  );

  return {
    encrypted: true,
    version: 2,
    ephemeralPublicKey: ephemeralPublicKeyJwk,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  const blob = await new Response(stream).blob();
  return new Uint8Array(await blob.arrayBuffer());
}
