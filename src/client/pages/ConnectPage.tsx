import { useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, finalizeSession } from '../lib/api';
import { saveSession, loadSession, getFullData, getProvidersSummary } from '../lib/storage';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useSessionStore();

  // Initialize session - restore from storage or fetch from server
  useEffect(() => {
    if (!sessionId) return;

    const init = async () => {
      // Check if we have saved state (returning from OAuth)
      const saved = loadSession();
      if (saved && saved.sessionId === sessionId && saved.publicKeyJwk) {
        store.setSession(sessionId, saved.publicKeyJwk);
        store.setProviders(getProvidersSummary());
        
        // Clean up URL if returning from provider
        const providerAdded = searchParams.get('provider_added');
        if (providerAdded === 'true') {
          window.history.replaceState({}, '', `/connect/${sessionId}`);
        }
        store.setStatus('idle');
        return;
      }

      // Fresh session - fetch public key from server
      store.setStatus('loading');
      try {
        const info = await getSessionInfo(sessionId);
        
        // Store server's public key (AI agent's key for E2E encryption)
        store.setSession(sessionId, info.publicKey);
        // Initialize empty providers list (tracked locally, not on server)
        store.setProviders([]);
        
        // Save to sessionStorage (metadata only, large data goes to IndexedDB)
        saveSession({
          sessionId,
          publicKeyJwk: info.publicKey,
          providerSummaries: [],
        });
        
        store.setStatus('idle');
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    };

    init();
  }, [sessionId, searchParams]);

  const startConnect = useCallback(() => {
    if (!sessionId || !store.publicKeyJwk) return;
    
    // Save state before redirect (metadata only)
    saveSession({
      sessionId,
      publicKeyJwk: store.publicKeyJwk,
      providerSummaries: store.providers.map(p => ({ name: p.name, connectedAt: p.connectedAt })),
    });
    
    // Navigate to provider selection page
    navigate(`/connect/${sessionId}/select`);
  }, [sessionId, store.publicKeyJwk, store.providers, navigate]);

  const handleFinalize = useCallback(async () => {
    if (!sessionId) return;

    store.setStatus('sending');
    try {
      const result = await finalizeSession(sessionId);
      if (result.success) {
        store.setStatus('done');
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : 'Failed to finalize');
    }
  }, [sessionId]);

  const handleDownload = useCallback(async () => {
    const data = await getFullData();
    if (!data) return;
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-records-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  // Loading state
  if (store.status === 'loading' && !store.sessionId) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="loading" message="Loading session..." />
        </div>
      </div>
    );
  }

  // Error state (session not found)
  if (store.status === 'error' && !store.sessionId) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Connect Your Health Records</h1>
          <StatusMessage status="error" message={store.error || 'Session not found'} />
        </div>
      </div>
    );
  }

  // Done state
  if (store.status === 'done') {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Connect Your Health Records</h1>
          <StatusMessage
            status="success"
            message="Success! Your health records have been sent to your AI agent."
          />
          <p style={{ marginTop: '24px', color: '#666' }}>
            You can close this window and return to your AI.
          </p>
        </div>
      </div>
    );
  }

  const hasProviders = store.providers.length > 0;
  const isWorking = ['loading', 'connecting', 'encrypting', 'sending'].includes(store.status);

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Connect Your Health Records</h1>

        {!hasProviders ? (
          // Initial state
          <>
            <div className="warning-box">
              <strong>⚠️ Demo project:</strong> This is an open-source demo hosted on shared infrastructure with no uptime or security guarantees. While data is end-to-end encrypted, no warranties are provided. If connecting real records, understand you're trusting this demo infrastructure. <a href="https://github.com/jmandel/health-skillz" target="_blank" rel="noopener">Source code</a>
            </div>
            <p>
              Click the button below to securely connect to your healthcare provider's
              patient portal. You can connect multiple providers before sending your data
              to your AI agent.
            </p>
            <button
              className="btn"
              onClick={startConnect}
              disabled={isWorking}
            >
              Connect to a Health Provider
            </button>
          </>
        ) : (
          // Connected providers state
          <>
            <p>Connected providers:</p>
            <ProviderList providers={store.providers} />
            <div className="button-group">
              <button
                className="btn btn-secondary"
                onClick={startConnect}
                disabled={isWorking}
              >
                ➕ Add Another Provider
              </button>
              <button
                className="btn btn-success"
                onClick={handleFinalize}
                disabled={isWorking}
              >
                ✅ Done - Send to AI
              </button>
            </div>
            <button
              className="btn btn-link"
              onClick={handleDownload}
              disabled={isWorking}
              style={{ marginTop: '8px' }}
            >
              📥 Download My Records (JSON)
            </button>
          </>
        )}

        {isWorking && (
          <StatusMessage
            status="loading"
            message={
              store.status === 'loading'
                ? 'Processing...'
                : store.status === 'encrypting'
                ? 'Encrypting data...'
                : store.status === 'sending'
                ? 'Sending encrypted data...'
                : 'Connecting...'
            }
          />
        )}

        {store.status === 'error' && store.error && (
          <StatusMessage status="error" message={store.error} />
        )}

        <div className="security-info">
          <p>
            🔒 <strong>End-to-end encrypted</strong>: Your health data is encrypted in your
            browser before transmission. Only your AI agent can decrypt it.
          </p>
        </div>
        <p className="hosting-thanks">Hosted on <a href="https://exe.dev" target="_blank" rel="noopener">exe.dev</a></p>
      </div>
    </div>
  );
}
