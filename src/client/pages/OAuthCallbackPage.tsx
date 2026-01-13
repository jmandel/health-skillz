import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { loadOAuthState, clearOAuthState, addProviderData } from '../lib/storage';
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

  const [progress, setProgress] = useState({ resources: '', attachments: '' });
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);

  const status = store.status;
  const setStatus = store.setStatus;
  const setError = store.setError;

  useEffect(() => {
    // Already processing or done
    if (status !== 'idle') return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      return;
    }

    const oauth = loadOAuthState(state);
    if (!oauth) {
      setError('OAuth session not found. Please start over.');
      return;
    }

    const sessionId = urlSessionId || oauth.sessionId;
    if (!sessionId) {
      setError('No session ID found.');
      return;
    }
    setResolvedSessionId(sessionId);

    // Clear OAuth state immediately to prevent reuse
    clearOAuthState(state);

    const processOAuth = async () => {
      try {
        setStatus('connecting');
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

        setStatus('loading');
        const ehrData = await fetchPatientData(
          oauth.fhirBaseUrl,
          tokenResponse.access_token,
          patientId,
          (completed, total, current) => {
            // current is either a resource type name (during resource fetch),
            // "X/Y" format (during attachment fetch), or "Complete"
            if (current === 'Complete') {
              setProgress(p => ({ ...p, resources: `${total}/${total}`, attachments: 'done' }));
            } else if (current.includes('/')) {
              // Attachment progress: "0/50", "1/50", etc.
              setProgress(p => ({ ...p, resources: `${total}/${total}`, attachments: current }));
            } else {
              // Resource fetch progress
              setProgress(p => ({ ...p, resources: `${completed}/${total}` }));
            }
          }
        );

        setStatus('encrypting');
        if (!oauth.publicKeyJwk) {
          throw new Error('No encryption key available');
        }
        const connectedAt = new Date().toISOString();
        const encrypted = await encryptData(
          {
            name: oauth.providerName,
            fhirBaseUrl: oauth.fhirBaseUrl,
            connectedAt,
            fhir: ehrData.fhir,
            attachments: ehrData.attachments,
          },
          oauth.publicKeyJwk
        );

        setStatus('sending');
        await sendEncryptedEhrData(sessionId, encrypted);

        await addProviderData(sessionId, {
          name: oauth.providerName,
          fhirBaseUrl: oauth.fhirBaseUrl,
          connectedAt,
          fhir: ehrData.fhir,
          attachments: ehrData.attachments,
        });

        setStatus('done');
        setTimeout(() => {
          setStatus('idle');
          navigate(`/connect/${sessionId}?provider_added=true`);
        }, 1500);
      } catch (err) {
        console.error('OAuth processing error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    };

    processOAuth();
  }, [urlSessionId, searchParams, navigate, status, setStatus, setError]);

  const getMessage = () => {
    switch (store.status) {
      case 'connecting':
        return 'Completing authorization...';
      case 'loading':
        return null; // Use custom progress display
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
        {getMessage() && (
          <StatusMessage
            status={status === 'error' ? 'error' : status === 'done' ? 'success' : 'loading'}
            message={getMessage()!}
          />
        )}
        {status === 'loading' && (
          <StatusMessage status="loading" message="Fetching health records..." />
        )}
        {status === 'loading' && (
          <div className="progress-table">
            <div className="progress-row">
              <span className="progress-label">Resources:</span>
              <span className="progress-value">{progress.resources || '...'}</span>
            </div>
            <div className="progress-row">
              <span className="progress-label">Attachments:</span>
              <span className="progress-value">{progress.attachments || 'waiting'}</span>
            </div>
          </div>
        )}
        {store.status === 'error' && resolvedSessionId && (
          <button className="btn" onClick={() => navigate(`/connect/${resolvedSessionId}`)}>
            ← Try Again
          </button>
        )}
        {(isLoading || status === 'loading') && (
          <p className="security-info">
            🔒 Your data is being encrypted end-to-end. Only your AI agent can decrypt it.
          </p>
        )}
      </div>
    </div>
  );
}
