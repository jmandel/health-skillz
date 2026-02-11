import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import StatusMessage from '../components/StatusMessage';

function timeAgo(d: string | null): string {
  if (!d) return 'never';
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtSize(b: number | null): string {
  if (!b) return 'no data';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export default function RecordsPage() {
  const nav = useNavigate();
  const s = useRecordsStore();
  const isSession = Boolean(s.session);
  const isFinalized = s.session?.sessionStatus === 'finalized';
  const busy = s.status === 'sending' || s.status === 'finalizing';
  const selCount = s.selected.size;
  const total = s.connections.length;
  const allSel = total > 0 && selCount === total;
  const noneSel = selCount === 0;

  useEffect(() => { if (!s.loaded) s.loadConnections(); }, []);

  const handleAdd = useCallback(() => {
    nav(s.session ? `/records/add?session=${s.session.sessionId}` : '/records/add');
  }, [nav, s.session]);

  const handleRemove = useCallback(async (id: string) => {
    if (!confirm('Remove this connection? You\u2019ll need to re-authorize.')) return;
    await s.removeConnection(id);
  }, []);

  if (!s.loaded) {
    return (
      <div className="page-top">
        <div className="panel">
          <StatusMessage status="loading" message="Loading…" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-top">
      <div className="panel panel-wide">
        <div className="page-title">
          {isSession ? 'Share records with AI' : 'My Health Records'}
        </div>
        {isSession && (
          <div className="page-subtitle">
            End-to-end encrypted — only the requesting AI can decrypt.
          </div>
        )}
        {!isSession && total > 0 && (
          <div className="page-subtitle">
            {total} connection{total !== 1 ? 's' : ''} · {selCount} selected
          </div>
        )}

        {/* Global messages */}
        {s.status === 'error' && s.error && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            {s.error}
            <button className="link" onClick={s.clearError} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
        )}
        {s.statusMessage && s.status !== 'error' && s.status !== 'idle' && (
          <StatusMessage
            status={s.status === 'done' ? 'success' : 'loading'}
            message={s.statusMessage}
          />
        )}

        {/* Empty */}
        {total === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: '0.9rem' }}>
              No connections yet.
            </p>
            <button className="btn btn-primary" onClick={handleAdd}>Add connection</button>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            {total > 1 && (
              <div className="toolbar">
                <button className="link" disabled={busy || allSel} onClick={s.selectAll}>Select all</button>
                <span className="sep">·</span>
                <button className="link" disabled={busy || noneSel} onClick={s.selectNone}>None</button>
              </div>
            )}

            {/* List */}
            <div className="conn-list">
              {s.connections.map((c) => {
                const cs = s.connectionState[c.id];
                const refreshing = cs?.refreshing ?? false;
                const err = cs?.error ?? null;
                const checked = s.selected.has(c.id);
                const prog = cs?.refreshProgress;

                return (
                  <label key={c.id} className={`conn-card${checked ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => s.toggleSelected(c.id)}
                    />
                    <div className="conn-body">
                      <div className="conn-name">
                        <span className={`status-dot status-dot-${c.status}`} />
                        {c.patientDisplayName || c.patientId}
                        {c.patientBirthDate && (
                          <span className="conn-dob">DOB {c.patientBirthDate}</span>
                        )}
                      </div>
                      <div className="conn-meta">
                        {c.providerName} · {fmtSize(c.dataSizeBytes)} · {timeAgo(c.lastFetchedAt)}
                      </div>
                      {refreshing && prog && (
                        <div className="conn-progress">
                          {prog.phase}: {prog.completed}/{prog.total}
                          {prog.detail ? ` — ${prog.detail}` : ''}
                        </div>
                      )}
                      {(c.lastError || err) && (
                        <div className="conn-error">{err || c.lastError}</div>
                      )}
                      <div className="conn-actions" onClick={e => e.preventDefault()}>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={refreshing || busy}
                          onClick={e => { e.preventDefault(); s.refreshConnection(c.id); }}
                        >
                          {refreshing ? 'Refreshing…' : 'Refresh'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={refreshing || busy}
                          onClick={e => { e.preventDefault(); handleRemove(c.id); }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={handleAdd} disabled={busy}>
                Add connection
              </button>
            </div>

            <hr className="divider" />

            {/* Actions */}
            <div className="action-bar">
              {isSession && !isFinalized && (
                <button
                  className="btn btn-primary btn-full"
                  disabled={noneSel || busy}
                  onClick={s.sendToAI}
                >
                  {busy && s.status === 'sending'
                    ? 'Encrypting & sending…'
                    : `Send ${selCount} record${selCount !== 1 ? 's' : ''} to AI`}
                </button>
              )}
              {isSession && isFinalized && (
                <p className="text-success" style={{ textAlign: 'center', padding: '8px 0' }}>
                  ✓ Records sent to AI — you can close this page.
                </p>
              )}
              <div className="action-row">
                <button
                  className="btn btn-secondary"
                  disabled={noneSel || busy}
                  onClick={s.downloadJson}
                >
                  Download JSON
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={noneSel || busy}
                  onClick={() => { window.location.href = '/skill.zip'; }}
                >
                  {noneSel ? 'Download AI Skill' : `AI Skill with ${selCount} record${selCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
