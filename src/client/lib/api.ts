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

export async function sendEncryptedEhrData(
  sessionId: string,
  payload: EncryptedPayload,
  finalizeToken: string
): Promise<{ success: boolean; providerCount: number; redirectTo: string }> {
  const res = await fetch(`${BASE_URL}/api/receive-ehr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      sessionId,
      finalizeToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Server returned ${res.status}`);
  }
  return res.json();
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
