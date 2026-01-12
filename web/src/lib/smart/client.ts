// FHIR client for fetching patient data

import { extractAttachments, type ProcessedAttachment } from './attachments';

export type ProgressCallback = (completed: number, total: number, currentResource: string) => void;

export interface FHIRBundle {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ resource: any }>;
}

export interface EHRData {
  fhir: Record<string, any[]>;
  attachments: ProcessedAttachment[];
}

// Resource types to fetch
const RESOURCE_QUERIES = [
  { resourceType: 'Patient', params: {} },
  { resourceType: 'Observation', params: { category: 'laboratory' } },
  { resourceType: 'Observation', params: { category: 'vital-signs' } },
  { resourceType: 'Observation', params: { category: 'social-history' } },
  { resourceType: 'Condition', params: {} },
  { resourceType: 'MedicationRequest', params: {} },
  { resourceType: 'MedicationStatement', params: {} },
  { resourceType: 'AllergyIntolerance', params: {} },
  { resourceType: 'Immunization', params: {} },
  { resourceType: 'Procedure', params: {} },
  { resourceType: 'DiagnosticReport', params: {} },
  { resourceType: 'DocumentReference', params: {} },
  { resourceType: 'Encounter', params: {} },
  { resourceType: 'CarePlan', params: {} },
  { resourceType: 'CareTeam', params: {} },
  { resourceType: 'Goal', params: {} },
];

const MAX_PAGES_PER_RESOURCE = 10;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_CONCURRENT_REQUESTS = 5;

/**
 * Fetch all patient data from FHIR server.
 */
export async function fetchPatientData(
  fhirBaseUrl: string,
  accessToken: string,
  patientId: string,
  onProgress?: ProgressCallback
): Promise<EHRData> {
  const base = fhirBaseUrl.replace(/\/+$/, '');
  const result: EHRData = { fhir: {}, attachments: [] };

  // Track progress
  const totalQueries = RESOURCE_QUERIES.length;
  let completedQueries = 0;

  // Process queries with limited concurrency
  const semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

  const queryPromises = RESOURCE_QUERIES.map(async (query) => {
    await semaphore.acquire();
    try {
      const resourceType = query.resourceType;
      onProgress?.(completedQueries, totalQueries, resourceType);

      // Build search URL
      const searchParams = new URLSearchParams();
      searchParams.set('patient', patientId);
      searchParams.set('_count', '100');
      for (const [key, value] of Object.entries(query.params)) {
        if (value) searchParams.set(key, value);
      }
      const url = `${base}/${resourceType}?${searchParams}`;

      // Fetch with pagination
      const resources = await fetchWithPagination(url, accessToken, MAX_PAGES_PER_RESOURCE);

      // Store resources
      if (!result.fhir[resourceType]) {
        result.fhir[resourceType] = [];
      }
      result.fhir[resourceType].push(...resources);

      completedQueries++;
      onProgress?.(completedQueries, totalQueries, resourceType);
    } catch (err) {
      console.warn(`Failed to fetch ${query.resourceType}:`, err);
      completedQueries++;
      onProgress?.(completedQueries, totalQueries, query.resourceType);
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(queryPromises);

  // Extract attachments from DocumentReference and DiagnosticReport
  onProgress?.(completedQueries, totalQueries + 1, 'Attachments');
  
  const docRefs = result.fhir['DocumentReference'] || [];
  const diagReports = result.fhir['DiagnosticReport'] || [];
  
  result.attachments = await extractAttachments(
    [...docRefs, ...diagReports],
    base,
    accessToken
  );

  onProgress?.(totalQueries + 1, totalQueries + 1, 'Complete');

  return result;
}

/**
 * Fetch a FHIR search with pagination.
 */
async function fetchWithPagination(
  initialUrl: string,
  accessToken: string,
  maxPages: number
): Promise<any[]> {
  const resources: any[] = [];
  let url: string | null = initialUrl;
  let page = 0;

  while (url && page < maxPages) {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/fhir+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Resource type not supported, skip
        return [];
      }
      throw new Error(`FHIR request failed: ${response.status}`);
    }

    const bundle: FHIRBundle = await response.json();

    // Extract resources from bundle entries
    if (bundle.entry) {
      for (const entry of bundle.entry) {
        if (entry.resource) {
          resources.push(entry.resource);
        }
      }
    }

    // Find next page link
    url = bundle.link?.find((l) => l.relation === 'next')?.url || null;
    page++;
  }

  return resources;
}

/**
 * Fetch with timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out: ${url}`);
    }
    throw err;
  }
}

/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
