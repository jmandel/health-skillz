import { useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, finalizeSession } from '../lib/api';
import { saveSession, loadSession } from '../lib/storage';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const store = useSessionStore();

  // Initialize session - restore from storage or fetch from server
  useEffect(() => {
    if (!sessionId) return;

    const init = async () => {
      // Check if we have saved state (returning from OAuth)
      const saved = loadSession();
      if (saved && saved.sessionId === sessionId) {
        store.setSession(sessionId, saved.publicKeyJwk, saved.publicKeyJwk);
        store.setProviders(saved.providers);
        
        // Check if returning from EHR connector with new provider
        const providerAdded = searchParams.get('provider_added');
        if (providerAdded === 'true') {
          // Refresh provider count from what we know
          // The actual encrypted data was already stored server-side
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
        store.setSession(sessionId, info.publicKey, info.publicKey);
        
        // Save to sessionStorage for ehretriever's encryption code to read
        saveSession({
          sessionId,
          publicKeyJwk: info.publicKey,
          providers: [],
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
    
    // Save state before redirect (ehretriever's encryption code reads from this)
    saveSession({
      sessionId,
      publicKeyJwk: store.publicKeyJwk,
      providers: store.providers,
    });
    
    // Redirect to ehretriever (same tab)
    // ehretriever will encrypt client-side and POST to /api/receive-ehr
    const origin = window.location.origin;
    const ehrUrl = `${origin}/ehr-connect/ehretriever.html?brandTags=epic#deliver-to:health-skillz`;
    window.location.href = ehrUrl;
  }, [sessionId, store.publicKeyJwk, store.providers]);

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
            message="Success! Your health records have been sent. You can close this window and return to your AI agent."
          />
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
      </div>
    </div>
  );
}
