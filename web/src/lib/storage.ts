// Session state persistence for OAuth redirect flow

import type { Provider } from './api';

const STORAGE_KEY = 'health_skillz_session';

export interface PersistedSession {
  sessionId: string;
  publicKeyJwk: JsonWebKey;
  providers: Provider[];
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
