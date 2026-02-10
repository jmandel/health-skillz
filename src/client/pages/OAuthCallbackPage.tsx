import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { loadOAuthState, clearOAuthState, loadSession, loadProviderData } from '../lib/storage';
import { exchangeCodeForToken } from '../lib/smart/oauth';
import { fetchPatientData, type ProgressInfo } from '../lib/smart/client';
import { encryptData, encryptAndUploadStreaming, type StreamingProgress } from '../lib/crypto';
import type { EncryptedChunk } from '../lib/crypto';
import { sendEncryptedEhrData, uploadEncryptedChunk, logClientError, getSessionInfo } from '../lib/api';
import StatusMessage from '../components/StatusMessage';

export default function OAuthCallbackPage() {
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const store = useSessionStore();

  const [progress, setProgress] = useState({
    resources: { completed: 0, total: 0, detail: '', subProgress: null as { current: number; total: number } | null },
    references: { completed: 0, total: 0, detail: '', subProgress: null as { current: number; total: number } | null },
    attachments: { completed: 0, total: 0, detail: '', subProgress: null as { current: number; total: number } | null },
  });
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [streamingProgress, setStreamingProgress] = useState<StreamingProgress | null>(null);
  const [lastEncrypted, setLastEncrypted] = useState<any>(null); // For small files only
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [lastProviderName, setLastProviderName] = useState<string | null>(null);

  const status = store.status;
  const setStatus = store.setStatus;
  const setError = store.setError;

  // Retry upload handler - re-encrypts from stored data
  const handleRetryUpload = useCallback(async () => {
    if (!resolvedSessionId || !lastToken) return;
    
    // Get the session's public key
    const savedSession = loadSession();
    const publicKeyJwk = savedSession?.publicKeyJwk;
    if (!publicKeyJwk) {
      store.setUploadFailed(true, 'No encryption key found. Please start over.');
      return;
    }
    
    setUploadProgress(null);
    setStreamingProgress(null);
    setStatus('sending');
    store.setUploadFailed(false);
    
    try {
      // If we have cached encrypted data (small file), use it
      if (lastEncrypted) {
        await sendEncryptedEhrData(resolvedSessionId, lastEncrypted, lastToken, setUploadProgress);
      } else {
        // Large file: reload from storage and re-encrypt with streaming
        const providers = await loadProviderData(resolvedSessionId);
        if (!providers || providers.length === 0) {
          throw new Error('No provider data found. Please start over.');
        }
        // Upload the most recent provider
        const providerData = providers[providers.length - 1];
        
        // Check for already-uploaded chunks (resume support)
        const sessionInfo = await getSessionInfo(resolvedSessionId);
        const skipChunks = sessionInfo.pendingChunks?.receivedChunks || [];
        if (skipChunks.length > 0) {
          console.log(`Resuming upload: ${skipChunks.length} chunks already received`);
        }
        
        await encryptAndUploadStreaming(
          providerData,
          publicKeyJwk,
          async (chunk: EncryptedChunk, index: number, isLast: boolean) => {
            await uploadEncryptedChunk(resolvedSessionId, lastToken!, chunk, index, isLast ? index + 1 : null);
          },
          setStreamingProgress,
          skipChunks
        );
      }
      
      setStatus('done');
      setTimeout(() => {
        navigate(`/connect/${resolvedSessionId}?provider_added=true`);
      }, 1500);
    } catch (uploadErr) {
      const errorMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
      const httpStatusMatch = errorMsg.match(/Server returned (\d+)/);
      const httpStatus = httpStatusMatch ? parseInt(httpStatusMatch[1]) : undefined;
      
      const logResult = await logClientError({
        sessionId: resolvedSessionId,
        errorCode: 'retry_upload_failed',
        httpStatus,
        context: `provider:${lastProviderName || 'unknown'}`,
      });
      
      const errorDetails = [
        `Error ID: ${logResult.errorId || 'not-logged'}`,
        `Time: ${new Date().toISOString()}`,
        `Session: ${resolvedSessionId}`,
        `Provider: ${lastProviderName || 'unknown'}`,
        `HTTP Status: ${httpStatus || 'unknown'}`,
        `Error: ${errorMsg}`,
      ].join('\n');
      
      store.setUploadFailed(true, errorDetails);
      setStatus('upload_failed' as any);
    }
  }, [resolvedSessionId, lastEncrypted, lastToken, lastProviderName, navigate, setStatus]);

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
                subProgress: info.subProgress || null,
              },
            }));
          }
        );

        const connectedAt = new Date().toISOString();
        
        if (isLocalCollection) {
          // Local collection: just save to IndexedDB, no encryption or server
          setStatus('saving' as any);
          await store.addProviderData(sessionId, {
            name: oauth.providerName,
            fhirBaseUrl: oauth.fhirBaseUrl,
            connectedAt,
            fhir: ehrData.fhir,
            attachments: ehrData.attachments,
          });

          setStatus('done');
          setTimeout(() => {
            navigate('/collect');
          }, 1500);
        } else {
          // Agent session: encrypt and send to server
          setStatus('encrypting');
          if (!oauth.publicKeyJwk) {
            throw new Error('No encryption key available');
          }
          
          // Persist finalize token before sending
          const savedSession = loadSession();
          let token = savedSession?.finalizeToken ?? null;
          if (!token) {
            token = crypto.randomUUID();
          }
          store.setSession(sessionId, oauth.publicKeyJwk, token);

          // Save locally FIRST so data isn't lost if upload fails
          const providerData = {
            name: oauth.providerName,
            fhirBaseUrl: oauth.fhirBaseUrl,
            connectedAt,
            fhir: ehrData.fhir,
            attachments: ehrData.attachments,
          };
          await store.addProviderData(sessionId, providerData);

          // Save for retry if upload fails
          setLastToken(token);
          setLastProviderName(oauth.providerName);
          
          // Check data size to decide approach
          const jsonSize = JSON.stringify(providerData).length;
          const CHUNK_THRESHOLD = 5 * 1024 * 1024; // 5MB
          
          try {
            if (jsonSize > CHUNK_THRESHOLD) {
              // Large data: use streaming encrypt + upload
              setStatus('sending'); // Combined encrypt+upload
              let totalChunks = 0;
              
              await encryptAndUploadStreaming(
                providerData,
                oauth.publicKeyJwk,
                async (chunk: EncryptedChunk, index: number, isLast: boolean) => {
                  totalChunks = index + 1;
                  await uploadEncryptedChunk(sessionId, token!, chunk, index, isLast ? totalChunks : null);
                },
                setStreamingProgress
              );
              
            } else {
              // Small data: encrypt then upload (original v2 flow)
              const encrypted = await encryptData(providerData, oauth.publicKeyJwk);
              setLastEncrypted(encrypted);
              setStatus('sending');
              await sendEncryptedEhrData(sessionId, encrypted, token, setUploadProgress);
            }
            
            setStatus('done');
            setTimeout(() => {
              navigate(`/connect/${sessionId}?provider_added=true`);
            }, 1500);
          } catch (uploadErr) {
            // Upload failed but data is saved locally - let user download instead
            const errorMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
            
            // Parse HTTP status from error message if available
            const httpStatusMatch = errorMsg.match(/Server returned (\d+)/);
            const httpStatus = httpStatusMatch ? parseInt(httpStatusMatch[1]) : undefined;
            
            // Log to server (non-sensitive info only)
            const logResult = await logClientError({
              sessionId,
              errorCode: 'upload_failed',
              httpStatus,
              context: `provider:${oauth.providerName},json_size:${jsonSize}`,
            });
            
            const errorDetails = [
              `Error ID: ${logResult.errorId || 'not-logged'}`,
              `Time: ${new Date().toISOString()}`,
              `Session: ${sessionId}`,
              `Provider: ${oauth.providerName}`,
              `HTTP Status: ${httpStatus || 'unknown'}`,
              `Error: ${errorMsg}`,
              `Data size: ${Math.round(jsonSize / 1024)} KB`,
            ].join('\n');
            console.error('Upload failed:', errorDetails);
            store.setUploadFailed(true, errorDetails);
            setStatus('upload_failed' as any);
          }
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
        // Streaming progress (large files)
        if (streamingProgress) {
          const pct = Math.round((streamingProgress.bytesIn / streamingProgress.totalBytesIn) * 100);
          const mb = (streamingProgress.bytesIn / 1024 / 1024).toFixed(1);
          const totalMb = (streamingProgress.totalBytesIn / 1024 / 1024).toFixed(1);
          const phase = streamingProgress.phase === 'processing' ? 'Processing' : 'Uploading';
          return `${phase} chunk ${streamingProgress.currentChunk}... ${mb}/${totalMb} MB (${pct}%)`;
        }
        // Simple upload progress (small files)
        if (uploadProgress) {
          const pct = Math.round((uploadProgress.loaded / uploadProgress.total) * 100);
          const kb = Math.round(uploadProgress.loaded / 1024);
          const totalKb = Math.round(uploadProgress.total / 1024);
          return `Uploading... ${kb} / ${totalKb} KB (${pct}%)`;
        }
        return 'Sending encrypted data...';
      case 'saving':
        return 'Saving data...';
      case 'done':
        return 'Success! Redirecting...';
      case 'upload_failed' as any:
        return 'Upload failed, but your data is saved locally.';
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
              <span className="progress-detail">
                {progress.resources.subProgress ? (
                  <span className="detail-with-bar">
                    {progress.resources.subProgress.total > progress.resources.subProgress.current && (
                      <span 
                        className="detail-bar" 
                        style={{ width: `${(progress.resources.subProgress.current / progress.resources.subProgress.total) * 100}%` }}
                      />
                    )}
                    <span className="detail-text">
                      {progress.resources.detail} p{progress.resources.subProgress.current}
                      /{progress.resources.subProgress.total > progress.resources.subProgress.current 
                        ? progress.resources.subProgress.total 
                        : '??'}
                    </span>
                  </span>
                ) : progress.resources.detail}
              </span>
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
        {(store.status as string) === 'upload_failed' && resolvedSessionId && (
          <div className="upload-failed-actions" style={{ marginTop: '16px' }}>
            <button 
              className="btn btn-primary" 
              onClick={handleRetryUpload}
              style={{ width: '100%', marginBottom: '8px' }}
            >
              🔄 Retry Upload
            </button>
            <button 
              className="btn btn-secondary" 
              onClick={() => navigate(`/connect/${resolvedSessionId}?upload_failed=true`)}
              style={{ width: '100%' }}
            >
              📥 Download Data Instead
            </button>
            {store.uploadError && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#fff3cd', borderRadius: '8px', border: '1px solid #ffc107', fontSize: '12px' }}>
                <strong>Error Details:</strong>
                <pre style={{ margin: '8px 0 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {store.uploadError}
                </pre>
                <button
                  className="btn btn-link"
                  onClick={() => {
                    navigator.clipboard.writeText(store.uploadError || '');
                    alert('Copied!');
                  }}
                  style={{ marginTop: '8px', fontSize: '12px', padding: '4px 8px' }}
                >
                  📋 Copy
                </button>
              </div>
            )}
          </div>
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
