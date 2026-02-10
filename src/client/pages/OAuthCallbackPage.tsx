import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import { loadOAuthState, clearOAuthState } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import StatusMessage from '../components/StatusMessage';

/**
 * Module-level set of state nonces we've already started processing.
 * Survives React StrictMode double-mount without being cleared.
 */
const processingStates = new Set<string>();

/**
 * OAuthCallbackPage — receives the OAuth redirect, exchanges the code,
 * fetches FHIR data via the records store, and redirects back.
 *
 * This page stays visible showing progress until the data fetch is complete.
 * It NEVER encrypts or uploads. Encryption happens later on RecordsPage.
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useRecordsStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState('Completing authorization…');
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  // The state nonce from the query string
  const stateNonce = searchParams.get('state');

  useEffect(() => {
    // Guard: only process once, even across StrictMode double-mount
    if (startedRef.current) return;
    if (stateNonce && processingStates.has(stateNonce)) return;
    startedRef.current = true;
    if (stateNonce) processingStates.add(stateNonce);

    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      setErrorMsg(errorDesc || errorParam);
      return;
    }
    if (!code || !stateNonce) {
      setErrorMsg('Missing authorization code or state parameter.');
      return;
    }

    const oauth = loadOAuthState(stateNonce);
    if (!oauth) {
      setErrorMsg('OAuth session not found. This link may have already been used.');
      return;
    }

    // Clear immediately to prevent replay
    clearOAuthState(stateNonce);

    const process = async () => {
      try {
        // 1. Exchange code for token
        setLocalStatus('Exchanging authorization code…');
        const tokenResponse = await exchangeCodeForToken(
          code,
          oauth.tokenEndpoint,
          oauth.clientId,
          oauth.redirectUri,
          oauth.codeVerifier,
        );

        const patientId = tokenResponse.patient;
        if (!patientId) {
          throw new Error('No patient ID in token response. The server may not have returned patient context.');
        }

        // 2. Fetch FHIR data and save connection (this can take 30s+)
        setLocalStatus('Fetching health records…');
        await store.saveNewConnection({
          providerName: oauth.providerName,
          fhirBaseUrl: oauth.fhirBaseUrl,
          tokenEndpoint: oauth.tokenEndpoint,
          clientId: oauth.clientId,
          patientId,
          refreshToken: tokenResponse.refresh_token || '',
          scopes: tokenResponse.scope || '',
          accessToken: tokenResponse.access_token,
        });

        // 3. All done — show success and redirect
        setDone(true);
        setLocalStatus('Done! Redirecting…');

        const sessionId = oauth.sessionId;
        if (sessionId && !sessionId.startsWith('local_')) {
          navigate(`/connect/${sessionId}`, { replace: true });
        } else {
          navigate('/records', { replace: true });
        }
      } catch (err) {
        console.error('[OAuthCallback] Error:', err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      } finally {
        // Allow reprocessing if user manually navigates back
        if (stateNonce) processingStates.delete(stateNonce);
      }
    };

    process();
  }, []); // empty deps — run once on mount

  // Get progress from store (updated by saveNewConnection's progress callback)
  const storeProgress = store.statusMessage;
  const displayStatus = storeProgress || localStatus;

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1 style={{ fontSize: '1.3rem', marginBottom: 16 }}>🏥 Retrieving Health Records</h1>

        {errorMsg ? (
          <>
            <StatusMessage status="error" message={errorMsg} />
            <button
              className="btn"
              onClick={() => navigate('/records')}
              style={{ marginTop: 12 }}
            >
              ← Back to Records
            </button>
          </>
        ) : (
          <>
            <StatusMessage status={done ? 'success' : 'loading'} message={displayStatus} />

            {/* Show a visual progress indication */}
            {!done && (
              <div style={{ marginTop: 16, textAlign: 'center', color: '#666', fontSize: '0.85rem' }}>
                This may take up to a minute depending on how much data is available.
              </div>
            )}

            <p className="security-info" style={{ marginTop: 16 }}>
              🔒 Your data is saved only in your browser.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
