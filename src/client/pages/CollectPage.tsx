import { useEffect, useCallback, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { getFullData, getProvidersSummary, saveSession, loadSession, clearAllData } from '../lib/storage';
import { getSkillTemplate, type SkillTemplate } from '../lib/api';
import ProviderList from '../components/ProviderList';
import StatusMessage from '../components/StatusMessage';

// Generate a local collection ID (not a server session)
function generateLocalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'local_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export default function CollectPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<Array<{ name: string; connectedAt: string }>>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'building' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localId, setLocalId] = useState<string | null>(null);

  // Initialize local collection session
  useEffect(() => {
    const saved = loadSession();
    
    // Check if returning from OAuth (provider_added param)
    const providerAdded = searchParams.get('provider_added');
    
    if (saved && saved.sessionId?.startsWith('local_')) {
      // Restore existing local session
      setLocalId(saved.sessionId);
      // Always re-read providers (they may have been updated)
      const summaries = getProvidersSummary();
      setProviders(summaries);
      
      // Clean up URL if returning from provider
      if (providerAdded === 'true') {
        window.history.replaceState({}, '', '/collect');
      }
    } else {
      // Create new local session
      const newId = generateLocalId();
      setLocalId(newId);
      setProviders([]);
      saveSession({
        sessionId: newId,
        publicKeyJwk: null, // No encryption for local collection
        providerSummaries: [],
      });
    }
  }, [location.key]);  // Re-run on every navigation to this page

  const startConnect = useCallback(() => {
    if (!localId) return;
    navigate(`/collect/select`);
  }, [localId, navigate]);

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
    setStatus('building');
    setError(null);

    try {
      // Get the data
      const data = await getFullData();
      if (!data || data.providers.length === 0) {
        throw new Error('No health data to package');
      }

      // Get the skill template from server
      const template = await getSkillTemplate();

      // Import JSZip dynamically
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Create skill folder
      const skillFolder = zip.folder('health-record-assistant')!;

      // Add SKILL.md
      skillFolder.file('SKILL.md', template.skillMd);

      // Add references
      const refsFolder = skillFolder.folder('references')!;
      for (const [filename, content] of Object.entries(template.references)) {
        refsFolder.file(filename, content);
      }

      // Add data files with unique names
      const dataFolder = skillFolder.folder('data')!;
      const usedNames = new Map<string, number>();
      for (const provider of data.providers) {
        const baseSlug = provider.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        
        // Handle duplicate names
        const count = usedNames.get(baseSlug) || 0;
        usedNames.set(baseSlug, count + 1);
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
        
        dataFolder.file(`${slug}.json`, JSON.stringify(provider, null, 2));
      }

      // Generate zip
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
      setStatus('error');
    }
  }, []);

  const handleStartOver = useCallback(async () => {
    await clearAllData();
    const newId = generateLocalId();
    setLocalId(newId);
    setProviders([]);
    saveSession({
      sessionId: newId,
      publicKeyJwk: null,
      providerSummaries: [],
    });
  }, []);

  const hasProviders = providers.length > 0;
  const isWorking = status === 'loading' || status === 'building';

  return (
    <div className="connect-container">
      <div className="connect-card">
        <h1>📦 Collect Your Health Records</h1>

        {!hasProviders ? (
          // Initial state
          <>
            <p>
              Connect to your healthcare provider's patient portal to download your
              health records. Your data stays in your browser - nothing is sent to any server.
            </p>
            <p>
              After collecting your records, you can:
            </p>
            <ul style={{ textAlign: 'left', marginBottom: '24px' }}>
              <li><strong>Download as JSON</strong> - Raw health data for your own use</li>
              <li><strong>Download as AI Skill</strong> - A packaged skill you can upload to Claude</li>
            </ul>
            <button
              className="btn"
              onClick={startConnect}
              disabled={isWorking}
            >
              Connect to a Health Provider
            </button>
          </>
        ) : (
          // Connected providers state
          <>
            <p>Connected providers:</p>
            <ProviderList providers={providers.map(p => ({ name: p.name, connectedAt: p.connectedAt }))} />
            <div className="button-group">
              <button
                className="btn btn-secondary"
                onClick={startConnect}
                disabled={isWorking}
              >
                ➕ Add Another Provider
              </button>
            </div>
            <div className="button-group" style={{ marginTop: '24px' }}>
              <button
                className="btn"
                onClick={handleDownloadJson}
                disabled={isWorking}
              >
                📥 Download JSON
              </button>
              <button
                className="btn btn-success"
                onClick={handleDownloadSkill}
                disabled={isWorking}
              >
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

        {status === 'building' && (
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
