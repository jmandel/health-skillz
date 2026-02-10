import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import StatusMessage from '../components/StatusMessage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return 'no data';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  expired: '#f59e0b',
  error: '#ef4444',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RecordsPage() {
  const navigate = useNavigate();
  const store = useRecordsStore();
  const isSession = Boolean(store.session);
  const isBusy = store.status === 'sending' || store.status === 'finalizing';

  // Load connections on mount
  useEffect(() => {
    if (!store.loaded) {
      store.loadConnections();
    }
  }, []);

  // Navigation to add provider
  const handleAdd = useCallback(() => {
    if (store.session) {
      navigate(`/records/add?session=${store.session.sessionId}`);
    } else {
      navigate('/records/add');
    }
  }, [navigate, store.session]);

  // Confirm before removing
  const handleRemove = useCallback(async (id: string) => {
    if (!confirm('Remove this connection? You will need to re-authorize to reconnect.')) return;
    await store.removeConnection(id);
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!store.loaded) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="loading" message="Loading saved connections…" />
        </div>
      </div>
    );
  }

  const selectedCount = store.selected.size;

  return (
    <div className="connect-container">
      <div className="connect-card" style={{ textAlign: 'left' }}>
        {/* Header */}
        <h1 style={{ fontSize: '1.4rem', marginBottom: '0.5rem', textAlign: 'center' }}>
          {isSession ? '🏥 Share Health Records with AI' : '🏥 My Health Records'}
        </h1>

        {isSession && (
          <p className="security-info" style={{ marginBottom: '1rem', textAlign: 'center' }}>
            🔒 Data is end-to-end encrypted before sending. Only the AI that requested it can decrypt it.
          </p>
        )}

        {/* Global status messages */}
        {store.status === 'error' && store.error && (
          <div className="warning-box" style={{ marginBottom: '1rem' }}>
            <strong>Error:</strong> {store.error}
            <button className="btn btn-link" onClick={store.clearError} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
        )}
        {store.statusMessage && store.status !== 'error' && store.status !== 'idle' && (
          <StatusMessage
            status={store.status === 'done' ? 'success' : 'loading'}
            message={store.statusMessage}
          />
        )}

        {/* Empty state */}
        {store.connections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <p style={{ marginBottom: '1rem', color: '#6b7280' }}>
              No saved connections yet. Connect to a health provider to get started.
            </p>
            <button className="btn" onClick={handleAdd}>
              ➕ Add New Connection
            </button>
          </div>
        ) : (
          <>
            {/* Connection list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {store.connections.map((conn) => {
                const cs = store.connectionState[conn.id];
                const isRefreshing = cs?.refreshing ?? false;
                const connError = cs?.error ?? null;
                const isChecked = store.selected.has(conn.id);
                const progress = cs?.refreshProgress;

                return (
                  <div
                    key={conn.id}
                    style={{
                      background: '#f8f9fa', borderRadius: 10,
                      padding: '12px 16px', border: '1px solid #e5e7eb',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                      {/* Checkbox (session mode) */}
                      {isSession && (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isBusy}
                          onChange={() => store.toggleSelected(conn.id)}
                          style={{ marginTop: 4 }}
                        />
                      )}

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Patient identity */}
                        <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 2 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8, height: 8, borderRadius: '50%',
                              backgroundColor: STATUS_COLORS[conn.status] || '#9ca3af',
                              marginRight: 6, verticalAlign: 'middle',
                            }}
                            title={conn.status}
                          />
                          {conn.patientDisplayName || conn.patientId}
                          {conn.patientBirthDate && (
                            <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.85rem', marginLeft: 8 }}>
                              DOB: {conn.patientBirthDate}
                            </span>
                          )}
                        </div>

                        {/* Provider + data info */}
                        <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.4rem' }}>
                          {conn.providerName} · {formatSize(conn.dataSizeBytes)} · {timeAgo(conn.lastFetchedAt)}
                        </div>

                        {/* Refresh progress */}
                        {isRefreshing && progress && (
                          <div style={{ fontSize: '0.8rem', color: '#3b82f6', marginBottom: '0.4rem' }}>
                            {progress.phase}: {progress.completed}/{progress.total}
                            {progress.detail ? ` — ${progress.detail}` : ''}
                          </div>
                        )}

                        {/* Errors */}
                        {(conn.lastError || connError) && (
                          <div className="warning-box" style={{ marginBottom: '0.4rem', fontSize: '0.8rem', padding: '4px 8px' }}>
                            {connError || conn.lastError}
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '2px 10px', fontSize: '0.85rem' }}
                            disabled={isRefreshing || isBusy}
                            onClick={() => store.refreshConnection(conn.id)}
                          >
                            {isRefreshing ? '⏳ Refreshing…' : '🔄 Refresh'}
                          </button>
                          {!isSession && (
                            <button
                              className="btn btn-link"
                              style={{ padding: '2px 10px', fontSize: '0.85rem', color: '#999' }}
                              disabled={isRefreshing || isBusy}
                              onClick={() => handleRemove(conn.id)}
                            >
                              🗑️ Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add connection */}
            <div style={{ marginTop: '0.75rem', textAlign: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={handleAdd}
                disabled={isBusy}
              >
                ➕ Add New Connection
              </button>
            </div>

            {/* Bottom actions */}
            <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {isSession ? (
                <>
                  <button
                    className="btn"
                    disabled={selectedCount === 0 || isBusy}
                    onClick={store.sendToAI}
                  >
                    {isBusy && store.status === 'sending'
                      ? 'Sending…'
                      : `✅ Send ${selectedCount} connection${selectedCount !== 1 ? 's' : ''} to AI`}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={isBusy}
                    onClick={store.finalizeSession}
                  >
                    Done — I've sent everything
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={store.downloadJson}>
                    📥 Download JSON
                  </button>
                  <a className="btn btn-secondary" href="/skill.zip" download>
                    🤖 Download AI Skill
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
