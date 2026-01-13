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

export interface ProviderData {
  name: string;
  fhirBaseUrl: string;
  connectedAt: string;
  fhir: Record<string, any[]>;
  attachments: any[];
}

export interface PersistedSession {
  sessionId: string;
  publicKeyJwk: JsonWebKey | null;
  providers: ProviderData[];
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

export function addProviderData(
  sessionId: string,
  providerData: ProviderData
): void {
  const session = loadSession();
  if (session && session.sessionId === sessionId) {
    if (!session.providers) session.providers = [];
    session.providers.push(providerData);
    saveSession(session);
  }
}

export function getFullData(): { providers: ProviderData[] } | null {
  const session = loadSession();
  if (!session) return null;
  return {
    providers: session.providers || [],
  };
}

export function getProvidersSummary(): Array<{ name: string; connectedAt: string }> {
  const session = loadSession();
  if (!session) return [];
  return (session.providers || []).map(p => ({ name: p.name, connectedAt: p.connectedAt }));
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
