import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { loadOAuthState, clearOAuthState, addProviderData, loadSession, saveSession } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import { fetchPatientData, type ProgressInfo } from '../lib/smart/client';
import StatusMessage from '../components/StatusMessage';

type Status = 'idle' | 'connecting' | 'loading' | 'saving' | 'done' | 'error';

export default function CollectCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({
    resources: { completed: 0, total: 0, detail: '' },
    references: { completed: 0, total: 0, detail: '' },
    attachments: { completed: 0, total: 0, detail: '' },
  });

  useEffect(() => {
    if (status !== 'idle') return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDesc || errorParam);
      setStatus('error');
      return;
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      setStatus('error');
      return;
    }

    const oauth = loadOAuthState(state);
    if (!oauth) {
      setError('OAuth session not found. Please start over.');
      setStatus('error');
      return;
    }

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
          (info: ProgressInfo) => {
            setProgress((p) => ({
              ...p,
              [info.phase]: {
                completed: info.completed,
                total: info.total,
                detail: info.detail,
              },
            }));
          }
        );

        setStatus('saving');
        const connectedAt = new Date().toISOString();

        // Save to IndexedDB (no encryption for local collection)
        await addProviderData(oauth.sessionId, {
          name: oauth.providerName,
          fhirBaseUrl: oauth.fhirBaseUrl,
          connectedAt,
          fhir: ehrData.fhir,
          attachments: ehrData.attachments,
        });

        setStatus('done');
        setTimeout(() => {
          navigate('/collect?provider_added=true');
        }, 1500);
      } catch (err) {
        console.error('OAuth processing error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setStatus('error');
      }
    };

    processOAuth();
  }, [searchParams, navigate, status]);

  const getMessage = () => {
    switch (status) {
      case 'connecting':
        return 'Completing authorization...';
      case 'loading':
        return null; // Use custom progress display
      case 'saving':
        return 'Saving data...';
      case 'done':
        return 'Success! Redirecting...';
      case 'error':
        return error || 'An error occurred';
      default:
        return 'Processing...';
    }
  };

  const isLoading = status !== 'error' && status !== 'done' && status !== 'idle';

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
        {status === 'error' && (
          <button className="btn" onClick={() => navigate('/collect')}>
            ← Try Again
          </button>
        )}
        {isLoading && (
          <p className="security-info">
            🔒 Your data stays in your browser. Nothing is sent to any server.
          </p>
        )}
      </div>
    </div>
  );
}
