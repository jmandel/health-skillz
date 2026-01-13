// Brand file loader with progress tracking
// Relies on HTTP Cache-Control headers for persistence

import type { BrandFile, BrandItem, LoadProgress } from './types';

export type ProgressCallback = (progress: LoadProgress) => void;

// In-memory cache for loaded brand files (within session)
const brandCache = new Map<string, BrandItem[]>();

/**
 * Load a brand file with progress reporting.
 * Brand files can be large (45MB+), so we stream and report progress.
 */
export async function loadBrandFile(
  url: string,
  onProgress?: ProgressCallback
): Promise<BrandItem[]> {
  // Check in-memory cache first
  const cached = brandCache.get(url);
  if (cached) {
    onProgress?.({ phase: 'ready', bytesLoaded: 0 });
    return cached;
  }

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
    brandCache.set(url, data.items);
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

  // Cache the result
  brandCache.set(url, data.items);

  onProgress?.({ phase: 'ready', bytesLoaded, totalBytes });

  return data.items;
}

/**
 * Search brand items by query string.
 * Uses the pre-computed searchName field for fast matching.
 * All search terms must match (as substrings) for an item to be included.
 */
export function searchBrands(items: BrandItem[], query: string): BrandItem[] {
  if (!query.trim()) {
    return items;
  }

  const queryLower = query.toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);
  
  // First pass: filter to matching items only (fast)
  const matches = items.filter(item => 
    terms.every(term => item.searchName.includes(term))
  );
  
  // Second pass: score only the matches
  const scored = matches.map(item => {
    const displayLower = item.displayName.toLowerCase();
    let score = 0;
    
    // Exact displayName match (highest priority)
    if (displayLower === queryLower) {
      score += 10000;
    }
    // displayName starts with query
    else if (displayLower.startsWith(queryLower)) {
      score += 5000;
    }
    // displayName contains exact phrase
    else if (displayLower.includes(queryLower)) {
      score += 2000;
    }
    
    // All terms present in displayName
    const displayTermMatches = terms.filter(term => displayLower.includes(term));
    if (displayTermMatches.length === terms.length) {
      score += 1000;
    }
    score += displayTermMatches.length * 100;
    
    // Bonus for displayName starting with first search term
    if (displayLower.startsWith(terms[0])) {
      score += 500;
    }
    
    // Bonus for shorter displayNames (more precise matches)
    // Max bonus of 200 for names <= 20 chars, decreasing for longer names
    const lengthBonus = Math.max(0, 200 - (displayLower.length - 20) * 5);
    score += lengthBonus;
    
    return { item, score };
  });
  
  // Sort by score descending, then alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.displayName.localeCompare(b.item.displayName);
  });

  return scored.map(({ item }) => item);
}

/**
 * Collapse multiple facilities from the same brand into a representative.
 * Shows "Matched X of Y locations" for collapsed items.
 * Preserves the search ranking order from matchedItems.
 */
export function collapseBrands(
  allItems: BrandItem[],
  matchedItems: BrandItem[],
  query?: string
): (BrandItem & { _matchedCount?: number; _totalCount?: number })[] {
  // Build a map of brandId -> all items for that brand
  const allByBrand = new Map<string, BrandItem[]>();
  for (const item of allItems) {
    const existing = allByBrand.get(item.brandId) || [];
    existing.push(item);
    allByBrand.set(item.brandId, existing);
  }
  
  const queryTerms = query?.toLowerCase().split(/\s+/).filter(Boolean) || [];
  
  // Track which brands we've already added (preserve search order)
  const seenBrands = new Set<string>();
  const result: (BrandItem & { _matchedCount?: number; _totalCount?: number })[] = [];

  for (const item of matchedItems) {
    if (seenBrands.has(item.brandId)) continue;
    seenBrands.add(item.brandId);
    
    const allForBrand = allByBrand.get(item.brandId) || [item];
    const matchedForBrand = matchedItems.filter(i => i.brandId === item.brandId);
    
    // Pick best representative:
    // 1. Prefer items where all query terms match in displayName
    // 2. Then brand-level items
    // 3. Then first match
    let rep = item;
    if (queryTerms.length > 0) {
      const displayMatch = matchedForBrand.find(i => {
        const dl = i.displayName.toLowerCase();
        return queryTerms.every(t => dl.includes(t));
      });
      if (displayMatch) rep = displayMatch;
    }
    if (rep === item) {
      rep = matchedForBrand.find(i => i.itemType === 'brand') || item;
    }
    
    if (allForBrand.length > 1) {
      result.push({
        ...rep,
        _matchedCount: matchedForBrand.length,
        _totalCount: allForBrand.length,
      });
    } else {
      result.push(rep);
    }
  }

  return result;
}
