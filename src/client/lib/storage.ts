// Session state persistence for OAuth redirect flow

import type { Provider } from './api';

const SESSION_KEY = 'health_skillz_session';
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

export interface PersistedSession {
  sessionId: string;
  publicKeyJwk: JsonWebKey | null;
  providers: Provider[];
}

// === Session Storage (keyed by sessionId) ===

export function saveSession(session: PersistedSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): PersistedSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function updateProviders(providers: Provider[]): void {
  const session = loadSession();
  if (session) {
    session.providers = providers;
    saveSession(session);
  }
}

export function addProvider(sessionId: string, provider: Provider): void {
  const session = loadSession();
  if (session && session.sessionId === sessionId) {
    // Add provider if not already in list
    const exists = session.providers.some(p => p.name === provider.name);
    if (!exists) {
      session.providers.push(provider);
      saveSession(session);
    }
  }
}

// === OAuth State Storage (keyed by state nonce) ===

export function saveOAuthState(stateNonce: string, oauth: OAuthState): void {
  // Use localStorage so it survives cross-origin redirects
  localStorage.setItem(OAUTH_KEY_PREFIX + stateNonce, JSON.stringify(oauth));
}

export function loadOAuthState(stateNonce: string): OAuthState | null {
  const raw = localStorage.getItem(OAUTH_KEY_PREFIX + stateNonce);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearOAuthState(stateNonce: string): void {
  localStorage.removeItem(OAUTH_KEY_PREFIX + stateNonce);
}
