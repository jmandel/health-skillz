import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useRecordsStore } from '../store/records';
import { loadOAuthState, clearOAuthState } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import StatusMessage from '../components/StatusMessage';

/**
 * OAuthCallbackPage — receives the OAuth redirect, exchanges the code,
 * fetches FHIR data via the records store, and redirects back.
 *
 * This page NEVER encrypts or uploads. It just saves the connection + data
 * to IndexedDB via the store. Encryption happens later when the user
 * explicitly "sends to AI" on the RecordsPage.
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useRecordsStore();
  const [processed, setProcessed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('Completing authorization…');

  useEffect(() => {
    if (processed) return;
    setProcessed(true);

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      setErrorMsg(errorDesc || errorParam);
      return;
    }
    if (!code || !state) {
      setErrorMsg('Missing authorization code or state');
      return;
    }

    const oauth = loadOAuthState(state);
    if (!oauth) {
      setErrorMsg('OAuth session not found. Please start over.');
      return;
    }

    // Clear OAuth state immediately to prevent reuse
    clearOAuthState(state);

    const process = async () => {
      try {
        // 1. Exchange code for token
        setStatusMsg('Exchanging authorization code…');
        const tokenResponse = await exchangeCodeForToken(
          code,
          oauth.tokenEndpoint,
          oauth.clientId,
          oauth.redirectUri,
          oauth.codeVerifier,
        );

        const patientId = tokenResponse.patient;
        if (!patientId) {
          throw new Error('No patient ID in token response');
        }

        // 2. If we got a refresh token, save the connection + fetch data via store
        if (tokenResponse.refresh_token) {
          setStatusMsg('Fetching health records…');
          await store.saveNewConnection({
            providerName: oauth.providerName,
            fhirBaseUrl: oauth.fhirBaseUrl,
            tokenEndpoint: oauth.tokenEndpoint,
            clientId: oauth.clientId,
            patientId,
            refreshToken: tokenResponse.refresh_token,
            scopes: tokenResponse.scope || '',
            accessToken: tokenResponse.access_token,
          });
        }

        // 3. Redirect back
        // If there's a session context in the OAuth state, go to session page
        // Otherwise go to standalone records page
        const sessionId = oauth.sessionId;
        if (sessionId && !sessionId.startsWith('local_')) {
          navigate(`/connect/${sessionId}?provider_added=true`);
        } else {
          navigate('/records?provider_added=true');
        }
      } catch (err) {
        console.error('OAuth processing error:', err);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    };

    process();
  }, [processed, searchParams, navigate]);

  // --- Render ---

  // Show fetch progress from the store
  const storeMsg = store.statusMessage;

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Retrieving Health Records</h1>

        {errorMsg ? (
          <>
            <StatusMessage status="error" message={errorMsg} />
            <button className="btn" onClick={() => navigate('/records')} style={{ marginTop: 12 }}>
              ← Back to Records
            </button>
          </>
        ) : (
          <>
            <StatusMessage status="loading" message={storeMsg || statusMsg} />
            <p className="security-info" style={{ marginTop: 12 }}>
              🔒 Your data is saved only in your browser.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
