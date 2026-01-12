// Session state persistence for OAuth redirect flow

import type { Provider } from './api';

const STORAGE_KEY = 'health_skillz_session';

export interface OAuthState {
  state: string;
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
  oauth?: OAuthState;
}

export function saveSession(session: PersistedSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): PersistedSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function updateProviders(providers: Provider[]): void {
  const session = loadSession();
  if (session) {
    session.providers = providers;
    saveSession(session);
  }
}

// Save OAuth state before redirect
export function saveOAuthState(session: PersistedSession): void {
  saveSession(session);
}

// Clear OAuth state after successful exchange
export function clearOAuthState(): void {
  const session = loadSession();
  if (session) {
    delete session.oauth;
    saveSession(session);
  }
}
