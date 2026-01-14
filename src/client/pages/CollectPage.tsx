import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/session';
import { getFullData } from '../lib/storage';
import { getSkillTemplate } from '../lib/api';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

export default function CollectPage() {
  const navigate = useNavigate();
  const {
    sessionId,
    providers,
    status,
    error,
    initialized,
    init,
    createLocalSession,
    clearAndReset,
    setStatus,
    setError,
    clearError,
  } = useSessionStore();

  // Initialize store from storage on mount and clear any stale errors
  useEffect(() => {
    clearError();
    if (!initialized) {
      init();
    }
  }, [initialized, init, clearError]);

  // Create local session if none exists
  useEffect(() => {
    if (initialized && !sessionId?.startsWith('local_')) {
      createLocalSession();
    }
  }, [initialized, sessionId, createLocalSession]);

  const startConnect = useCallback(() => {
    navigate('/collect/select');
  }, [navigate]);

  const handleDownloadJson = useCallback(async () => {
    const data = await getFullData();
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health-records-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadSkill = useCallback(async () => {
    setStatus('loading');
    setError('');

    try {
      const data = await getFullData();
      if (!data || data.providers.length === 0) {
        throw new Error('No health data to package');
      }

      const template = await getSkillTemplate();
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const skillFolder = zip.folder('health-record-assistant')!;

      skillFolder.file('SKILL.md', template.skillMd);

      const refsFolder = skillFolder.folder('references')!;
      for (const [filename, content] of Object.entries(template.references)) {
        refsFolder.file(filename, content);
      }

      const dataFolder = skillFolder.folder('data')!;
      const usedNames = new Map<string, number>();
      for (const provider of data.providers) {
        const baseSlug = provider.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const count = usedNames.get(baseSlug) || 0;
        usedNames.set(baseSlug, count + 1);
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
        dataFolder.file(`${slug}.json`, JSON.stringify(provider, null, 2));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-record-assistant-${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      setStatus('idle');
    } catch (err) {
      console.error('Error building skill package:', err);
      setError(err instanceof Error ? err.message : 'Failed to build skill package');
    }
  }, [setStatus, setError]);

  const handleStartOver = useCallback(async () => {
    await clearAndReset();
  }, [clearAndReset]);

  const hasProviders = providers.length > 0;
  const isWorking = status === 'loading';

  if (!initialized) {
    return (
      <div className="connect-container">
        <div className="connect-card">
          <StatusMessage status="loading" message="Loading..." />
        </div>
      </div>
    );
  }

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>📦 Collect Your Health Records</h1>

        {!hasProviders ? (
          <>
            <p>
              Connect to your healthcare provider's patient portal to download your
              health records. Your data stays in your browser - nothing is sent to any server.
            </p>
            <p>After collecting your records, you can:</p>
            <ul style={{ textAlign: 'left', marginBottom: '24px' }}>
              <li><strong>Download as JSON</strong> - Raw health data for your own use</li>
              <li><strong>Download as AI Skill</strong> - A packaged skill you can upload to Claude</li>
            </ul>
            <button className="btn" onClick={startConnect} disabled={isWorking}>
              Connect to a Health Provider
            </button>
          </>
        ) : (
          <>
            <p>Connected providers:</p>
            <ProviderList providers={providers} />
            <div className="button-group">
              <button className="btn btn-secondary" onClick={startConnect} disabled={isWorking}>
                ➕ Add Another Provider
              </button>
            </div>
            <div className="button-group" style={{ marginTop: '24px' }}>
              <button className="btn" onClick={handleDownloadJson} disabled={isWorking}>
                📥 Download JSON
              </button>
              <button className="btn btn-success" onClick={handleDownloadSkill} disabled={isWorking}>
                🤖 Download AI Skill
              </button>
            </div>
            <button
              className="btn btn-link"
              onClick={handleStartOver}
              disabled={isWorking}
              style={{ marginTop: '16px', color: '#666' }}
            >
              🗑️ Clear & Start Over
            </button>
          </>
        )}

        {status === 'loading' && (
          <StatusMessage status="loading" message="Building skill package..." />
        )}

        {status === 'error' && error && (
          <StatusMessage status="error" message={error} />
        )}

        <div className="security-info">
          <p>
            🔒 <strong>Local only</strong>: Your health data stays in your browser.
            No data is sent to any server.
          </p>
        </div>
        <p className="hosting-thanks">Hosted on <a href="https://exe.dev" target="_blank" rel="noopener">exe.dev</a></p>
      </div>
    </div>
  );
}
