import { useEffect, useCallback, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import StatusMessage from '../components/StatusMessage';
import FetchProgressWidget from '../components/FetchProgressWidget';

function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  return (
    <span ref={ref} className={`info-tip${open ? ' info-tip-open' : ''}`} onClick={() => setOpen(o => !o)}>
      ?
      {open && <span className="info-tip-bubble">{text}</span>}
    </span>
  );
}

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
  const session = useRecordsStore((s) => s.session);
  const status = useRecordsStore((s) => s.status);
  const statusMessage = useRecordsStore((s) => s.statusMessage);
  const error = useRecordsStore((s) => s.error);
  const connections = useRecordsStore((s) => s.connections);
  const connectionState = useRecordsStore((s) => s.connectionState);
  const selected = useRecordsStore((s) => s.selected);
  const loaded = useRecordsStore((s) => s.loaded);
  const loadConnections = useRecordsStore((s) => s.loadConnections);
  const selectAll = useRecordsStore((s) => s.selectAll);
  const selectNone = useRecordsStore((s) => s.selectNone);
  const toggleSelected = useRecordsStore((s) => s.toggleSelected);
  const refreshConnection = useRecordsStore((s) => s.refreshConnection);
  const removeConnection = useRecordsStore((s) => s.removeConnection);
  const clearError = useRecordsStore((s) => s.clearError);
  const sendToAI = useRecordsStore((s) => s.sendToAI);

  const isSession = Boolean(session);
  const isFinalized = session?.sessionStatus === 'finalized';
  const busy = status === 'sending' || status === 'finalizing';
  const selCount = selected.size;
  const total = connections.length;
  const allSel = total > 0 && selCount === total;
  const noneSel = selCount === 0;

  useEffect(() => { if (!loaded) loadConnections(); }, []);

  const handleAdd = useCallback(() => {
    nav(session ? `/records/add?session=${session.sessionId}` : '/records/add');
  }, [nav, session]);

  const handleRemove = useCallback(async (id: string) => {
    if (!confirm('Remove this connection? You\u2019ll need to re-authorize.')) return;
    await removeConnection(id);
  }, [removeConnection]);

  if (!loaded) {
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
        {status === 'error' && error && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>
            {error}
            <button className="link" onClick={clearError} style={{ marginLeft: 8 }}>Dismiss</button>
          </div>
        )}
        {statusMessage && status !== 'error' && status !== 'idle' && (
          <StatusMessage
            status={status === 'done' ? 'success' : 'loading'}
            message={statusMessage}
          />
        )}

        {/* Toolbar */}
        {total > 1 && (
          <div className="toolbar">
            <button className="link" disabled={busy || allSel} onClick={selectAll}>Select all</button>
            <span className="sep">·</span>
            <button className="link" disabled={busy || noneSel} onClick={selectNone}>None</button>
          </div>
        )}

        {/* List */}
        {total > 0 && (
          <div className="conn-list">
            {connections.map((c) => {
              const cs = connectionState[c.id];
              const refreshing = cs?.refreshing ?? false;
              const err = cs?.error ?? null;
              const checked = selected.has(c.id);
              const prog = cs?.refreshProgress;

              return (
                <label key={c.id} className={`conn-card${checked ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggleSelected(c.id)}
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
                      <FetchProgressWidget progress={prog} />
                    )}
                    {(c.lastError || err) && (
                      <div className="conn-error">{err || c.lastError}</div>
                    )}
                    <div className="conn-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={refreshing || busy}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); refreshConnection(c.id); }}
                      >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={refreshing || busy}
                        onClick={e => { e.preventDefault(); e.stopPropagation(); handleRemove(c.id); }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {total === 0 && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            No connections yet.
          </p>
        )}

        {/* Actions */}
        <div className="actions-row">
          <button className={`btn ${total === 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={handleAdd} disabled={busy}>
            Add connection
          </button>
          {isSession && !isFinalized && (
            <button
              className="btn btn-primary"
              disabled={noneSel || busy}
              onClick={sendToAI}
            >
              {busy && status === 'sending'
                ? 'Encrypting & sending…'
                : `Send ${selCount} record${selCount !== 1 ? 's' : ''} to AI`}
            </button>
          )}
          <span className="actions-row-tip">
            <button
              className="btn btn-ghost"
              disabled={noneSel || busy}
              onClick={() => { window.location.href = '/skill.zip'; }}
            >
              {noneSel ? 'Download AI Skill' : `Download AI Skill with ${selCount} record${selCount !== 1 ? 's' : ''}`}
            </button>
            <InfoTip text="Downloads a zip with AI agent scripts plus your selected health records. Give this to any AI to analyze your data without web access." />
          </span>
        </div>
        {isSession && isFinalized && (
          <p className="text-success" style={{ padding: '8px 0' }}>
            ✓ Records sent to AI — you can close this page.
          </p>
        )}
      </div>
    </div>
  );
}
