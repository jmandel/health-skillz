import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { loadOAuthState, clearOAuthState, addProvider } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import { fetchPatientData } from '../lib/smart/client';
import { encryptData } from '../lib/crypto';
import { sendEncryptedEhrData } from '../lib/api';
import StatusMessage from '../components/StatusMessage';

export default function OAuthCallbackPage() {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useSessionStore();

  const [progress, setProgress] = useState({ completed: 0, total: 0, current: '' });
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Already processing or done
    if (store.status !== 'idle' && store.status !== 'error') return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      store.setError(errorDesc || errorParam);
      return;
    }

    if (!code || !state) {
      store.setError('Missing authorization code or state');
      return;
    }

    const oauth = loadOAuthState(state);
    if (!oauth) {
      store.setError('OAuth session not found. Please start over.');
      return;
    }

    const sessionId = urlSessionId || oauth.sessionId;
    if (!sessionId) {
      store.setError('No session ID found.');
      return;
    }
    setResolvedSessionId(sessionId);

    // Clear OAuth state immediately to prevent reuse
    clearOAuthState(state);

    const processOAuth = async () => {
      try {
        store.setStatus('connecting');
        const tokenResponse = await exchangeCodeForToken(
          code,
          oauth.tokenEndpoint,
          oauth.clientId,
          oauth.redirectUri,
          oauth.codeVerifier
        );

        const patientId = tokenResponse.patient;
        if (!patientId) {
          throw new Error('No patient ID in token response');
        }

        store.setStatus('loading');
        const ehrData = await fetchPatientData(
          oauth.fhirBaseUrl,
          tokenResponse.access_token,
          patientId,
          (completed, total, current) => {
            setProgress({ completed, total, current });
          }
        );

        store.setStatus('encrypting');
        if (!oauth.publicKeyJwk) {
          throw new Error('No encryption key available');
        }
        const connectedAt = new Date().toISOString();
        const encrypted = await encryptData(
          {
            fhir: ehrData.fhir,
            attachments: ehrData.attachments,
            providerName: oauth.providerName,
            connectedAt,
          },
          oauth.publicKeyJwk
        );

        store.setStatus('sending');
        await sendEncryptedEhrData(sessionId, encrypted);

        addProvider(sessionId, { name: oauth.providerName, connectedAt }, ehrData.fhir);

        store.setStatus('done');
        setTimeout(() => {
          store.setStatus('idle');
          navigate(`/connect/${sessionId}?provider_added=true`);
        }, 1500);
      } catch (err) {
        console.error('OAuth processing error:', err);
        store.setError(err instanceof Error ? err.message : 'An error occurred');
      }
    };

    processOAuth();
  }, [urlSessionId, searchParams, navigate, store]);

  const getMessage = () => {
    switch (store.status) {
      case 'connecting':
        return 'Completing authorization...';
      case 'loading':
        if (progress.total > 0) {
          return `Fetching health records... (${progress.completed}/${progress.total}) ${progress.current}`;
        }
        return 'Fetching health records...';
      case 'encrypting':
        return 'Encrypting data...';
      case 'sending':
        return 'Sending encrypted data...';
      case 'done':
        return 'Success! Redirecting...';
      case 'error':
        return store.error || 'An error occurred';
      default:
        return 'Processing...';
    }
  };

  const isLoading = store.status !== 'error' && store.status !== 'done' && store.status !== 'idle';

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Retrieving Health Records</h1>
        <StatusMessage
          status={store.status === 'error' ? 'error' : store.status === 'done' ? 'success' : 'loading'}
          message={getMessage()}
        />
        {store.status === 'loading' && progress.total > 0 && (
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
        )}
        {store.status === 'error' && resolvedSessionId && (
          <button className="btn" onClick={() => navigate(`/connect/${resolvedSessionId}`)}>
            ← Try Again
          </button>
        )}
        {isLoading && (
          <p className="security-info">
            🔒 Your data is being encrypted end-to-end. Only your AI agent can decrypt it.
          </p>
        )}
      </div>
    </div>
  );
}
