// API client for health-skillz server

import type { VendorConfig } from './brands/types';

export interface SessionInfo {
  sessionId: string;
  publicKey: JsonWebKey;
  status: string;
  providerCount: number;
}

export interface Provider {
  name: string;
  connectedAt: string;
}

export interface EncryptedPayload {
  encrypted: true;
  version: 2;
  ephemeralPublicKey: JsonWebKey;
  iv: string;  // base64
  ciphertext: string;  // base64
}

const BASE_URL = '';  // Same-origin API

export async function getSessionInfo(sessionId: string): Promise<SessionInfo> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Session not found or expired' : 'Failed to get session');
  }
  return res.json();
}

export async function sendEncryptedData(
  sessionId: string,
  payload: EncryptedPayload
): Promise<{ success: boolean; providerCount: number }> {
  const res = await fetch(`${BASE_URL}/api/data/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Server returned ${res.status}`);
  }
  return res.json();
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

export async function sendEncryptedEhrData(
  sessionId: string,
  payload: EncryptedPayload,
  finalizeToken: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ success: boolean; providerCount: number; redirectTo: string; errorId?: string }> {
  const body = JSON.stringify({
    ...payload,
    sessionId,
    finalizeToken,
  });

  // Use XMLHttpRequest for upload progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total });
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${xhr.responseText.slice(0, 100)}`));
        }
      } else {
        // Try to extract errorId from response
        let errorId = '';
        try {
          const errJson = JSON.parse(xhr.responseText);
          errorId = errJson.errorId ? ` [${errJson.errorId}]` : '';
        } catch (e) {}
        reject(new Error(`Server returned ${xhr.status}${errorId}: ${xhr.responseText.slice(0, 200)}`));
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });
    
    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out'));
    });
    
    xhr.open('POST', `${BASE_URL}/api/receive-ehr`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 120000; // 2 minute timeout
    xhr.send(body);
  });
}

export async function finalizeSession(
  sessionId: string,
  finalizeToken?: string
): Promise<{ success: boolean; providerCount: number }> {
  const res = await fetch(`${BASE_URL}/api/finalize/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ finalizeToken }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Server returned ${res.status}`);
  }
  return res.json();
}

// Skill template for local skill building
export interface SkillTemplate {
  skillMd: string;
  references: Record<string, string>;
}

export async function getSkillTemplate(): Promise<SkillTemplate> {
  const res = await fetch(`${BASE_URL}/api/skill-template`);
  if (!res.ok) {
    throw new Error('Failed to fetch skill template');
  }
  return res.json();
}

// Get vendor configs without a session (for local collection)
export async function getVendorConfigs(): Promise<Record<string, VendorConfig>> {
  // Use a dummy session request to get vendor configs
  // The server returns vendors in the session info, but we don't need a real session
  const res = await fetch(`${BASE_URL}/api/vendors`);
  if (!res.ok) {
    throw new Error('Failed to fetch vendor configs');
  }
  return res.json();
}

// Log client-side error to server (non-sensitive diagnostic info)
export interface ClientErrorInfo {
  sessionId?: string;
  errorCode?: string;
  httpStatus?: number;
  context?: string;
}

export async function logClientError(info: ClientErrorInfo): Promise<{ logged: boolean; errorId?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/log-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...info,
        userAgent: navigator.userAgent,
      }),
    });
    return res.json();
  } catch (e) {
    // Don't throw - error logging should never break the app
    return { logged: false };
  }
}
