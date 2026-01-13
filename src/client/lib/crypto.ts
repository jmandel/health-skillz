// E2E encryption using Web Crypto API
// No abstractions - direct browser API usage

export interface EncryptedPayload {
  encrypted: true;
  ephemeralPublicKey: JsonWebKey;
  iv: number[];
  ciphertext: number[];
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
  fhir: unknown;
  attachments?: unknown;
  providerName: string;
  connectedAt: string;
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

  // Encrypt the full payload including metadata (providerName, connectedAt)
  // This ensures server never sees any PHI or identifying info
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    dataBytes
  );

  return {
    encrypted: true,
    ephemeralPublicKey: ephemeralPublicKeyJwk,
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
  };
}
