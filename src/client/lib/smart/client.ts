// FHIR client for fetching patient data

import { extractAttachments, type ProcessedAttachment } from './attachments';

export type ProgressPhase = 'resources' | 'references' | 'attachments';

export interface ProgressInfo {
  phase: ProgressPhase;
  completed: number;
  total: number;
  detail: string;
  subProgress?: { current: number; total: number };
}

export type ProgressCallback = (progress: ProgressInfo) => void;

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

// Patient search queries - resources that support patient search parameter
// Based on US Core IG mandatory search requirements (SHALL support)
const PATIENT_SEARCH_QUERIES = [
  // Patient demographics
  { resourceType: 'Patient', params: {}, patientInPath: true },
  
  // Observation by category (US Core observation profiles)
  // Base FHIR observation categories
  { resourceType: 'Observation', params: { category: 'laboratory' } },
  { resourceType: 'Observation', params: { category: 'vital-signs' } },
  { resourceType: 'Observation', params: { category: 'social-history' } },
  { resourceType: 'Observation', params: { category: 'survey' } },
  { resourceType: 'Observation', params: { category: 'exam' } },
  { resourceType: 'Observation', params: { category: 'therapy' } },
  { resourceType: 'Observation', params: { category: 'activity' } },
  { resourceType: 'Observation', params: { category: 'imaging' } },
  { resourceType: 'Observation', params: { category: 'procedure' } },
  // US Core extension categories (screening/assessment)
  { resourceType: 'Observation', params: { category: 'sdoh' } },
  { resourceType: 'Observation', params: { category: 'functional-status' } },
  { resourceType: 'Observation', params: { category: 'disability-status' } },
  { resourceType: 'Observation', params: { category: 'cognitive-status' } },
  // US Core extension categories (clinical result)
  { resourceType: 'Observation', params: { category: 'clinical-test' } },
  // US Core extension categories (ADI - Advance Directive Interoperability)
  { resourceType: 'Observation', params: { category: 'observation-adi-documentation' } },
  { resourceType: 'Observation', params: { category: 'care-experience-preference' } },
  { resourceType: 'Observation', params: { category: 'treatment-intervention-preference' } },
  
  // Condition by category (US Core condition profiles)
  { resourceType: 'Condition', params: { category: 'problem-list-item' } },
  { resourceType: 'Condition', params: { category: 'health-concern' } },
  { resourceType: 'Condition', params: { category: 'encounter-diagnosis' } },
  
  // DiagnosticReport by category (US Core diagnosticreport profiles)
  { resourceType: 'DiagnosticReport', params: { category: 'http://terminology.hl7.org/CodeSystem/v2-0074|LAB' } },
  { resourceType: 'DiagnosticReport', params: { category: 'http://loinc.org|LP29708-2' } }, // Radiology
  
  // DocumentReference by category (US Core documentreference profile)
  { resourceType: 'DocumentReference', params: { category: 'clinical-note' } },
  { resourceType: 'DocumentReference', params: {} }, // Also fetch all without category filter
  
  // CarePlan by category (US Core careplan profile) 
  { resourceType: 'CarePlan', params: { category: 'http://hl7.org/fhir/us/core/CodeSystem/careplan-category|assess-plan' } },
  
  // ServiceRequest by category (US Core servicerequest profile)
  { resourceType: 'ServiceRequest', params: { category: 'http://snomed.info/sct|386053000' } }, // Evaluation procedure
  { resourceType: 'ServiceRequest', params: { category: 'http://snomed.info/sct|410606002' } }, // Social service procedure  
  { resourceType: 'ServiceRequest', params: { category: 'sdoh' } },
  { resourceType: 'ServiceRequest', params: {} }, // Also fetch all
  
  // Resources without category search (patient-only search)
  { resourceType: 'AllergyIntolerance', params: {} },
  { resourceType: 'CareTeam', params: { status: 'active' } },
  { resourceType: 'Coverage', params: {} },
  { resourceType: 'Device', params: {} }, // Implantable devices
  { resourceType: 'Encounter', params: {} },
  { resourceType: 'FamilyMemberHistory', params: {} },
  { resourceType: 'Goal', params: {} },
  { resourceType: 'Immunization', params: {} },
  { resourceType: 'MedicationDispense', params: {} },
  { resourceType: 'MedicationRequest', params: { intent: 'order' } },
  { resourceType: 'MedicationStatement', params: {} }, // Not US Core but useful
  { resourceType: 'Procedure', params: {} },
  { resourceType: 'QuestionnaireResponse', params: {} },
  { resourceType: 'RelatedPerson', params: {} },
];

// Reference resource types - resources commonly referenced but not patient-searchable
// These will be fetched individually when referenced from patient data
const REFERENCE_RESOURCE_TYPES = new Set([
  'Practitioner',
  'PractitionerRole', 
  'Organization',
  'Location',
  'Medication',
  'Specimen',
  'Questionnaire',
  'Provenance',
]);

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
  
  // Track fetched resource IDs to avoid duplicates
  const fetchedIds = new Set<string>();
  
  // Track referenced resources to fetch later
  const referencedResources = new Set<string>();

  const semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

  // ==========================================================================
  // Phase 1: Resource searches
  // ==========================================================================
  const totalQueries = PATIENT_SEARCH_QUERIES.length;
  let completedQueries = 0;

  const queryPromises = PATIENT_SEARCH_QUERIES.map(async (query) => {
    await semaphore.acquire();
    try {
      const resourceType = query.resourceType;
      const category = query.params.category 
        ? String(query.params.category).split('|').pop() 
        : null;
      const label = category ? `${resourceType}:${category}` : resourceType;
      
      onProgress?.({
        phase: 'resources',
        completed: completedQueries,
        total: totalQueries,
        detail: label
      });

      let url: string;
      if (query.patientInPath) {
        url = `${base}/Patient/${patientId}`;
      } else {
        const searchParams = new URLSearchParams();
        searchParams.set('patient', patientId);
        searchParams.set('_count', '100');
        for (const [key, value] of Object.entries(query.params)) {
          if (value) searchParams.set(key, String(value));
        }
        url = `${base}/${resourceType}?${searchParams}`;
      }

      const resources = query.patientInPath 
        ? await fetchSingleResource(url, accessToken)
        : await fetchWithPagination(url, accessToken, (pageNum, totalPages) => {
            // Update progress with page info when fetching multiple pages
            onProgress?.({
              phase: 'resources',
              completed: completedQueries,
              total: totalQueries,
              detail: label,
              subProgress: totalPages && totalPages > 1 ? { current: pageNum, total: totalPages } : undefined
            });
          });

      if (!result.fhir[resourceType]) {
        result.fhir[resourceType] = [];
      }
      
      for (const resource of resources) {
        const resourceId = `${resource.resourceType}/${resource.id}`;
        if (!fetchedIds.has(resourceId)) {
          fetchedIds.add(resourceId);
          result.fhir[resourceType].push(resource);
          extractReferences(resource, referencedResources);
        }
      }

      completedQueries++;
    } catch (err) {
      console.warn(`Failed to fetch ${query.resourceType}:`, err);
      completedQueries++;
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(queryPromises);
  
  // Final progress update for phase 1
  onProgress?.({
    phase: 'resources',
    completed: totalQueries,
    total: totalQueries,
    detail: 'Done'
  });

  // ==========================================================================
  // Phase 2: Referenced resources
  // ==========================================================================
  const refsToFetch = Array.from(referencedResources).filter(ref => {
    const [resourceType] = ref.split('/');
    return REFERENCE_RESOURCE_TYPES.has(resourceType) && !fetchedIds.has(ref);
  });
  
  const totalRefs = refsToFetch.length;
  let completedRefs = 0;
  
  console.log(`[FHIR] Fetching ${totalRefs} referenced resources`);
  
  if (totalRefs > 0) {
    onProgress?.({
      phase: 'references',
      completed: 0,
      total: totalRefs,
      detail: 'Starting'
    });
    
    const refPromises = refsToFetch.map(async (ref) => {
      await semaphore.acquire();
      try {
        const [resourceType] = ref.split('/');
        const url = `${base}/${ref}`;
        const resources = await fetchSingleResource(url, accessToken);
        
        for (const resource of resources) {
          const resType = resource.resourceType;
          const resourceId = `${resType}/${resource.id}`;
          
          if (!fetchedIds.has(resourceId)) {
            fetchedIds.add(resourceId);
            if (!result.fhir[resType]) {
              result.fhir[resType] = [];
            }
            result.fhir[resType].push(resource);
          }
        }
        
        completedRefs++;
        onProgress?.({
          phase: 'references',
          completed: completedRefs,
          total: totalRefs,
          detail: resourceType
        });
      } catch (err) {
        console.warn(`Failed to fetch reference ${ref}:`, err);
        completedRefs++;
      } finally {
        semaphore.release();
      }
    });
    
    await Promise.all(refPromises);
  }
  
  onProgress?.({
    phase: 'references',
    completed: totalRefs,
    total: totalRefs,
    detail: 'Done'
  });

  // ==========================================================================
  // Phase 3: Attachments
  // ==========================================================================
  const docRefs = result.fhir['DocumentReference'] || [];
  const diagReports = result.fhir['DiagnosticReport'] || [];
  const attachmentSources = [...docRefs, ...diagReports];
  
  // Count total attachments to extract
  let totalAttachments = 0;
  for (const resource of attachmentSources) {
    if (resource.content) {
      totalAttachments += resource.content.length;
    }
    if (resource.presentedForm) {
      totalAttachments += resource.presentedForm.length;
    }
  }
  
  console.log(`[FHIR] Extracting ${totalAttachments} attachments from ${attachmentSources.length} resources`);
  
  onProgress?.({
    phase: 'attachments',
    completed: 0,
    total: totalAttachments,
    detail: 'Starting'
  });
  
  if (attachmentSources.length > 0) {
    result.attachments = await extractAttachments(
      attachmentSources,
      base,
      accessToken,
      (completed, total, detail) => {
        onProgress?.({
          phase: 'attachments',
          completed,
          total: totalAttachments,
          detail
        });
      }
    );
  }
  
  onProgress?.({
    phase: 'attachments',
    completed: totalAttachments,
    total: totalAttachments,
    detail: 'Done'
  });

  // Log summary
  console.log('[FHIR] Fetch complete. Resources by type:');
  for (const [type, resources] of Object.entries(result.fhir)) {
    console.log(`  ${type}: ${resources.length}`);
  }
  console.log(`  Attachments: ${result.attachments.length}`);

  return result;
}

/**
 * Extract all relative references from a FHIR resource.
 */
function extractReferences(obj: any, references: Set<string>, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractReferences(item, references, path);
    }
    return;
  }
  
  // Check for reference field
  if (obj.reference && typeof obj.reference === 'string') {
    const ref = obj.reference;
    // Only include relative references (ResourceType/id format)
    // Exclude absolute URLs and contained references (#id)
    if (/^[A-Z][a-zA-Z]+\/[^/]+$/.test(ref)) {
      references.add(ref);
    }
  }
  
  // Recurse into nested objects
  for (const key of Object.keys(obj)) {
    if (key !== 'reference') { // Don't recurse into reference strings
      extractReferences(obj[key], references, `${path}.${key}`);
    }
  }
}

/**
 * Fetch a single resource by URL.
 */
async function fetchSingleResource(
  url: string,
  accessToken: string
): Promise<any[]> {
  console.log(`[FHIR] Fetching: ${url}`);
  
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/fhir+json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.log(`[FHIR] 404 - resource not found: ${url}`);
      return [];
    }
    throw new Error(`FHIR request failed: ${response.status}`);
  }

  const resource = await response.json();
  return [resource];
}

/**
 * Fetch a FHIR search with pagination - follows all pages.
 */
async function fetchWithPagination(
  initialUrl: string,
  accessToken: string,
  onPage?: (pageNum: number, totalPages: number | null) => void
): Promise<any[]> {
  const resources: any[] = [];
  let url: string | null = initialUrl;
  let pageCount = 0;

  console.log(`[FHIR] Starting fetch: ${initialUrl}`);

  while (url) {
    pageCount++;
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/fhir+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Resource type not supported, skip
        console.log(`[FHIR] 404 - resource type not supported`);
        return [];
      }
      throw new Error(`FHIR request failed: ${response.status}`);
    }

    const bundle: FHIRBundle = await response.json();
    
    const entryCount = bundle.entry?.length || 0;
    const nextLink = bundle.link?.find((l) => l.relation === 'next')?.url || null;
    
    // Estimate total pages from bundle.total (if available) and page size
    const pageSize = entryCount || 100;
    const estimatedTotalPages = bundle.total ? Math.ceil(bundle.total / pageSize) : null;
    
    console.log(`[FHIR] Page ${pageCount}/${estimatedTotalPages || '?'}: ${entryCount} entries, total: ${bundle.total}`);
    
    // Report page progress
    onPage?.(pageCount, estimatedTotalPages);

    // Extract resources from bundle entries
    if (bundle.entry) {
      for (const entry of bundle.entry) {
        if (entry.resource) {
          resources.push(entry.resource);
        }
      }
    }

    // Find next page link
    url = nextLink;
  }

  console.log(`[FHIR] Finished: ${resources.length} total resources from ${pageCount} pages`);
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
