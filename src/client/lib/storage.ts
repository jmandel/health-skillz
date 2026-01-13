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
  fhirData?: Record<string, any[]>;
  attachments?: any[];
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

export function addProvider(
  sessionId: string,
  provider: Provider,
  fhirData?: Record<string, any[]>,
  attachments?: any[]
): void {
  const session = loadSession();
  if (session && session.sessionId === sessionId) {
    const exists = session.providers.some(p => p.name === provider.name);
    if (!exists) {
      session.providers.push(provider);
    }
    if (fhirData) {
      if (!session.fhirData) session.fhirData = {};
      for (const [resourceType, resources] of Object.entries(fhirData)) {
        if (!session.fhirData[resourceType]) session.fhirData[resourceType] = [];
        session.fhirData[resourceType].push(...resources);
      }
    }
    if (attachments) {
      if (!session.attachments) session.attachments = [];
      session.attachments.push(...attachments);
    }
    saveSession(session);
  }
}

export function getFullData(): { fhir: Record<string, any[]>; attachments: any[]; providers: Provider[] } | null {
  const session = loadSession();
  if (!session) return null;
  return {
    fhir: session.fhirData || {},
    attachments: session.attachments || [],
    providers: session.providers || [],
  };
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
