import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { loadBrandFile, searchBrands, collapseBrands } from '../lib/brands/loader';
import type { BrandItem, LoadProgress, VendorConfig } from '../lib/brands/types';
import { saveOAuthState } from '../lib/storage';
import { useRecordsStore } from '../store/records';
import { getVendorConfigs } from '../lib/api';
import { buildAuthorizationUrl, generatePKCE } from '../lib/smart/oauth';
import ProviderSearch from '../components/ProviderSearch';
import ProviderCard from '../components/ProviderCard';
import StatusMessage from '../components/StatusMessage';

const PAGE_SIZE = 100;

/**
 * ProviderSelectPage — unified for both standalone (/records/add) and
 * session mode (/records/add?session=XYZ).
 */
export default function ProviderSelectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Session ID from query param (session mode) or null (standalone)
  const sessionId = searchParams.get('session') || undefined;
  const backUrl = sessionId ? `/connect/${sessionId}` : '/records';

  // Loading state — start with a synthetic 'loading' progress so we
  // never render the error branch or the main content before init completes.
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ phase: 'fetching', bytesLoaded: 0 });
  const [error, setError] = useState<string | null>(null);
  
  // Pagination
  const [page, setPage] = useState(1);

  // Data
  const [allItems, setAllItems] = useState<BrandItem[]>([]);
  const [vendors, setVendors] = useState<Record<string, VendorConfig>>({});
  const [searchResults, setSearchResults] = useState<BrandItem[]>([]);
  const [query, setQuery] = useState('');
  
  // Paginated view
  const totalPages = Math.ceil(searchResults.length / PAGE_SIZE);
  const displayedItems = searchResults.slice(0, page * PAGE_SIZE);

  // Modal state
  const [selectedItem, setSelectedItem] = useState<BrandItem | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Load session and brand data
  useEffect(() => {
    const init = async () => {
      try {
        // Get vendor configs (separate from session info)
        const vendorConfigs = await getVendorConfigs();
        if (!vendorConfigs || Object.keys(vendorConfigs).length === 0) {
          setError('No healthcare providers configured');
          return;
        }
        setVendors(vendorConfigs);

        // Load brand files from all configured vendors
        const allBrandItems: BrandItem[] = [];
        for (const [vendorName, config] of Object.entries(vendorConfigs)) {
          // Load all brand files for this vendor
          for (const brandFile of config.brandFiles) {
            try {
              const items = await loadBrandFile(brandFile, setLoadProgress);
              // Tag items with vendor info
              for (const item of items) {
                (item as any)._vendor = vendorName;
              }
              allBrandItems.push(...items);
            } catch (err) {
              console.warn(`Failed to load brand file ${brandFile} for ${vendorName}:`, err);
            }
          }
        }

        if (allBrandItems.length === 0) {
          setError('Failed to load provider directory');
          return;
        }

        setAllItems(allBrandItems);
        setSearchResults(allBrandItems);
        setLoadProgress({ phase: 'ready', bytesLoaded: 0 });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      }
    };

    init();
  }, [sessionId]);

  // Handle search
  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);
      setPage(1); // Reset to first page on new search
      if (!q.trim()) {
        setSearchResults(allItems);
        return;
      }

      const matches = searchBrands(allItems, q);
      const collapsed = collapseBrands(allItems, matches, q);
      setSearchResults(collapsed);
    },
    [allItems]
  );

  // Handle provider selection
  const handleSelectProvider = (item: BrandItem) => {
    setSelectedItem(item);
  };

  // Handle connect (start OAuth)
  const handleConnect = async () => {
    if (!selectedItem) return;
    // For standalone mode, use a local session ID
    const effectiveSessionId = sessionId || 'local_' + crypto.randomUUID();

    const vendorName = (selectedItem as any)._vendor as string;
    const vendorConfig = vendors[vendorName];
    if (!vendorConfig) {
      setError('Vendor configuration not found');
      return;
    }

    const endpoint = selectedItem.endpoints[0];
    if (!endpoint) {
      setError('No FHIR endpoint available for this provider');
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      // Generate PKCE
      const pkce = await generatePKCE();

      // Use configured redirect URI (must match what's registered with EHR)
      const redirectUri = vendorConfig.redirectUrl || `${window.location.origin}/connect/callback`;

      // Build authorization URL (sessionId encoded in state for cross-origin recovery)
      const { authUrl, state, tokenEndpoint } = await buildAuthorizationUrl({
        fhirBaseUrl: endpoint.url,
        clientId: vendorConfig.clientId,
        scopes: vendorConfig.scopes,
        redirectUri,
        pkce,
        sessionId: effectiveSessionId,
      });

      // Save OAuth state keyed by state nonce (survives cross-origin redirect)
      const storeSession = useRecordsStore.getState().session;
      saveOAuthState(state, {
        sessionId: effectiveSessionId,
        publicKeyJwk: storeSession?.publicKeyJwk || null,
        codeVerifier: pkce.codeVerifier,
        tokenEndpoint,
        fhirBaseUrl: endpoint.url,
        clientId: vendorConfig.clientId,
        redirectUri,
        providerName: selectedItem.displayName,
      });

      // Redirect to authorization server
      window.location.href = authUrl;
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to start authorization');
    }
  };

  // Format progress message
  const getProgressMessage = () => {
    if (loadProgress.phase === 'fetching') {
      const mb = (loadProgress.bytesLoaded / 1024 / 1024).toFixed(1);
      // Don't show percentage - content-length is compressed size but we read decompressed
      return `Loading providers... ${mb} MB`;
    }
    if (loadProgress.phase === 'parsing') {
      return 'Processing provider directory...';
    }
    return '';
  };

  // Loading / error states
  if (loadProgress.phase !== 'ready') {
    return (
      <div className="page-centered">
        <div className="panel">
          <h1 className="page-title">Select a provider</h1>
          {error
            ? <StatusMessage status="error" message={error} />
            : <StatusMessage status="loading" message={getProgressMessage()} />
          }
          {error && (
            <button className="btn btn-secondary" onClick={() => navigate(backUrl)}>
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  // Standalone error after load (e.g. OAuth setup failure)
  if (error) {
    return (
      <div className="page-centered">
        <div className="panel">
          <h1 className="page-title">Select a provider</h1>
          <StatusMessage status="error" message={error} />
          <button className="btn btn-secondary" onClick={() => navigate(backUrl)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="provider-select-container">
      <div className="provider-select-header">
        <button
          className="back-button"
          onClick={() => navigate(backUrl)}
        >
          Back
        </button>
        <h1>Select Your Healthcare Provider</h1>
        <p>
          Search for your hospital, clinic, or healthcare system.
          {allItems.length > 0 && ` ${allItems.length.toLocaleString()} providers available.`}
        </p>
      </div>

      <ProviderSearch onSearch={handleSearch} placeholder="Search by name, city, or state..." />

      <div className="provider-results">
        {displayedItems.length === 0 ? (
          <p className="no-results">No providers found matching "{query}"</p>
        ) : (
          <>
            <p className="results-count">
              {query
                ? `Showing ${displayedItems.length} of ${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`
                : `Showing ${displayedItems.length} of ${allItems.length.toLocaleString()} providers`}
            </p>
            <div className="provider-grid">
              {displayedItems.map((item) => (
                <ProviderCard key={item.id} item={item} onClick={handleSelectProvider} />
              ))}
            </div>
            {displayedItems.length < searchResults.length && (
              <button
                className="btn load-more-btn"
                onClick={() => setPage(p => p + 1)}
              >
                Load More ({searchResults.length - displayedItems.length} remaining)
              </button>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {selectedItem && (
        <div className="modal-backdrop" onClick={() => !connecting && setSelectedItem(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Connect to {selectedItem.displayName}?</h2>
            <p>
              You will be redirected to sign in to your patient portal.
              After signing in, your health records will be securely transferred.
            </p>
            {selectedItem.brandName !== selectedItem.displayName && (
              <p className="modal-brand">Part of: {selectedItem.brandName}</p>
            )}
            {error && <StatusMessage status="error" message={error} />}
            <div className="modal-buttons">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedItem(null);
                  setConnecting(false);
                }}
              >
                Cancel
              </button>
              <button className="btn" onClick={handleConnect} disabled={connecting}>
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
