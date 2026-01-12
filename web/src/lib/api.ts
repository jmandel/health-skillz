// API client for health-skillz server

export interface SessionInfo {
  sessionId: string;
  publicKey: JsonWebKey;
  status: string;
}

export interface Provider {
  name: string;
  connectedAt: string;
}

export interface EncryptedPayload {
  encrypted: true;
  ephemeralPublicKey: JsonWebKey;
  iv: number[];
  ciphertext: number[];
  providerName: string;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

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

export async function finalizeSession(
  sessionId: string
): Promise<{ success: boolean; providerCount: number }> {
  const res = await fetch(`${BASE_URL}/api/finalize/${sessionId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Server returned ${res.status}`);
  }
  return res.json();
}
