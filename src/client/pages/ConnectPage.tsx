import { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, finalizeSession, sendEncryptedEhrData, logClientError } from '../lib/api';
import { getFullData, clearAllData, loadProviderData } from '../lib/storage';
import { encryptDataAuto } from '../lib/crypto';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const uploadFailed = searchParams.get('upload_failed') === 'true';
  const {
    sessionId: storeSessionId,
    publicKeyJwk,
    finalizeToken,
    providers,
    status,
    error,
    initialized,
    uploadError,
    init,
    setSession,
    setStatus,
    setError,
    clearError,
  } = useSessionStore();

  const [dataCleared, setDataCleared] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Initialize store and load session
  useEffect(() => {
    if (!sessionId) return;
    
    clearError();
    
    // Try to init from storage first
    if (!initialized) {
      init();
      return;
    }

    // Check server-side status (handles finalized sessions, new tabs, etc.)
    const syncWithServer = async () => {
      try {
        const info = await getSessionInfo(sessionId);
        if (storeSessionId !== sessionId) {
          setStatus('loading');
          setSession(sessionId, info.publicKey);
        }
        if (info.status === 'finalized') {
          setStatus('done');
        } else if (storeSessionId !== sessionId) {
          setStatus('idle');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    };

    syncWithServer();
  }, [sessionId, initialized, storeSessionId, init, setSession, setStatus, setError, clearError]);

  const startConnect = useCallback(() => {
    if (!sessionId || !publicKeyJwk) return;
    navigate(`/connect/${sessionId}/select`);
  }, [sessionId, publicKeyJwk, navigate]);

  const handleFinalize = useCallback(async () => {
    if (!sessionId) return;

    setStatus('sending');
    try {
      const result = await finalizeSession(sessionId, finalizeToken ?? undefined);
      if (result.success) {
        setStatus('done');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to finalize');
    }
  }, [sessionId, finalizeToken, setStatus, setError]);

  const handleRetryUpload = useCallback(async () => {
    if (!sessionId || !publicKeyJwk || !finalizeToken) return;
    
    setUploadProgress(null);
    setStatus('sending');
    clearError();
    
    try {
      // Get stored provider data and re-encrypt/upload each
      const providerData = await loadProviderData(sessionId);
      if (!providerData || providerData.length === 0) {
        throw new Error('No provider data found locally');
      }
      
      for (const provider of providerData) {
        const encrypted = await encryptDataAuto(provider, publicKeyJwk);
        await sendEncryptedEhrData(sessionId, encrypted, finalizeToken, setUploadProgress);
      }
      
      // Success - clear the upload_failed flag and redirect
      useSessionStore.getState().setUploadFailed(false);
      navigate(`/connect/${sessionId}?provider_added=true`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const httpStatusMatch = errorMsg.match(/Server returned (\d+)/);
      const httpStatus = httpStatusMatch ? parseInt(httpStatusMatch[1]) : undefined;
      
      const logResult = await logClientError({
        sessionId,
        errorCode: 'retry_upload_failed',
        httpStatus,
        context: 'retry_from_connect_page',
      });
      
      const errorDetails = [
        `Error ID: ${logResult.errorId || 'not-logged'}`,
        `Time: ${new Date().toISOString()}`,
        `Session: ${sessionId}`,
        `HTTP Status: ${httpStatus || 'unknown'}`,
        `Error: ${errorMsg}`,
      ].join('\n');
      
      useSessionStore.getState().setUploadFailed(true, errorDetails);
      setStatus('idle');
    }
  }, [sessionId, publicKeyJwk, finalizeToken, navigate, setStatus, clearError]);

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

  // Error state (session not found or mismatch)
  if (status === 'error' || (sessionId && storeSessionId && sessionId !== storeSessionId)) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Connect Your Health Records</h1>
          <StatusMessage status="error" message={error || 'Session not found or expired'} />
        </div>
      </div>
    );
  }

  // Upload failed state - data saved locally but not sent to server
  if (uploadFailed && providers.length > 0) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Upload Failed</h1>
          <StatusMessage
            status="error"
            message="Could not send data to server, but your records are saved locally."
          />
          
          <div style={{ marginTop: '20px', padding: '16px', background: '#f8f9fa', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 12px 0', fontWeight: 500 }}>What you can do:</p>
            <button
              className="btn btn-primary"
              onClick={handleDownload}
              style={{ width: '100%', marginBottom: '8px' }}
            >
              📥 Download Records &amp; Share Manually
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleRetryUpload}
              disabled={status === 'sending'}
              style={{ width: '100%' }}
            >
              {status === 'sending' 
                ? (uploadProgress 
                    ? `Uploading... ${Math.round(uploadProgress.loaded / 1024)} / ${Math.round(uploadProgress.total / 1024)} KB`
                    : 'Uploading...')
                : '🔄 Retry Upload'}
            </button>
          </div>

          {uploadError && (
            <div style={{ marginTop: '20px', padding: '16px', background: '#fff3cd', borderRadius: '8px', border: '1px solid #ffc107' }}>
              <p style={{ margin: '0 0 8px 0', fontWeight: 500, fontSize: '14px' }}>⚠️ Error Details</p>
              <pre style={{ 
                margin: '0 0 12px 0',
                padding: '12px', 
                background: '#fff', 
                borderRadius: '4px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                fontSize: '12px',
                border: '1px solid #ddd'
              }}>
                {uploadError}
              </pre>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(uploadError);
                  alert('Error details copied to clipboard');
                }}
                style={{ fontSize: '13px' }}
              >
                📋 Copy Error Details
              </button>
            </div>
          )}

          <button
            className="btn btn-link"
            onClick={async () => {
              await clearAllData();
              init();
              navigate(`/connect/${sessionId}`);
            }}
            style={{ marginTop: '16px', color: '#999', fontSize: '13px' }}
          >
            Clear data and start over
          </button>
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
            message="Your health records have been sent to your AI agent."
          />
          <p style={{ marginTop: '24px', color: '#666' }}>
            You can close this window and return to your AI.
          </p>
          {!dataCleared ? (
            <>
              <button
                className="btn btn-link"
                onClick={handleDownload}
                style={{ marginTop: '8px' }}
              >
                📥 Download My Records (JSON)
              </button>
              <button
                className="btn btn-link"
                onClick={async () => {
                  await clearAllData();
                  init();
                  setDataCleared(true);
                }}
                style={{ marginTop: '4px', color: '#999' }}
              >
                Clear data from my browser
              </button>
            </>
          ) : (
            <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
              All health data has been cleared from your browser.
            </p>
          )}
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
            {!dataCleared ? (
              <button
                className="btn btn-link"
                onClick={async () => {
                  await clearAllData();
                  init(); // re-read (now empty) storage into the store
                  setDataCleared(true);
                }}
                disabled={isWorking}
                style={{ marginTop: '4px', color: '#999' }}
              >
                Clear data from my browser
              </button>
            ) : (
              <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
                All health data has been cleared from your browser.
              </p>
            )}
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
