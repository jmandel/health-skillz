import { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getSessionInfo, finalizeSession, sendEncryptedEhrData, logClientError } from '../lib/api';
import { getFullData, clearAllData, loadProviderData } from '../lib/storage';
import { encryptDataAuto } from '../lib/crypto';
import {
  getAllConnections,
  getFhirData,
  saveFhirData,
  updateConnectionToken,
  updateConnectionStatus,
  type SavedConnection,
} from '../lib/connections';
import { refreshAccessToken } from '../lib/smart/oauth';
import { fetchPatientData } from '../lib/smart/client';
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

  const formatAge = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);

  // Saved connections state
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [selectedConnections, setSelectedConnections] = useState<Set<string>>(new Set());
  const [refreshingConn, setRefreshingConn] = useState<string | null>(null);
  const [sendingSelected, setSendingSelected] = useState(false);

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

  // Load saved connections
  useEffect(() => {
    getAllConnections().then(conns => {
      setSavedConnections(conns);
      // Auto-select active connections that have cached data
      const autoSelected = new Set<string>();
      for (const c of conns) {
        if (c.status === 'active' && c.dataSizeBytes) {
          autoSelected.add(c.id);
        }
      }
      setSelectedConnections(autoSelected);
    });
  }, [providers]); // Reload when providers change (after OAuth callback)

  const toggleConnection = useCallback((id: string) => {
    setSelectedConnections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Refresh a saved connection: get new access token, re-fetch FHIR data
  const handleRefreshConnection = useCallback(async (conn: SavedConnection) => {
    if (!publicKeyJwk) return;
    setRefreshingConn(conn.id);
    try {
      // 1. Use refresh token to get new access token
      const tokenResponse = await refreshAccessToken(
        conn.tokenEndpoint,
        conn.clientId,
        conn.refreshToken
      );

      // 2. CRITICAL: save rolling refresh token immediately
      if (tokenResponse.refresh_token) {
        await updateConnectionToken(conn.id, tokenResponse.refresh_token);
      }

      // 3. Fetch fresh FHIR data
      const patientId = tokenResponse.patient || conn.patientId;
      const ehrData = await fetchPatientData(
        conn.fhirBaseUrl,
        tokenResponse.access_token,
        patientId
      );

      // 4. Cache it
      await saveFhirData(conn.id, ehrData.fhir, ehrData.attachments);

      // 5. Reload connections list and auto-select
      const updated = await getAllConnections();
      setSavedConnections(updated);
      setSelectedConnections(prev => new Set([...prev, conn.id]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('400') || msg.includes('401')) {
        await updateConnectionStatus(conn.id, 'expired', msg);
      } else {
        await updateConnectionStatus(conn.id, 'error', msg);
      }
      const updated = await getAllConnections();
      setSavedConnections(updated);
    } finally {
      setRefreshingConn(null);
    }
  }, [publicKeyJwk]);

  // Send selected saved connections' data (encrypt + upload)
  const handleSendSelected = useCallback(async () => {
    if (!sessionId || !publicKeyJwk || selectedConnections.size === 0) return;

    setSendingSelected(true);
    setStatus('sending');

    // Ensure we have a finalize token
    let token = finalizeToken;
    if (!token) {
      token = crypto.randomUUID();
      setSession(sessionId, publicKeyJwk, token);
    }

    try {
      for (const connId of selectedConnections) {
        const cached = await getFhirData(connId);
        if (!cached) continue;

        const conn = savedConnections.find(c => c.id === connId);
        const providerData = {
          name: conn?.providerName || 'Unknown',
          fhirBaseUrl: conn?.fhirBaseUrl || '',
          connectedAt: cached.fetchedAt,
          fhir: cached.fhir,
          attachments: cached.attachments,
        };

        // Save to session storage too (for download/retry)
        await useSessionStore.getState().addProviderData(sessionId, providerData);

        // Encrypt and upload
        const encrypted = await encryptDataAuto(providerData, publicKeyJwk);
        await sendEncryptedEhrData(sessionId, encrypted, token, setUploadProgress);
      }

      // Auto-finalize
      await finalizeSession(sessionId, token);
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send data');
    } finally {
      setSendingSelected(false);
    }
  }, [sessionId, publicKeyJwk, finalizeToken, selectedConnections, savedConnections, setStatus, setError, setSession]);

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

        {/* Saved connections section */}
        {savedConnections.length > 0 && !hasProviders && status !== 'done' && (
          <div style={{ marginBottom: '24px' }}>
            <p style={{ fontWeight: 500, marginBottom: '12px' }}>
              Select saved connections to share:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {savedConnections.map(conn => {
                const hasData = !!conn.dataSizeBytes;
                const isSelected = selectedConnections.has(conn.id);
                const isRefreshing = refreshingConn === conn.id;
                const dataAge = conn.lastFetchedAt
                  ? formatAge(conn.lastFetchedAt)
                  : null;
                const dataMB = conn.dataSizeBytes
                  ? (conn.dataSizeBytes / 1024 / 1024).toFixed(1)
                  : null;

                return (
                  <div
                    key={conn.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px',
                      background: isSelected ? '#f0fdf4' : '#f9fafb',
                      border: `1px solid ${isSelected ? '#bbf7d0' : '#e5e7eb'}`,
                      borderRadius: '8px',
                      opacity: conn.status !== 'active' ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleConnection(conn.id)}
                      disabled={!hasData || conn.status !== 'active' || isRefreshing || sendingSelected}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: '14px' }}>
                        {conn.providerName}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        {conn.status !== 'active' ? (
                          <span style={{ color: '#dc2626' }}>
                            ⚠️ {conn.status === 'expired' ? 'Token expired — re-authorize' : conn.lastError || 'Error'}
                          </span>
                        ) : hasData ? (
                          <span>Data: {dataMB} MB · {dataAge}</span>
                        ) : (
                          <span style={{ color: '#999' }}>No cached data — click refresh</span>
                        )}
                      </div>
                    </div>
                    {conn.status === 'active' && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleRefreshConnection(conn)}
                        disabled={isRefreshing || sendingSelected}
                        style={{ fontSize: '12px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                      >
                        {isRefreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-success"
                onClick={handleSendSelected}
                disabled={selectedConnections.size === 0 || sendingSelected || isWorking}
              >
                {sendingSelected ? 'Sending...' : `✅ Send ${selectedConnections.size} connection${selectedConnections.size !== 1 ? 's' : ''} to AI`}
              </button>
              <button
                className="btn btn-secondary"
                onClick={startConnect}
                disabled={isWorking}
              >
                ➕ Add New Provider
              </button>
            </div>
          </div>
        )}

        {!hasProviders && savedConnections.length === 0 ? (
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
        ) : hasProviders ? (
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
        ) : null}

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
