// OAuth state persistence for cross-origin redirect flow
// Uses sessionStorage (keyed by state nonce, cleared after use)

const OAUTH_KEY_PREFIX = 'health_skillz_oauth_';

export interface OAuthState {
  sessionId: string;
  publicKeyJwk: JsonWebKey | null;
  codeVerifier: string;
  tokenEndpoint: string;
  fhirBaseUrl: string;
  clientId: string;
  redirectUri: string;
  providerName: string;
}

// === OAuth State Storage (keyed by state nonce) ===

export function saveOAuthState(stateNonce: string, oauth: OAuthState): void {
  sessionStorage.setItem(OAUTH_KEY_PREFIX + stateNonce, JSON.stringify(oauth));
}

export function loadOAuthState(stateNonce: string): OAuthState | null {
  const raw = sessionStorage.getItem(OAUTH_KEY_PREFIX + stateNonce);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearOAuthState(stateNonce: string): void {
  sessionStorage.removeItem(OAUTH_KEY_PREFIX + stateNonce);
}
