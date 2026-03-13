import { loadSessionPublicKey, saveSessionPublicKey } from './storage';

const SESSION_HASH_PARAM = 'hs_session';

interface SessionBootstrapPayload {
  version: 1;
  sessionId: string;
  publicKey: JsonWebKey;
}

function decodeBase64UrlUtf8(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isP256PublicJwk(jwk: unknown): jwk is JsonWebKey {
  if (!jwk || typeof jwk !== 'object') return false;
  const candidate = jwk as JsonWebKey;
  return (
    candidate.kty === 'EC' &&
    candidate.crv === 'P-256' &&
    typeof candidate.x === 'string' &&
    typeof candidate.y === 'string' &&
    typeof candidate.d !== 'string'
  );
}

function parseSessionBootstrapHash(hash: string): SessionBootstrapPayload | null {
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rawHash) return null;

  const params = new URLSearchParams(rawHash);
  const encoded = params.get(SESSION_HASH_PARAM);
  if (!encoded) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64UrlUtf8(encoded));
  } catch {
    throw new Error('This session link has an invalid encryption bootstrap. Ask your AI assistant for a new link.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('This session link has an invalid encryption bootstrap. Ask your AI assistant for a new link.');
  }

  const payload = parsed as Partial<SessionBootstrapPayload>;
  if (payload.version !== 1 || typeof payload.sessionId !== 'string' || !isP256PublicJwk(payload.publicKey)) {
    throw new Error('This session link has an invalid encryption bootstrap. Ask your AI assistant for a new link.');
  }

  return {
    version: 1,
    sessionId: payload.sessionId,
    publicKey: payload.publicKey,
  };
}

export function resolveSessionPublicKey(sessionId: string, hash: string): JsonWebKey {
  const bootstrap = parseSessionBootstrapHash(hash);
  if (bootstrap) {
    if (bootstrap.sessionId !== sessionId) {
      throw new Error('This session link is for a different session. Ask your AI assistant for a new link.');
    }
    saveSessionPublicKey(sessionId, bootstrap.publicKey);
    return bootstrap.publicKey;
  }

  const cached = loadSessionPublicKey(sessionId);
  if (isP256PublicJwk(cached)) return cached;
  if (cached) {
    throw new Error('Stored session encryption key is invalid. Ask your AI assistant to create a new session link.');
  }

  throw new Error('This session link is missing its encryption key. Ask your AI assistant to create a new session link.');
}
