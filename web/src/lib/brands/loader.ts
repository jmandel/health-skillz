// Brand file loader with progress tracking

import type { BrandFile, BrandItem, LoadProgress } from './types';

export type ProgressCallback = (progress: LoadProgress) => void;

/**
 * Load a brand file with progress reporting.
 * Brand files can be large (45MB+), so we stream and report progress.
 */
export async function loadBrandFile(
  url: string,
  onProgress?: ProgressCallback
): Promise<BrandItem[]> {
  onProgress?.({ phase: 'fetching', bytesLoaded: 0 });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load brand file: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

  // If no streaming support or small file, just parse directly
  if (!response.body) {
    const text = await response.text();
    onProgress?.({ phase: 'parsing', bytesLoaded: text.length, totalBytes });
    const data: BrandFile = JSON.parse(text);
    onProgress?.({ phase: 'ready', bytesLoaded: text.length, totalBytes });
    return data.items;
  }

  // Stream the response for progress updates
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesLoaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytesLoaded += value.length;
    onProgress?.({ phase: 'fetching', bytesLoaded, totalBytes });
  }

  onProgress?.({ phase: 'parsing', bytesLoaded, totalBytes });

  // Combine chunks and parse
  const allBytes = new Uint8Array(bytesLoaded);
  let offset = 0;
  for (const chunk of chunks) {
    allBytes.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(allBytes);
  const data: BrandFile = JSON.parse(text);

  onProgress?.({ phase: 'ready', bytesLoaded, totalBytes });

  return data.items;
}

/**
 * Search brand items by query string.
 * Uses the pre-computed searchName field for fast matching.
 */
export function searchBrands(items: BrandItem[], query: string): BrandItem[] {
  if (!query.trim()) {
    return items;
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  
  // Score items by how many terms match
  const scored = items
    .map(item => {
      const matches = terms.filter(term => item.searchName.includes(term));
      return { item, score: matches.length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      // Sort by score descending, then alphabetically
      if (b.score !== a.score) return b.score - a.score;
      return a.item.displayName.localeCompare(b.item.displayName);
    });

  return scored.map(({ item }) => item);
}

/**
 * Collapse multiple facilities from the same brand into a representative.
 * Shows "Matched X of Y locations" for collapsed items.
 */
export function collapseBrands(
  allItems: BrandItem[],
  matchedItems: BrandItem[]
): (BrandItem & { _matchedCount?: number; _totalCount?: number })[] {
  const matchedSet = new Set(matchedItems.map(i => i.id));
  
  // Group by brandId
  const byBrand = new Map<string, { matched: BrandItem[]; all: BrandItem[] }>();
  
  for (const item of allItems) {
    const existing = byBrand.get(item.brandId) || { matched: [], all: [] };
    existing.all.push(item);
    if (matchedSet.has(item.id)) {
      existing.matched.push(item);
    }
    byBrand.set(item.brandId, existing);
  }

  const result: (BrandItem & { _matchedCount?: number; _totalCount?: number })[] = [];

  for (const { matched, all } of byBrand.values()) {
    if (matched.length === 0) continue;
    
    // Pick the best representative (prefer brand-level items, then first match)
    const rep = matched.find(i => i.itemType === 'brand') || matched[0];
    
    if (all.length > 1) {
      result.push({
        ...rep,
        _matchedCount: matched.length,
        _totalCount: all.length,
      });
    } else {
      result.push(rep);
    }
  }

  // Sort by match count descending, then name
  return result.sort((a, b) => {
    const aScore = a._matchedCount || 1;
    const bScore = b._matchedCount || 1;
    if (bScore !== aScore) return bScore - aScore;
    return a.displayName.localeCompare(b.displayName);
  });
}
