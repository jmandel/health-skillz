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
    if (!store.session || store.session.sessionId !== sessionId) {
      store.initSession(sessionId).then(() => {
        // After session is loaded, load connections
        store.loadConnections();
      });
    }
    // Cleanup: clear session context when leaving
    return () => {
      // Don't clear if navigating to add-provider (we'll come back)
    };
  }, [sessionId]);

  // Show a provider_added success flash
  const justAdded = searchParams.get('provider_added') === 'true';

  // Loading / error states
  if (!sessionId) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="error" message="No session ID" />
        </div>
      </div>
    );
  }

  if (!store.session) {
    if (store.status === 'error') {
      return (
        <div className="connect-container">
          <div className="connect-card">
            <h1>🏥 Health Records</h1>
            <StatusMessage status="error" message={store.error || 'Session not found or expired'} />
          </div>
        </div>
      );
    }
    return (
      <div className="connect-container">
        <div className="connect-card">
          <h1>🏥 Health Records</h1>
          <StatusMessage status="loading" message="Loading session…" />
        </div>
      </div>
    );
  }

  return (
    <>
      {justAdded && (
        <div style={{ background: '#d1fae5', padding: '8px 16px', textAlign: 'center', fontSize: '0.9rem' }}>
          ✅ Provider connected successfully!
        </div>
      )}
      <RecordsPage />
    </>
  );
}
