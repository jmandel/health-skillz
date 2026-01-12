import { useEffect, useCallback, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, sendEncryptedData, finalizeSession, getReceivedEhrData, clearReceivedEhrData } from '../lib/api';
import { encryptData } from '../lib/crypto';
import { saveSession, loadSession, updateProviders } from '../lib/storage';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const store = useSessionStore();
  const [returningFromEhr, setReturningFromEhr] = useState(false);

  // Initialize session - restore from storage or fetch from server
  useEffect(() => {
    if (!sessionId) return;

    const init = async () => {
      // Check if we have saved state (returning from OAuth)
      const saved = loadSession();
      if (saved && saved.sessionId === sessionId) {
        store.setSession(sessionId, saved.publicKeyJwk, saved.privateKeyJwk);
        store.setProviders(saved.providers);
        
        // Check if returning from EHR connector with data
        const ehrDelivered = searchParams.get('ehr_delivered');
        if (ehrDelivered === 'true') {
          setReturningFromEhr(true);
        }
        return;
      }

      // Fresh session - fetch public key from server
      store.setStatus('loading');
      try {
        const info = await getSessionInfo(sessionId);
        
        // Store server's public key (AI agent's key for E2E encryption)
        store.setSession(sessionId, info.publicKey, info.publicKey);
        
        // Save to sessionStorage for OAuth redirect recovery
        saveSession({
          sessionId,
          publicKeyJwk: info.publicKey,
          privateKeyJwk: info.publicKey,
          providers: [],
        });
        
        store.setStatus('idle');
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    };

    init();
  }, [sessionId, searchParams]);

  // Handle returning from EHR connector - fetch, encrypt, and send data
  useEffect(() => {
    if (!returningFromEhr || !sessionId || !store.publicKeyJwk) return;

    const processEhrData = async () => {
      try {
        store.setStatus('loading');
        
        // Fetch the unencrypted data that ehretriever POSTed
        const ehrData = await getReceivedEhrData(sessionId);
        if (!ehrData) {
          store.setStatus('idle');
          setReturningFromEhr(false);
          return;
        }

        store.setStatus('encrypting');
        const encrypted = await encryptData(ehrData, store.publicKeyJwk!);

        store.setStatus('sending');
        const result = await sendEncryptedData(sessionId, encrypted);

        if (result.success) {
          // Clear the temporary unencrypted data
          await clearReceivedEhrData(sessionId);
          
          const provider = {
            name: encrypted.providerName,
            connectedAt: new Date().toISOString(),
          };
          store.addProvider(provider);
          updateProviders([...store.providers, provider]);
          store.setStatus('idle');
        }
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Failed to process EHR data');
      } finally {
        setReturningFromEhr(false);
        // Clean up URL
        window.history.replaceState({}, '', `/connect/${sessionId}`);
      }
    };

    processEhrData();
  }, [returningFromEhr, sessionId, store.publicKeyJwk]);

  const startConnect = useCallback(() => {
    if (!sessionId) return;
    
    // Save state before redirect
    const saved = loadSession();
    if (saved) {
      saveSession({ ...saved, providers: store.providers });
    }
    
    // Set cookie with sessionId for the receive endpoint
    document.cookie = `health_skillz_session_id=${sessionId}; path=/; max-age=3600; SameSite=Lax`;
    
    // Redirect to ehretriever (same tab, not popup)
    // ehretriever will POST to /api/receive-ehr-with-session and redirect back
    const origin = window.location.origin;
    const ehrUrl = `${origin}/ehr-connect/ehretriever.html?brandTags=epic#deliver-to:health-skillz`;
    window.location.href = ehrUrl;
  }, [sessionId, store.providers]);

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
