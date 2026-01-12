import { create } from 'zustand';
import type { Provider } from '../lib/api';

export type Status = 'idle' | 'loading' | 'connecting' | 'encrypting' | 'sending' | 'done' | 'error';

interface SessionState {
  sessionId: string | null;
  publicKeyJwk: JsonWebKey | null;
  privateKeyJwk: JsonWebKey | null;
  providers: Provider[];
  status: Status;
  error: string | null;
}

interface SessionActions {
  setSession: (id: string, publicKey: JsonWebKey, privateKey: JsonWebKey) => void;
  addProvider: (provider: Provider) => void;
  setProviders: (providers: Provider[]) => void;
  setStatus: (status: Status) => void;
  setError: (error: string) => void;
  clear: () => void;
}

const initialState: SessionState = {
  sessionId: null,
  publicKeyJwk: null,
  privateKeyJwk: null,
  providers: [],
  status: 'idle',
  error: null,
};

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  ...initialState,

  setSession: (id, publicKey, privateKey) =>
    set({
      sessionId: id,
      publicKeyJwk: publicKey,
      privateKeyJwk: privateKey,
      status: 'idle',
      error: null,
    }),

  addProvider: (provider) =>
    set((state) => ({
      providers: [...state.providers, provider],
    })),

  setProviders: (providers) => set({ providers }),

  setStatus: (status) => set({ status, error: status === 'error' ? undefined : null }),

  setError: (error) => set({ error, status: 'error' }),

  clear: () => set(initialState),
}));
