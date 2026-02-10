/**
 * Client assertion (private_key_jwt) for confidential client OAuth.
 *
 * The private key is intentionally public — it ships to every browser.
 * Security comes from PKCE + per-user refresh tokens, not the key.
 * The key just satisfies Epic's "confidential client" checkbox so
 * they'll issue refresh tokens.
 */

const PRIVATE_JWKS_PATH =
  '/.well-known/jwks-intentionally-publishing-private-keys-which-are-not-sensitive-in-this-architecture.json';

interface JWKSResponse {
  keys: JsonWebKey[];
}

// Cache the imported signing key
let cachedSigningKey: { key: CryptoKey; kid: string } | null = null;

/**
 * Fetch the private JWKS and import the signing key into WebCrypto.
 * Cached after first call.
 */
async function getSigningKey(): Promise<{ key: CryptoKey; kid: string }> {
  if (cachedSigningKey) return cachedSigningKey;

  const resp = await fetch(PRIVATE_JWKS_PATH);
  if (!resp.ok) {
    throw new Error(`Failed to fetch private JWKS: ${resp.status}`);
  }
  const jwks: JWKSResponse = await resp.json();
  const jwk = jwks.keys[0];
  if (!jwk) throw new Error('No keys in private JWKS');

  const kid = (jwk as any).kid as string;
  const alg = (jwk as any).alg as string; // "ES384"

  // Map JWA alg to WebCrypto params
  const algMap: Record<string, { name: string; namedCurve: string; hash: string }> = {
    ES256: { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' },
    ES384: { name: 'ECDSA', namedCurve: 'P-384', hash: 'SHA-384' },
    ES512: { name: 'ECDSA', namedCurve: 'P-521', hash: 'SHA-512' },
  };
  const params = algMap[alg];
  if (!params) throw new Error(`Unsupported algorithm: ${alg}`);

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: params.name, namedCurve: params.namedCurve },
    false, // not extractable
    ['sign']
  );

  cachedSigningKey = { key, kid };
  return cachedSigningKey;
}

/**
 * Create a signed JWT client_assertion for the given token endpoint.
 *
 * JWT claims per Epic docs:
 *   iss = sub = clientId
 *   aud = tokenEndpoint
 *   jti = random unique id
 *   iat, nbf = now
 *   exp = now + 5 min
 */
export async function createClientAssertion(
  clientId: string,
  tokenEndpoint: string
): Promise<string> {
  const { key, kid } = await getSigningKey();

  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();

  const header = {
    alg: 'ES384',
    typ: 'JWT',
    kid,
  };

  const payload = {
    iss: clientId,
    sub: clientId,
    aud: tokenEndpoint,
    jti,
    iat: now,
    nbf: now,
    exp: now + 300, // 5 minutes
  };

  const headerB64 = base64UrlEncodeJSON(header);
  const payloadB64 = base64UrlEncodeJSON(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-384' },
    key,
    new TextEncoder().encode(signingInput)
  );

  // ECDSA signature from WebCrypto is IEEE P1363 format (r || s, raw bytes).
  // JWT requires this exact format, NOT DER. So we just base64url it directly.
  const signatureB64 = base64UrlEncodeBytes(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function base64UrlEncodeJSON(obj: unknown): string {
  const json = JSON.stringify(obj);
  return base64UrlEncodeBytes(new TextEncoder().encode(json));
}

function base64UrlEncodeBytes(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
