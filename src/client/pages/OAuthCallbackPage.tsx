import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { loadOAuthState, clearOAuthState, loadSession, addProvider } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import { fetchPatientData } from '../lib/smart/client';
import { encryptData } from '../lib/crypto';
import { sendEncryptedEhrData } from '../lib/api';
import StatusMessage from '../components/StatusMessage';

type Phase = 'exchanging' | 'fetching' | 'encrypting' | 'sending' | 'done' | 'error';

export default function OAuthCallbackPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>('exchanging');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: '' });

  useEffect(() => {
    if (!sessionId) return;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    // Handle OAuth error
    if (errorParam) {
      setError(errorDesc || errorParam);
      setPhase('error');
      return;
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      setPhase('error');
      return;
    }

    // Load OAuth state from localStorage (keyed by state param)
    const oauth = loadOAuthState(state);
    if (!oauth) {
      setError('OAuth session not found. Please start over.');
      setPhase('error');
      return;
    }

    // Verify sessionId matches
    if (oauth.sessionId !== sessionId) {
      setError('Session ID mismatch.');
      setPhase('error');
      return;
    }

    const processOAuth = async () => {
      try {
        // Exchange code for token
        setPhase('exchanging');
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

        // Fetch FHIR data
        setPhase('fetching');
        const ehrData = await fetchPatientData(
          oauth.fhirBaseUrl,
          tokenResponse.access_token,
          patientId,
          (completed, total, current) => {
            setProgress({ completed, total, current });
          }
        );

        // Encrypt data with metadata inside encrypted payload
        setPhase('encrypting');
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

        // Send to server (server only sees encrypted blob, no metadata)
        setPhase('sending');
        await sendEncryptedEhrData(sessionId, encrypted);

        // Track provider locally in browser storage (for UI display)
        addProvider(sessionId, { name: oauth.providerName, connectedAt });

        // Clear OAuth state from localStorage
        clearOAuthState(state);

        // Done
        setPhase('done');
        setTimeout(() => {
          navigate(`/connect/${sessionId}?provider_added=true`);
        }, 1500);
      } catch (err) {
        console.error('OAuth processing error:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setPhase('error');
      }
    };

    processOAuth();
  }, [sessionId, searchParams, navigate]);

  const getMessage = () => {
    switch (phase) {
      case 'exchanging':
        return 'Completing authorization...';
      case 'fetching':
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
        return error || 'An error occurred';
    }
  };

  const isLoading = phase !== 'error' && phase !== 'done';

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>🏥 Retrieving Health Records</h1>
        <StatusMessage
          status={phase === 'error' ? 'error' : phase === 'done' ? 'success' : 'loading'}
          message={getMessage()}
        />
        {phase === 'fetching' && progress.total > 0 && (
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
        )}
        {phase === 'error' && (
          <button className="btn" onClick={() => navigate(`/connect/${sessionId}`)}>
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
