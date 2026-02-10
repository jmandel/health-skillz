// Attachment extraction for clinical documents

export interface ProcessedAttachment {
  resourceType: string;
  resourceId: string;
  contentIndex: number;        // Index within resource's content array (0-based)
  contentType: string;
  contentPlaintext: string | null;
  contentBase64: string | null;
}

const MAX_CONCURRENT_ATTACHMENTS = 5;

export type AttachmentProgressCallback = (completed: number, total: number, detail: string) => void;

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

/**
 * Extract and process attachments from DocumentReference and DiagnosticReport resources.
 */
export async function extractAttachments(
  resources: any[],
  fhirBaseUrl: string,
  accessToken: string,
  onProgress?: AttachmentProgressCallback
): Promise<ProcessedAttachment[]> {
  const attachments: ProcessedAttachment[] = [];
  const seen = new Set<string>();

  // First pass: count total attachments to process
  const toProcess: Array<{ node: any; resourceType: string; resourceId: string; contentIndex: number; contentType: string }> = [];
  for (const resource of resources) {
    const resourceType = resource.resourceType;
    const resourceId = resource.id;
    const nodes = findAttachmentNodes(resource);
    
    for (const { node, index } of nodes) {
      const url = node.url || (node.data ? `inline:${resourceId}:${index}` : null);
      if (!url) continue;
      
      const key = `${resourceType}/${resourceId}/${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      const contentType = node.contentType || 'application/octet-stream';
      toProcess.push({ node, resourceType, resourceId, contentIndex: index, contentType });
    }
  }

  const total = toProcess.length;
  onProgress?.(0, total, '');

  // Second pass: fetch and process in parallel with semaphore
  const semaphore = new Semaphore(MAX_CONCURRENT_ATTACHMENTS);
  let completed = 0;

  const promises = toProcess.map(async ({ node, resourceType, resourceId, contentIndex, contentType }) => {
    await semaphore.acquire();
    const typeLabel = getContentTypeLabel(contentType);
    
    try {
      const processed = await fetchAndProcessAttachment(
        node,
        resourceType,
        resourceId,
        contentIndex,
        fhirBaseUrl,
        accessToken
      );
      if (processed) {
        attachments.push(processed);
      }
    } catch (err) {
      console.warn(`Failed to process attachment:`, err);
    } finally {
      completed++;
      onProgress?.(completed, total, typeLabel);
      semaphore.release();
    }
  });

  await Promise.all(promises);

  return attachments;
}

/**
 * Get a friendly label for a content type.
 */
function getContentTypeLabel(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.includes('pdf')) return 'PDF';
  if (type.includes('html')) return 'HTML';
  if (type.includes('xml')) return 'XML';
  if (type.includes('rtf')) return 'RTF';
  if (type.includes('plain')) return 'Text';
  if (type.includes('json')) return 'JSON';
  if (type.includes('image')) return 'Image';
  if (type.includes('dicom')) return 'DICOM';
  // Return the subtype (after the /)
  const parts = contentType.split('/');
  return parts[1]?.split(';')[0] || contentType;
}

interface AttachmentNode {
  node: any;
  index: number;
}

/**
 * Find attachment nodes in a FHIR resource.
 */
function findAttachmentNodes(resource: any): AttachmentNode[] {
  const nodes: AttachmentNode[] = [];

  // DocumentReference.content[].attachment
  if (resource.content && Array.isArray(resource.content)) {
    for (let i = 0; i < resource.content.length; i++) {
      if (resource.content[i].attachment) {
        nodes.push({ node: resource.content[i].attachment, index: i });
      }
    }
  }

  // DiagnosticReport.presentedForm[]
  if (resource.presentedForm && Array.isArray(resource.presentedForm)) {
    for (let i = 0; i < resource.presentedForm.length; i++) {
      nodes.push({ node: resource.presentedForm[i], index: i });
    }
  }

  return nodes;
}

/**
 * Fetch and process a single attachment.
 */
async function fetchAndProcessAttachment(
  attachment: any,
  resourceType: string,
  resourceId: string,
  contentIndex: number,
  fhirBaseUrl: string,
  accessToken: string
): Promise<ProcessedAttachment | null> {
  const contentType = attachment.contentType || 'application/octet-stream';
  let url = attachment.url;

  // Handle relative URLs
  if (url && !url.startsWith('http')) {
    url = `${fhirBaseUrl.replace(/\/+$/, '')}/${url}`;
  }

  // Handle inline base64 data
  if (attachment.data) {
    const data = attachment.data;
    const plaintext = extractTextFromBase64(data, contentType);
    return {
      resourceType,
      resourceId,
      contentIndex,
      contentType,
      contentPlaintext: plaintext,
      contentBase64: data,
    };
  }

  if (!url) return null;

  // Fetch the attachment
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: contentType,
    },
  });

  if (!response.ok) {
    console.warn(`Failed to fetch attachment: ${response.status}`);
    return null;
  }

  const blob = await response.blob();

  // Convert to base64
  const base64 = await blobToBase64(blob);

  // Extract text
  const plaintext = await extractTextFromBlob(blob, contentType);

  return {
    resourceType,
    resourceId,
    contentIndex,
    contentType,
    contentPlaintext: plaintext,
    contentBase64: base64,
  };
}

/**
 * Convert blob to base64.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Extract plain text from blob based on content type.
 */
async function extractTextFromBlob(blob: Blob, contentType: string): Promise<string | null> {
  try {
    const text = await blob.text();
    
    // Detect actual content type from content (EHRs often mislabel)
    const isHtml = text.trimStart().startsWith('<') && 
      (text.includes('<div') || text.includes('<span') || text.includes('<html') || text.includes('<p>'));
    const isXml = text.trimStart().startsWith('<?xml') || 
      (text.trimStart().startsWith('<') && text.includes('xmlns'));
    const isRtf = text.trimStart().startsWith('{\\rtf');
    
    if (isHtml || contentType.startsWith('text/html')) {
      return htmlToText(text);
    }

    if (isXml || contentType.includes('xml')) {
      return xmlToText(text);
    }

    if (isRtf || contentType.startsWith('application/rtf') || contentType.startsWith('text/rtf')) {
      return rtfToText(text);
    }

    if (
      contentType.startsWith('text/') ||
      contentType === 'application/json' ||
      contentType === 'application/fhir+json'
    ) {
      return text;
    }

    // For PDFs and other binary, return null (base64 is still available)
    return null;
  } catch (err) {
    console.warn('Text extraction failed:', err);
    return null;
  }
}

/**
 * Extract text from base64-encoded data.
 */
function extractTextFromBase64(data: string, contentType: string): string | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const text = new TextDecoder().decode(bytes);

    if (contentType.startsWith('text/html')) {
      return htmlToText(text);
    }
    if (contentType.includes('xml')) {
      return xmlToText(text);
    }
    if (contentType.startsWith('application/rtf') || contentType.startsWith('text/rtf')) {
      return rtfToText(text);
    }
    if (contentType.startsWith('text/')) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert HTML to plain text.
 */
function htmlToText(html: string): string {
  // Create a DOM parser
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Remove script and style elements
  const scripts = doc.querySelectorAll('script, style');
  scripts.forEach((el) => el.remove());

  // Get text content
  let text = doc.body?.textContent || doc.documentElement?.textContent || '';

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Convert XML to plain text (extract text nodes).
 */
function xmlToText(xml: string): string {
  try {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      // Fall back to regex-based extraction
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    // Extract all text content
    const text = doc.documentElement?.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    // Fall back to regex-based extraction
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Convert RTF to plain text (best effort).
 */
function rtfToText(rtf: string): string {
  let text = rtf;

  // Remove RTF header and font tables
  text = text.replace(
    /\{\\fonttbl.*?\}|\{\\colortbl.*?\}|\{\\stylesheet.*?\}|\{\\info.*?\}/gs,
    ''
  );

  // Handle unicode characters
  text = text.replace(/\\u(\d+)\s*\\?\s?/g, (_, dec) => {
    return String.fromCharCode(parseInt(dec, 10));
  });

  // Handle hex characters
  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // Convert RTF control words to text equivalents
  text = text.replace(/\\(par|pard|sect|page|line)\b\s*/g, '\n');
  text = text.replace(/\\tab\b\s*/g, '\t');

  // Remove remaining control words
  text = text.replace(/\\[a-zA-Z]+(-?\d+)?\s?/g, '');

  // Remove braces
  text = text.replace(/[{}]/g, '');

  // Clean up whitespace
  text = text.replace(/(\n\s*){2,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.trim();

  return text || '[Empty RTF content]';
}
