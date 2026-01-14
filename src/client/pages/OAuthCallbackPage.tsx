import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { loadOAuthState, clearOAuthState, addProviderData } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import { fetchPatientData, type ProgressInfo } from '../lib/smart/client';
import { encryptData } from '../lib/crypto';
import { sendEncryptedEhrData } from '../lib/api';
import StatusMessage from '../components/StatusMessage';

export default function OAuthCallbackPage() {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useSessionStore();

  const [progress, setProgress] = useState({
    resources: { completed: 0, total: 0, detail: '' },
    references: { completed: 0, total: 0, detail: '' },
    attachments: { completed: 0, total: 0, detail: '' },
  });
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
      // Detect if this is a local collection (no server session, no encryption)
      const isLocalCollection = sessionId.startsWith('local_');
      
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
          (info: ProgressInfo) => {
            setProgress(p => ({
              ...p,
              [info.phase]: {
                completed: info.completed,
                total: info.total,
                detail: info.detail,
              },
            }));
          }
        );

        const connectedAt = new Date().toISOString();
        
        if (isLocalCollection) {
          // Local collection: just save to IndexedDB, no encryption or server
          setStatus('saving' as any);
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
            navigate(`/collect?provider_added=true`);
          }, 1500);
        } else {
          // Agent session: encrypt and send to server
          setStatus('encrypting');
          if (!oauth.publicKeyJwk) {
            throw new Error('No encryption key available');
          }
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

          // Also save locally for download feature
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
        }
      } catch (err) {
        console.error('OAuth processing error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    };

    processOAuth();
  }, [urlSessionId, searchParams, navigate, status, setStatus, setError]);

  const isLocalCollection = resolvedSessionId?.startsWith('local_');

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
      case 'saving':
        return 'Saving data...';
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
              <span className="progress-value">
                {progress.resources.total > 0 
                  ? `${progress.resources.completed}/${progress.resources.total}` 
                  : '...'}
              </span>
              <span className="progress-detail">{progress.resources.detail}</span>
            </div>
            <div className="progress-row">
              <span className="progress-label">References:</span>
              <span className="progress-value">
                {progress.references.total > 0 
                  ? `${progress.references.completed}/${progress.references.total}` 
                  : 'waiting'}
              </span>
              <span className="progress-detail">{progress.references.detail}</span>
            </div>
            <div className="progress-row">
              <span className="progress-label">Attachments:</span>
              <span className="progress-value">
                {progress.attachments.total > 0 
                  ? `${progress.attachments.completed}/${progress.attachments.total}` 
                  : 'waiting'}
              </span>
              <span className="progress-detail">{progress.attachments.detail}</span>
            </div>
          </div>
        )}
        {store.status === 'error' && resolvedSessionId && (
          <button className="btn" onClick={() => navigate(isLocalCollection ? '/collect' : `/connect/${resolvedSessionId}`)}>
            ← Try Again
          </button>
        )}
        {(isLoading || status === 'loading') && (
          <p className="security-info">
            {isLocalCollection 
              ? '🔒 Your data stays in your browser. Nothing is sent to any server.'
              : '🔒 Your data is being encrypted end-to-end. Only your AI agent can decrypt it.'
            }
          </p>
        )}
      </div>
    </div>
  );
}
