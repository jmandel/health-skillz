// Session state persistence for OAuth redirect flow
// Uses sessionStorage for small metadata, IndexedDB for large health data

import type { Provider } from './api';

const SESSION_KEY = 'health_skillz_session';
const OAUTH_KEY_PREFIX = 'health_skillz_oauth_';
const IDB_NAME = 'health_skillz_db';
const IDB_STORE = 'provider_data';

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
  providerSummaries: Array<{ name: string; connectedAt: string }>;
}

// === IndexedDB helpers ===

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
  });
}

async function idbPut(key: string, data: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const request = store.put({ id: key, data });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

async function idbGet(key: string): Promise<any | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.data || null);
    tx.oncomplete = () => db.close();
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const request = store.delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

// === Session Storage (small metadata only) ===

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

// === Provider Data (large data in IndexedDB) ===

export async function addProviderData(
  sessionId: string,
  providerData: ProviderData
): Promise<void> {
  // Get existing providers from IndexedDB
  const existing = await idbGet(`providers_${sessionId}`) || [];
  existing.push(providerData);
  await idbPut(`providers_${sessionId}`, existing);
  
  // Update session metadata with summary
  const session = loadSession();
  if (session && session.sessionId === sessionId) {
    if (!session.providerSummaries) session.providerSummaries = [];
    session.providerSummaries.push({ 
      name: providerData.name, 
      connectedAt: providerData.connectedAt 
    });
    saveSession(session);
  }
}

export async function getFullData(): Promise<{ providers: ProviderData[] } | null> {
  const session = loadSession();
  if (!session) return null;
  const providers = await idbGet(`providers_${session.sessionId}`) || [];
  return { providers };
}

export function getProvidersSummary(): Array<{ name: string; connectedAt: string }> {
  const session = loadSession();
  if (!session) return [];
  return session.providerSummaries || [];
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
