import { useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, sendEncryptedData, finalizeSession } from '../lib/api';
import { encryptData } from '../lib/crypto';
import { saveSession, loadSession, updateProviders } from '../lib/storage';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const store = useSessionStore();

  // Initialize session - either restore from storage or fetch from server
  useEffect(() => {
    if (!sessionId) return;

    const init = async () => {
      // Check if we have saved state (returning from OAuth)
      const saved = loadSession();
      if (saved && saved.sessionId === sessionId) {
        store.setSession(sessionId, saved.publicKeyJwk, saved.privateKeyJwk);
        store.setProviders(saved.providers);
        return;
      }

      // Fresh session - fetch public key from server
      store.setStatus('loading');
      try {
        const info = await getSessionInfo(sessionId);
        
        // Store server's public key (Claude's key for E2E encryption)
        // We don't need a local keypair - we encrypt TO Claude's public key
        store.setSession(sessionId, info.publicKey, info.publicKey); // publicKey twice since we only need it for encryption
        
        // Save to sessionStorage for OAuth redirect recovery
        saveSession({
          sessionId,
          publicKeyJwk: info.publicKey,
          privateKeyJwk: info.publicKey, // Not used, but keeps interface consistent
          providers: [],
        });
        
        store.setStatus('idle');
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    };

    init();
  }, [sessionId]);

  // Listen for postMessage from EHR connector popup
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return;
      if (!event.data?.fhir) return;
      if (!store.publicKeyJwk || !sessionId) return;

      try {
        store.setStatus('encrypting');
        const encrypted = await encryptData(event.data, store.publicKeyJwk);

        store.setStatus('sending');
        const result = await sendEncryptedData(sessionId, encrypted);

        if (result.success) {
          const provider = {
            name: encrypted.providerName,
            connectedAt: new Date().toISOString(),
          };
          store.addProvider(provider);
          updateProviders([...store.providers, provider]);
          store.setStatus('idle');
        }
      } catch (err) {
        store.setError(err instanceof Error ? err.message : 'Failed to send data');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sessionId, store.publicKeyJwk, store.providers]);

  const openConnector = useCallback(() => {
    const origin = window.location.origin;
    const connectorUrl = `${origin}/ehr-connect/ehretriever.html?brandTags=epic#deliver-to-opener:${encodeURIComponent(origin)}`;
    window.open(connectorUrl, 'ehrConnector', 'width=900,height=700');
    store.setStatus('connecting');
  }, []);

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
  if (store.status === 'loading') {
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
            message="Success! Your health records have been sent. You can close this window and return to Claude."
          />
        </div>
      </div>
    );
  }

  const hasProviders = store.providers.length > 0;
  const isWorking = ['connecting', 'encrypting', 'sending'].includes(store.status);

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
              to Claude.
            </p>
            <button
              className="btn"
              onClick={openConnector}
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
                onClick={openConnector}
                disabled={isWorking}
              >
                ➕ Add Another Provider
              </button>
              <button
                className="btn btn-success"
                onClick={handleFinalize}
                disabled={isWorking}
              >
                ✅ Done - Send to Claude
              </button>
            </div>
          </>
        )}

        {store.status !== 'idle' && (
          <StatusMessage
            status={store.status === 'error' ? 'error' : 'loading'}
            message={
              store.error ||
              (store.status === 'connecting'
                ? 'Complete sign-in in the popup window...'
                : store.status === 'encrypting'
                ? 'Encrypting data...'
                : store.status === 'sending'
                ? 'Sending encrypted data to server...'
                : '')
            }
          />
        )}

        <div className="security-info">
          <p>
            🔒 <strong>End-to-end encrypted</strong>: Your health data is encrypted in your
            browser before transmission. Only Claude can decrypt it.
          </p>
        </div>
      </div>
    </div>
  );
}
