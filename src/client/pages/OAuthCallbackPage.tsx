import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import { loadOAuthState, clearOAuthState } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import StatusMessage from '../components/StatusMessage';
import FetchProgressWidget from '../components/FetchProgressWidget';

/**
 * Module-level set of state nonces we've already started processing.
 * Survives React StrictMode double-mount without being cleared.
 */
const processingStates = new Set<string>();

/**
 * OAuthCallbackPage — receives the OAuth redirect, exchanges the code,
 * fetches FHIR data via the records store, and redirects back.
 *
 * Status is driven entirely from the records store (statusMessage).
 * Only `errorMsg` is local — for pre-store errors (missing params, expired OAuth).
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const statusMessage = useRecordsStore((s) => s.statusMessage);
  const storeStatus = useRecordsStore((s) => s.status);
  const saveNewConnection = useRecordsStore((s) => s.saveNewConnection);
  const connectionState = useRecordsStore((s) => s.connectionState);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [phase, setPhase] = useState<'exchanging' | 'fetching' | 'done'>('exchanging');
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
        setPhase('exchanging');
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
        //    Progress is reported via store.statusMessage
        setPhase('fetching');
        await saveNewConnection({
          providerName: oauth.providerName,
          fhirBaseUrl: oauth.fhirBaseUrl,
          tokenEndpoint: oauth.tokenEndpoint,
          clientId: oauth.clientId,
          patientId,
          refreshToken: tokenResponse.refresh_token || '',
          scopes: tokenResponse.scope || '',
          accessToken: tokenResponse.access_token,
        });

        // 3. All done — redirect
        setPhase('done');

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

  // Find active fetch progress from any connection being refreshed
  const activeFetchProgress = Object.values(connectionState).find(
    cs => cs.refreshing && cs.refreshProgress
  )?.refreshProgress ?? null;

  // Derive display message from phase + store
  const displayStatus = phase === 'exchanging'
    ? 'Completing authorization…'
    : phase === 'done'
      ? 'Done! Redirecting…'
      : statusMessage || 'Fetching health records…';

  return (
    <div className="page-centered">
      <div className="panel">
        <div className="page-title">Retrieving health records</div>

        {errorMsg ? (
          <>
            <div className="alert alert-error" style={{ marginBottom: 12 }}>{errorMsg}</div>
            <button className="btn btn-secondary" onClick={() => navigate('/records')}>
              Back to records
            </button>
          </>
        ) : activeFetchProgress ? (
          <>
            <FetchProgressWidget progress={activeFetchProgress} />
            {phase !== 'done' && (
              <p className="security-info">This may take up to a minute.</p>
            )}
          </>
        ) : (
          <>
            <StatusMessage status={phase === 'done' ? 'success' : 'loading'} message={displayStatus} />
            {phase !== 'done' && (
              <p className="security-info">This may take up to a minute.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
