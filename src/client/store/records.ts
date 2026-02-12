import { create } from 'zustand';
import {
  getAllConnections,
  saveConnection,
  deleteConnection as deleteConnectionFromDB,
  clearFhirData,
  getFhirData,
  saveFhirData,
  updateConnectionToken,
  updateConnectionStatus,
  findConnectionByEndpoint,
  type SavedConnection,
  type CachedFhirData,
} from '../lib/connections';
import { refreshAccessToken, buildAuthorizationUrl, generatePKCE } from '../lib/smart/oauth';
import { saveOAuthState, saveFinalizeToken, loadFinalizeToken, clearFinalizeToken } from '../lib/storage';
import { fetchPatientData, type FetchProgress } from '../lib/smart/client';
import {
  encryptData,
  encryptAndUploadStreaming,
  type StreamingProgress,
  type EncryptedChunk,
} from '../lib/crypto';
import { buildLocalSkillZip } from '../lib/skill-builder';
import {
  sendEncryptedEhrData,
  uploadEncryptedChunk,
  finalizeSession as finalizeSess,
  getSessionInfo,
  getVendorConfigs,
} from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GlobalStatus =
  | 'idle'
  | 'loading'          // initial load from IndexedDB
  | 'refreshing'       // refreshing one or more connections
  | 'sending'          // encrypting + uploading to AI
  | 'finalizing'       // finalizing session
  | 'done'             // send/finalize completed
  | 'error';

export interface ConnectionState {
  /** Per-connection transient UI state */
  refreshing: boolean;
  refreshProgress: FetchProgress | null;
  error: string | null;
  /** Set after a successful refresh so the user can see the final progress before dismissing */
  doneMessage: string | null;
}

export interface SessionContext {
  sessionId: string;
  publicKeyJwk: JsonWebKey;
  finalizeToken: string;
  sessionStatus: string; // from server: 'pending', 'has_data', 'finalized'
  pendingChunks: Record<string, { receivedChunks: number[]; totalChunks: number }> | null;
}

interface RecordsState {
  // --- Connections (the persistent data) ---
  connections: SavedConnection[];
  /** Per-connection transient state, keyed by connection ID */
  connectionState: Record<string, ConnectionState>;

  // --- Selection (for session mode) ---
  selected: Set<string>;

  // --- Session context (null = standalone mode) ---
  session: SessionContext | null;

  // --- Global status ---
  status: GlobalStatus;
  statusMessage: string;
  error: string | null;

  // --- Flags ---
  loaded: boolean;
}

interface RecordsActions {
  // Lifecycle
  loadConnections: () => Promise<void>;
  initSession: (sessionId: string) => Promise<void>;
  clearSession: () => void;

  // Selection
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  selectNone: () => void;

  // Connection CRUD
  refreshConnection: (id: string) => Promise<void>;
  reconnectConnection: (id: string) => Promise<void>;
  dismissConnectionDone: (id: string) => void;
  removeConnection: (id: string) => Promise<void>;
  /** Save a new/updated connection + its FHIR data (called after OAuth callback) */
  saveNewConnection: (params: {
    providerName: string;
    fhirBaseUrl: string;
    tokenEndpoint: string;
    clientId: string;
    patientId: string;
    refreshToken: string;
    scopes: string;
    accessToken: string;
  }) => Promise<string>; // returns connection ID

  // Session actions
  sendToAI: () => Promise<void>;
  finalizeSession: () => Promise<void>;

  // Export
  downloadJson: () => Promise<void>;
  downloadSkillZip: () => Promise<void>;

  // Status
  setError: (msg: string) => void;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive an opaque, session-scoped provider key from the session ID and
 * connection ID.  The result is deterministic (so it survives page reload)
 * but different for every session, preventing cross-session correlation.
 */
async function deriveProviderKey(sessionId: string, connectionId: string): Promise<string> {
  const data = new TextEncoder().encode(`${sessionId}:${connectionId}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  // 16 hex chars (64 bits) is plenty for a grouping key
  return Array.from(new Uint8Array(hash).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

function extractPatientIdentity(fhir: Record<string, any[]>): {
  displayName: string | null;
  birthDate: string | null;
} {
  const patients = fhir['Patient'] || [];
  if (patients.length === 0) return { displayName: null, birthDate: null };
  const pt = patients[0];
  const name = pt.name?.[0];
  const display = name
    ? [name.given?.join(' '), name.family].filter(Boolean).join(' ')
    : null;
  return {
    displayName: display || pt.id || null,
    birthDate: pt.birthDate || null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRecordsStore = create<RecordsState & RecordsActions>((set, get) => ({
  // Initial state
  connections: [],
  connectionState: {},
  selected: new Set<string>(),
  session: null,
  status: 'idle',
  statusMessage: '',
  error: null,
  loaded: false,

  // -----------------------------------------------------------------------
  // loadConnections — read all from IndexedDB
  // -----------------------------------------------------------------------
  loadConnections: async () => {
    set({ status: 'loading', statusMessage: 'Loading saved connections…' });
    try {
      const conns = await getAllConnections();
      const connState: Record<string, ConnectionState> = {};
      for (const c of conns) {
        connState[c.id] = { refreshing: false, refreshProgress: null, error: null, doneMessage: null };
      }

      // Pre-select connections with cached data (both modes)
      const selected = new Set(
        conns.filter(c => c.dataSizeBytes && c.dataSizeBytes > 0).map(c => c.id)
      );

      set({
        connections: conns,
        connectionState: connState,
        selected,
        status: 'idle',
        statusMessage: '',
        loaded: true,
      });
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        loaded: true,
      });
    }
  },

  // -----------------------------------------------------------------------
  // initSession — fetch session info from server, set session context
  // -----------------------------------------------------------------------
  initSession: async (sessionId: string) => {
    try {
      const info = await getSessionInfo(sessionId);
      // Restore persisted token so uploads/finalize survive page reloads,
      // or generate a new one for a fresh session.
      let token = loadFinalizeToken(sessionId);
      if (!token) {
        token = crypto.randomUUID();
        saveFinalizeToken(sessionId, token);
      }
      set({
        session: {
          sessionId,
          publicKeyJwk: info.publicKey,
          finalizeToken: token,
          sessionStatus: info.status,
          pendingChunks: info.pendingChunks ?? null,
        },
      });
      // Load connections atomically after session init
      await get().loadConnections();
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearSession: () => {
    const session = get().session;
    if (session) clearFinalizeToken(session.sessionId);
    set({ session: null });
  },

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------
  toggleSelected: (id) => {
    const s = new Set(get().selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    set({ selected: s });
  },
  selectAll: () => {
    set({ selected: new Set(get().connections.map(c => c.id)) });
  },
  selectNone: () => set({ selected: new Set() }),

  // -----------------------------------------------------------------------
  // refreshConnection — use refresh token to get new access, re-fetch FHIR
  // -----------------------------------------------------------------------
  refreshConnection: async (id) => {
    const { connections, connectionState } = get();
    const conn = connections.find(c => c.id === id);
    if (!conn) return;

    // Mark refreshing
    set({
      connectionState: {
        ...get().connectionState,
        [id]: { refreshing: true, refreshProgress: null, error: null, doneMessage: null },
      },
    });

    try {
      // 1. Refresh the access token
      const result = await refreshAccessToken(
        conn.tokenEndpoint,
        conn.clientId,
        conn.refreshToken,
      );

      // 2. MUST save rolling refresh token immediately
      if (result.refresh_token) {
        await updateConnectionToken(id, result.refresh_token);
      }

      // 3. Re-fetch FHIR data with progress
      const patientId = result.patient || conn.patientId;
      const ehrData = await fetchPatientData(
        conn.fhirBaseUrl,
        result.access_token,
        patientId,
        (progress: FetchProgress) => {
          set({
            connectionState: {
              ...get().connectionState,
              [id]: { refreshing: true, refreshProgress: progress, error: null, doneMessage: null },
            },
          });
        },
      );

      // 4. Save data + extract patient identity
      await saveFhirData(id, ehrData.fhir, ehrData.attachments);
      const { displayName, birthDate } = extractPatientIdentity(ehrData.fhir);

      // 5. Update connection metadata
      await updateConnectionStatus(id, 'active');

      // 6. Reload to get fresh state — keep final progress visible until user dismisses
      const conns = await getAllConnections();
      const lastProgress = get().connectionState[id]?.refreshProgress ?? null;
      const newState = { ...get().connectionState };
      newState[id] = {
        refreshing: false,
        refreshProgress: lastProgress,
        error: null,
        doneMessage: 'Updated',
      };
      // Update patientDisplayName/birthDate on the connection in IDB
      const updated = conns.find(c => c.id === id);
      if (updated && (displayName || birthDate)) {
        (updated as any).patientDisplayName = displayName;
        (updated as any).patientBirthDate = birthDate;
        await saveConnection(updated);
      }
      set({ connections: await getAllConnections(), connectionState: newState });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('400') || msg.includes('401') || msg.includes('invalid_grant')) {
        await updateConnectionStatus(id, 'expired', msg);
      } else {
        await updateConnectionStatus(id, 'error', msg);
      }
      set({
        connections: await getAllConnections(),
        connectionState: {
          ...get().connectionState,
          [id]: { refreshing: false, refreshProgress: null, error: msg, doneMessage: null },
        },
      });
    }
  },

  // -----------------------------------------------------------------------
  // dismissConnectionDone — clear the "done" state so progress widget hides
  // -----------------------------------------------------------------------
  dismissConnectionDone: (id) => {
    const cs = get().connectionState[id];
    if (!cs) return;
    set({
      connectionState: {
        ...get().connectionState,
        [id]: { ...cs, refreshProgress: null, doneMessage: null },
      },
    });
  },

  // -----------------------------------------------------------------------
  // reconnectConnection — re-initiate OAuth for a failed/expired connection
  // Uses saved connection metadata so user doesn't have to search again.
  // -----------------------------------------------------------------------
  reconnectConnection: async (id) => {
    const { connections, session } = get();
    const conn = connections.find(c => c.id === id);
    if (!conn) return;

    try {
      // Look up vendor config by clientId
      const vendorConfigs = await getVendorConfigs();
      const vendorEntry = Object.entries(vendorConfigs).find(
        ([, v]) => v.clientId === conn.clientId
      );
      if (!vendorEntry) {
        throw new Error('Vendor configuration not found for this connection');
      }
      const [vendorName, vendorConfig] = vendorEntry;

      const effectiveSessionId = session?.sessionId || 'local_' + crypto.randomUUID();

      // Generate PKCE
      const pkce = await generatePKCE();
      const redirectUri = vendorConfig.redirectUrl || `${window.location.origin}/connect/callback`;

      // Build authorization URL
      const { authUrl, state, tokenEndpoint } = await buildAuthorizationUrl({
        fhirBaseUrl: conn.fhirBaseUrl,
        clientId: conn.clientId,
        scopes: conn.scopes || vendorConfig.scopes,
        redirectUri,
        pkce,
        sessionId: effectiveSessionId,
      });

      // Save OAuth state for callback recovery
      saveOAuthState(state, {
        sessionId: effectiveSessionId,
        publicKeyJwk: session?.publicKeyJwk || null,
        codeVerifier: pkce.codeVerifier,
        tokenEndpoint,
        fhirBaseUrl: conn.fhirBaseUrl,
        clientId: conn.clientId,
        redirectUri,
        providerName: conn.providerName,
      });

      // Redirect to authorization server
      window.location.href = authUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        connectionState: {
          ...get().connectionState,
          [id]: { refreshing: false, refreshProgress: null, error: `Reconnect failed: ${msg}`, doneMessage: null },
        },
      });
    }
  },

  // -----------------------------------------------------------------------
  // removeConnection
  // -----------------------------------------------------------------------
  removeConnection: async (id) => {
    await clearFhirData(id);
    await deleteConnectionFromDB(id);
    const s = new Set(get().selected);
    s.delete(id);
    const newState = { ...get().connectionState };
    delete newState[id];
    set({
      connections: get().connections.filter(c => c.id !== id),
      connectionState: newState,
      selected: s,
    });
  },

  // -----------------------------------------------------------------------
  // saveNewConnection — called from OAuthCallbackPage after token exchange
  // Fetches FHIR data, extracts patient identity, saves everything.
  // Returns the connection ID.
  // -----------------------------------------------------------------------
  saveNewConnection: async (params) => {
    const { providerName, fhirBaseUrl, tokenEndpoint, clientId, patientId,
            refreshToken, scopes, accessToken } = params;

    set({ status: 'loading', statusMessage: 'Fetching health records…' });

    // Check for existing connection (same endpoint + patient)
    const existing = await findConnectionByEndpoint(fhirBaseUrl, patientId);
    const connId = existing?.id ?? crypto.randomUUID();
    const now = new Date().toISOString();

    // Set up connection state
    set({
      connectionState: {
        ...get().connectionState,
        [connId]: { refreshing: true, refreshProgress: null, error: null, doneMessage: null },
      },
    });

    // Fetch FHIR data
    const ehrData = await fetchPatientData(
      fhirBaseUrl,
      accessToken,
      patientId,
      (progress: FetchProgress) => {
        // Derive a status message from rich progress
        const activeLabels = progress.queries
          .filter(q => q.state.status === 'active')
          .slice(0, 3)
          .map(q => q.label);
        const detail = activeLabels.length > 0 ? activeLabels.join(', ') : progress.phase;
        set({
          statusMessage: `Fetching: ${detail} (${progress.settledCount}/${progress.queries.length})`,
          connectionState: {
            ...get().connectionState,
            [connId]: { refreshing: true, refreshProgress: progress, error: null, doneMessage: null },
          },
        });
      },
    );

    // Extract patient identity
    const { displayName, birthDate } = extractPatientIdentity(ehrData.fhir);

    // Build connection object
    const conn: SavedConnection = {
      id: connId,
      providerName,
      fhirBaseUrl,
      tokenEndpoint,
      clientId,
      patientId,
      refreshToken,
      scopes,
      createdAt: existing?.createdAt ?? now,
      lastRefreshedAt: now,
      lastFetchedAt: now,
      dataSizeBytes: JSON.stringify(ehrData.fhir).length,
      status: 'active',
      patientDisplayName: displayName,
      patientBirthDate: birthDate,
    };

    // Save connection + data
    await saveConnection(conn);
    await saveFhirData(connId, ehrData.fhir, ehrData.attachments);

    console.log(`[Connection] Saved ${providerName} (${existing ? 'updated' : 'new'})`);

    // Reload and update store
    const conns = await getAllConnections();
    const connState = { ...get().connectionState };
    connState[connId] = { refreshing: false, refreshProgress: null, error: null, doneMessage: null };

    // Auto-select the new connection in session mode
    const selected = new Set(get().selected);
    if (get().session) selected.add(connId);

    set({
      connections: conns,
      connectionState: connState,
      selected,
      status: 'idle',
      statusMessage: '',
    });

    return connId;
  },

  // -----------------------------------------------------------------------
  // sendToAI — encrypt + upload selected connections' cached data
  // -----------------------------------------------------------------------
  sendToAI: async () => {
    const { session, connections, selected, status } = get();
    if (!session) throw new Error('No active session');
    if (session.sessionStatus === 'finalized') return;  // already done
    if (status === 'sending') return;  // already in progress

    const selectedConns = connections.filter(c => selected.has(c.id));
    if (selectedConns.length === 0) return;

    set({ status: 'sending', statusMessage: 'Preparing data…', error: null });

    try {
      let sentCount = 0;
      for (const conn of selectedConns) {
        const cached = await getFhirData(conn.id);
        if (!cached) continue;

        set({
          statusMessage: `Encrypting & sending ${conn.providerName} (${sentCount + 1}/${selectedConns.length})…`,
        });

        const providerData = {
          name: conn.providerName,
          fhirBaseUrl: conn.fhirBaseUrl,
          connectedAt: cached.fetchedAt,
          fhir: cached.fhir,
          attachments: cached.attachments,
        };

        const jsonSize = JSON.stringify(providerData).length;
        const CHUNK_THRESHOLD = 5 * 1024 * 1024;

        if (jsonSize > CHUNK_THRESHOLD) {
          // Derive a session-scoped provider key: deterministic (survives reload)
          // but not correlatable across sessions since sessionId differs each time.
          const providerKey = await deriveProviderKey(session.sessionId, conn.id);

          // Resume: skip chunks the server already received for THIS provider
          const skipChunks = session.pendingChunks?.[providerKey]?.receivedChunks ?? [];
          if (skipChunks.length > 0) {
            console.log(`[Resume] Skipping ${skipChunks.length} already-uploaded chunks for ${conn.providerName}`);
          }
          await encryptAndUploadStreaming(
            providerData,
            session.publicKeyJwk,
            async (chunk: EncryptedChunk, index: number, isLast: boolean) => {
              await uploadEncryptedChunk(
                session.sessionId,
                session.finalizeToken,
                chunk,
                index,
                isLast ? index + 1 : null,
                providerKey,
              );
            },
            (progress: StreamingProgress) => {
              const pct = progress.totalBytesIn > 0
                ? Math.round((progress.bytesIn / progress.totalBytesIn) * 100)
                : 0;
              set({
                statusMessage: `${conn.providerName}: ${progress.phase} chunk ${progress.currentChunk} (${pct}%)`,
              });
            },
            skipChunks,
          );
        } else {
          const encrypted = await encryptData(providerData, session.publicKeyJwk);
          await sendEncryptedEhrData(
            session.sessionId,
            encrypted,
            session.finalizeToken,
            (progress) => {
              const pct = progress.total > 0
                ? Math.round((progress.loaded / progress.total) * 100)
                : 0;
              set({ statusMessage: `Uploading ${conn.providerName}… ${pct}%` });
            },
          );
        }

        sentCount++;
      }

      // Finalize the session so the AI can retrieve the data
      set({ statusMessage: 'Finalizing session…' });
      await finalizeSess(session.sessionId, session.finalizeToken);
      clearFinalizeToken(session.sessionId);

      set({
        status: 'done',
        statusMessage: `Sent ${sentCount} connection${sentCount !== 1 ? 's' : ''} — session finalized.`,
        session: { ...session, sessionStatus: 'finalized', pendingChunks: null },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: 'error', error: msg, statusMessage: '' });
    }
  },

  // finalizeSession is now integrated into sendToAI above.
  // Keep as a no-op for any callers.
  finalizeSession: async () => {},

  // -----------------------------------------------------------------------
  // downloadJson — export all cached data
  // -----------------------------------------------------------------------
  downloadJson: async () => {
    const { connections, selected } = get();
    const selectedConns = connections.filter(c => selected.has(c.id));
    if (selectedConns.length === 0) return;

    const allData: any[] = [];
    for (const conn of selectedConns) {
      const cached = await getFhirData(conn.id);
      if (cached) {
        allData.push({
          provider: conn.providerName,
          patientDisplayName: conn.patientDisplayName || conn.patientId,
          patientBirthDate: conn.patientBirthDate || null,
          fhir: cached.fhir,
          attachments: cached.attachments,
          fetchedAt: cached.fetchedAt,
        });
      }
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'health-records.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // -----------------------------------------------------------------------
  // downloadSkillZip — build a local skill zip with selected records
  // -----------------------------------------------------------------------
  downloadSkillZip: async () => {
    const { connections, selected } = get();
    const selectedConns = connections.filter(c => selected.has(c.id));
    if (selectedConns.length === 0) return;

    set({ status: 'sending', statusMessage: 'Building skill zip…', error: null });

    try {
      const blob = await buildLocalSkillZip(selectedConns);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'health-record-assistant.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      set({ status: 'idle', statusMessage: '' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ status: 'error', error: msg, statusMessage: '' });
    }
  },

  // -----------------------------------------------------------------------
  // Status helpers
  // -----------------------------------------------------------------------
  setError: (msg) => set({ status: 'error', error: msg }),
  clearError: () => set({ status: 'idle', error: null, statusMessage: '' }),
}));
