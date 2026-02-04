import { create } from 'zustand';
import type { Provider } from '../lib/api';
import {
  saveSession,
  loadSession,
  getProvidersSummary,
  addProviderData as addProviderToStorage,
  clearAllData,
  markSessionFinalized,
  type ProviderData
} from '../lib/storage';

export type Status = 'idle' | 'loading' | 'connecting' | 'encrypting' | 'sending' | 'saving' | 'done' | 'error';

interface SessionState {
  sessionId: string | null;
  publicKeyJwk: JsonWebKey | null;
  finalizeToken: string | null;
  providers: Provider[];
  finalized: boolean;
  status: Status;
  error: string | null;
  initialized: boolean;
}

interface SessionActions {
  // Initialize from storage
  init: () => void;
  
  // Set session (for agent flow)
  setSession: (id: string, publicKey: JsonWebKey | null, finalizeToken?: string) => void;
  
  // Create new local session
  createLocalSession: () => void;
  
  // Add a provider (updates both store and storage)
  addProvider: (provider: Provider) => void;
  
  // Add full provider data (for after OAuth)
  addProviderData: (sessionId: string, data: ProviderData) => Promise<void>;
  
  // Set providers list
  setProviders: (providers: Provider[]) => void;
  
  // Status management
  setStatus: (status: Status) => void;
  setError: (error: string) => void;
  clearError: () => void;
  
  // Mark session as finalized (persists to storage)
  markFinalized: () => void;

  // Clear everything and start fresh
  clearAndReset: () => Promise<void>;
}

function generateLocalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'local_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const initialState: SessionState = {
  sessionId: null,
  publicKeyJwk: null,
  finalizeToken: null,
  providers: [],
  finalized: false,
  status: 'idle',
  error: null,
  initialized: false,
};

export const useSessionStore = create<SessionState & SessionActions>((set, get) => ({
  ...initialState,

  init: () => {
    const saved = loadSession();
    if (saved && saved.sessionId) {
      set({
        sessionId: saved.sessionId,
        publicKeyJwk: saved.publicKeyJwk,
        finalizeToken: saved.finalizeToken || null,
        providers: saved.providerSummaries?.map(p => ({ name: p.name, connectedAt: p.connectedAt })) || [],
        finalized: saved.finalized || false,
        initialized: true,
      });
    } else {
      set({ initialized: true });
    }
  },

  setSession: (id, publicKey, finalizeToken) => {
    // Check if we already have this session in storage (e.g., from another tab)
    const existing = loadSession();
    if (existing && existing.sessionId === id) {
      // Reuse existing session data — don't overwrite providers
      set({
        sessionId: id,
        publicKeyJwk: publicKey ?? existing.publicKeyJwk,
        finalizeToken: finalizeToken ?? existing.finalizeToken ?? null,
        providers: existing.providerSummaries?.map(p => ({ name: p.name, connectedAt: p.connectedAt })) || [],
        finalized: existing.finalized || false,
        status: 'idle',
        error: null,
        initialized: true,
      });
      // Persist finalizeToken if it was newly provided
      if (finalizeToken && !existing.finalizeToken) {
        saveSession({ ...existing, finalizeToken });
      }
    } else {
      saveSession({
        sessionId: id,
        publicKeyJwk: publicKey,
        providerSummaries: [],
        finalizeToken,
      });
      set({
        sessionId: id,
        publicKeyJwk: publicKey,
        finalizeToken: finalizeToken ?? null,
        providers: [],
        finalized: false,
        status: 'idle',
        error: null,
        initialized: true,
      });
    }
  },

  createLocalSession: () => {
    const newId = generateLocalId();
    saveSession({
      sessionId: newId,
      publicKeyJwk: null,
      providerSummaries: [],
    });
    set({
      sessionId: newId,
      publicKeyJwk: null,
      providers: [],
      status: 'idle',
      error: null,
      initialized: true,
    });
  },

  addProvider: (provider) => {
    set((state) => ({
      providers: [...state.providers, provider],
    }));
  },

  addProviderData: async (sessionId, data) => {
    await addProviderToStorage(sessionId, data);
    // Update store with the new provider
    set((state) => ({
      providers: [...state.providers, { name: data.name, connectedAt: data.connectedAt }],
    }));
  },

  setProviders: (providers) => set({ providers }),

  setStatus: (status) => set({ status, error: status === 'error' ? get().error : null }),

  setError: (error) => set({ error, status: 'error' }),

  clearError: () => set({ error: null, status: 'idle' }),

  markFinalized: () => {
    markSessionFinalized();
    set({ finalized: true });
  },

  clearAndReset: async () => {
    await clearAllData();
    const newId = generateLocalId();
    saveSession({
      sessionId: newId,
      publicKeyJwk: null,
      providerSummaries: [],
    });
    set({
      sessionId: newId,
      publicKeyJwk: null,
      providers: [],
      status: 'idle',
      error: null,
      initialized: true,
    });
  },
}));
