import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAllConnections,
  deleteConnection,
  deleteAllConnections,
  updateConnectionToken,
  updateConnectionStatus,
  saveFhirData,
  clearFhirData,
  type SavedConnection,
} from '../lib/connections';
import { refreshAccessToken } from '../lib/smart/oauth';
import { fetchPatientData } from '../lib/smart/client';
import StatusMessage from '../components/StatusMessage';

type RefreshingState = Record<string, 'refreshing' | 'success' | 'error'>;

export default function ConnectionsPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<RefreshingState>({});

  const reload = useCallback(async () => {
    const conns = await getAllConnections();
    setConnections(conns);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleRefresh = useCallback(async (conn: SavedConnection) => {
    setRefreshing(s => ({ ...s, [conn.id]: 'refreshing' }));
    try {
      // 1. Get new access token via refresh token
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

      setRefreshing(s => ({ ...s, [conn.id]: 'success' }));
      setTimeout(() => {
        setRefreshing(s => { const n = { ...s }; delete n[conn.id]; return n; });
        reload();
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('400') || msg.includes('401')) {
        await updateConnectionStatus(conn.id, 'expired', msg);
      } else {
        await updateConnectionStatus(conn.id, 'error', msg);
      }
      setRefreshing(s => ({ ...s, [conn.id]: 'error' }));
      setTimeout(() => {
        setRefreshing(s => { const n = { ...s }; delete n[conn.id]; return n; });
        reload();
      }, 3000);
    }
  }, [reload]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('Remove this connection? You\'ll need to re-authorize to reconnect.')) return;
    await deleteConnection(id);
    reload();
  }, [reload]);

  const handleDeleteAll = useCallback(async () => {
    if (!confirm('Remove ALL saved connections?')) return;
    await deleteAllConnections();
    reload();
  }, [reload]);

  const formatAge = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="loading" message="Loading connections..." />
        </div>
      </div>
    );
  }

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Saved Connections</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          These are your saved health provider connections. Refresh tokens are
          stored in your browser only — the server never sees them.
        </p>

        {connections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ color: '#999', fontSize: '16px' }}>No saved connections yet.</p>
            <p style={{ color: '#999', fontSize: '14px' }}>
              Connect to a health provider through a session to save a connection.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {connections.map(conn => (
                <div
                  key={conn.id}
                  style={{
                    padding: '16px',
                    background: conn.status === 'active' ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${conn.status === 'active' ? '#bbf7d0' : '#fecaca'}`,
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>{conn.providerName}</strong>
                      <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
                        Patient: {conn.patientId.slice(0, 20)}...
                      </div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                        Created {formatAge(conn.createdAt)}
                        {' · '}
                        Token refreshed {formatAge(conn.lastRefreshedAt)}
                        {conn.dataSizeBytes ? (
                          <>{' · '}{(conn.dataSizeBytes / 1024 / 1024).toFixed(1)} MB cached{conn.lastFetchedAt ? ` (${formatAge(conn.lastFetchedAt)})` : ''}</>
                        ) : null}
                      </div>
                      {conn.status !== 'active' && (
                        <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>
                          ⚠️ {conn.status === 'expired' ? 'Token expired' : conn.lastError || 'Error'}
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: '12px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: conn.status === 'active' ? '#dcfce7' : '#fee2e2',
                      color: conn.status === 'active' ? '#166534' : '#991b1b',
                    }}>
                      {conn.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    {conn.status === 'active' && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleRefresh(conn)}
                        disabled={!!refreshing[conn.id]}
                        style={{ fontSize: '13px', padding: '6px 12px' }}
                      >
                        {refreshing[conn.id] === 'refreshing' ? '⏳ Refreshing...' :
                         refreshing[conn.id] === 'success' ? '✅ Refreshed!' :
                         refreshing[conn.id] === 'error' ? '❌ Failed' :
                         '🔄 Test Refresh'}
                      </button>
                    )}
                    {conn.status !== 'active' && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleRefresh(conn)}
                        disabled={!!refreshing[conn.id]}
                        style={{ fontSize: '13px', padding: '6px 12px' }}
                      >
                        🔄 Retry
                      </button>
                    )}
                    {conn.dataSizeBytes ? (
                      <button
                        className="btn btn-link"
                        onClick={async () => {
                          await clearFhirData(conn.id);
                          reload();
                        }}
                        style={{ fontSize: '13px', color: '#999' }}
                      >
                        Clear data
                      </button>
                    ) : null}
                    <button
                      className="btn btn-link"
                      onClick={() => handleDelete(conn.id)}
                      style={{ fontSize: '13px', color: '#999' }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="btn btn-link"
              onClick={handleDeleteAll}
              style={{ marginTop: '16px', color: '#999', fontSize: '13px' }}
            >
              Remove all connections
            </button>
          </>
        )}

        <div style={{ marginTop: '24px', borderTop: '1px solid #eee', paddingTop: '16px' }}>
          <button className="btn btn-link" onClick={() => navigate('/')}>
            ← Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
