import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, finalizeSession } from '../lib/api';
import { getFullData } from '../lib/storage';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    sessionId: storeSessionId,
    publicKeyJwk,
    providers,
    status,
    error,
    initialized,
    init,
    setSession,
    setStatus,
    setError,
    clearError,
  } = useSessionStore();

  // Initialize store and load session
  useEffect(() => {
    if (!sessionId) return;
    
    clearError();
    
    // If store already has this session, we're good
    if (initialized && storeSessionId === sessionId) {
      return;
    }
    
    // Try to init from storage first
    if (!initialized) {
      init();
      return;
    }
    
    // If store has different session or no session, fetch from server
    const loadFromServer = async () => {
      setStatus('loading');
      try {
        const info = await getSessionInfo(sessionId);
        setSession(sessionId, info.publicKey);
        setStatus('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    };
    
    if (storeSessionId !== sessionId) {
      loadFromServer();
    }
  }, [sessionId, initialized, storeSessionId, init, setSession, setStatus, setError, clearError]);

  const startConnect = useCallback(() => {
    if (!sessionId || !publicKeyJwk) return;
    navigate(`/connect/${sessionId}/select`);
  }, [sessionId, publicKeyJwk, navigate]);

  const handleFinalize = useCallback(async () => {
    if (!sessionId) return;

    setStatus('sending');
    try {
      const result = await finalizeSession(sessionId);
      if (result.success) {
        setStatus('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize');
    }
  }, [sessionId, setStatus, setError]);

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

  // Loading state
  if (status === 'loading' || !initialized) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="loading" message="Loading session..." />
        </div>
      </div>
    );
  }

  // Error state (session not found)
  if (status === 'error' && !storeSessionId) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Connect Your Health Records</h1>
          <StatusMessage status="error" message={error || 'Session not found'} />
        </div>
      </div>
    );
  }

  // Done state
  if (status === 'done') {
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

  const hasProviders = providers.length > 0;
  const isWorking = ['loading', 'connecting', 'encrypting', 'sending'].includes(status);

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Connect Your Health Records</h1>

        {!hasProviders ? (
          <>
            <div className="warning-box">
              <strong>⚠️ Demo project:</strong> This is an open-source demo hosted on shared infrastructure with no uptime or security guarantees. While data is end-to-end encrypted, no warranties are provided. If connecting real records, understand you're trusting this demo infrastructure. <a href="https://github.com/jmandel/health-skillz" target="_blank" rel="noopener">Source code</a>
            </div>
            <p>
              Click the button below to securely connect to your healthcare provider's
              patient portal. You can connect multiple providers before sending your data
              to your AI agent.
            </p>
            <button className="btn" onClick={startConnect} disabled={isWorking}>
              Connect to a Health Provider
            </button>
          </>
        ) : (
          <>
            <p>Connected providers:</p>
            <ProviderList providers={providers} />
            <div className="button-group">
              <button className="btn btn-secondary" onClick={startConnect} disabled={isWorking}>
                ➕ Add Another Provider
              </button>
              <button className="btn btn-success" onClick={handleFinalize} disabled={isWorking}>
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
              status === 'encrypting' ? 'Encrypting data...' :
              status === 'sending' ? 'Sending encrypted data...' :
              'Connecting...'
            }
          />
        )}

        {status === 'error' && error && (
          <StatusMessage status="error" message={error} />
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
