import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import RecordsPage from './RecordsPage';
import StatusMessage from '../components/StatusMessage';

/**
 * ConnectPage — thin wrapper for AI sessions.
 * Loads session info from the server, sets session context in the store,
 * then renders RecordsPage (which shows checkboxes + "Send to AI").
 */
export default function ConnectPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const store = useRecordsStore();

  // Initialize session context on mount
  useEffect(() => {
    if (!sessionId) return;
    // Only init if not already set (avoids re-init after OAuth redirect back)
    const current = useRecordsStore.getState().session;
    if (!current || current.sessionId !== sessionId) {
      store.initSession(sessionId);
    }
  }, [sessionId]);

  // Show a provider_added success flash
  const justAdded = searchParams.get('provider_added') === 'true';

  // Loading / error states
  if (!sessionId) {
    return (
      <div className="page-centered">
        <div className="panel">
          <StatusMessage status="error" message="No session ID" />
        </div>
      </div>
    );
  }

  if (!store.session) {
    if (store.status === 'error') {
      return (
        <div className="page-centered">
          <div className="panel">
            <div className="page-title">Session error</div>
            <StatusMessage status="error" message={store.error || 'Session not found or expired'} />
          </div>
        </div>
      );
    }
    return (
      <div className="page-centered">
        <div className="panel">
          <StatusMessage status="loading" message="Loading session…" />
        </div>
      </div>
    );
  }

  return (
    <>
      {justAdded && (
        <div className="alert alert-success" style={{ position: 'fixed', top: 0, left: 0, right: 0, borderRadius: 0, textAlign: 'center', zIndex: 100 }}>
          Provider connected.
        </div>
      )}
      <RecordsPage />
    </>
  );
}
