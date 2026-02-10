# Offline Access / Persistent Reconnect for health-skillz

## The Problem

Today health-skillz is one-shot: user logs into patient portal → browser fetches
all FHIR data → encrypts → sends to Claude → done. Every time Claude needs
fresh data, the user must log in again.

Goal: let users say "auto-sync my data every N days" or at least "reconnect
without logging in again." **Without the server ever touching refresh tokens or
other secrets.**

## Two Options

### Option A: "Confidential Client" with Browser-Embedded Secret

**Idea**: Register health-skillz as a confidential client (client_secret or
asymmetric JWT auth). Embed the client_secret (or private key) in the browser
bundle. Yes, everyone can see it. But that's no worse than a public client —
it's a browser app, there's no real secret. The upside: Epic will issue refresh
tokens to confidential clients.

**How it works**:
1. User does SMART standalone launch (as today)
2. Token exchange includes client_secret (Basic auth header) or a JWT signed
   with a key that ships in the JS bundle
3. Epic returns `access_token` + `refresh_token`
4. Store refresh_token in IndexedDB
5. When the user returns, use refresh_token to silently get a new access_token
6. Service worker / periodic sync can auto-fetch on a schedule

**Pros**:
- Works with any SMART server, not just Epic
- Simple implementation — just add client_secret to token exchange
- Refresh tokens are a well-understood pattern
- Service Worker + Periodic Background Sync API enables auto-refresh

**Cons**:
- **Security theater**: The "secret" is in the JS bundle. Anyone can extract it.
  Epic (and other EHRs) *might* not like this if they audit. The SMART spec says
  confidential clients "can securely store credentials" — a browser can't.
- **Refresh token in IndexedDB**: If the user's browser is compromised, the
  refresh token is exposed. (Same risk as the DCR private key, honestly, except
  WebCrypto non-extractable keys are slightly harder to steal.)
- **Client secret rotation**: If you ever need to rotate the secret, you have to
  ship a new bundle and the old one stops working. With JWK Set URLs you could
  rotate, but the private key is still in the bundle.
- **Epic may reject the registration**: Epic's app review process might flag
  a "confidential" app that ships its secret in client-side JS. Other EHR
  vendors might too.
- **One secret for all users**: Compromising the embedded secret gives the
  attacker the ability to use *any* user's refresh token (if they also steal
  the refresh token). With DCR, each device has its own keypair.

**Verdict**: This is the pragmatic choice. It works everywhere, is simple, and
the security posture is honestly fine (PKCE already protects the auth code
exchange; the refresh token is per-user). The "secret" is decorative — it's
really just a public client wearing a confidential client's hat. But it *might*
cause friction with Epic's app review.

### Option B: Epic's Dynamic Client Registration (DCR) + JWT Bearer

This is the flow from Epic's "Offline Access for Native and Browser-Based
Applications" documentation.

**How it works**:
1. User does SMART standalone launch as a **public** client → gets bootstrap
   access token
2. Browser generates RSA/EC keypair via **WebCrypto** (`extractable: false`)
3. Browser POSTs public key to Epic's `/oauth2/register` with the bootstrap
   token → gets back a dynamic `client_id`
4. Browser stores dynamic_client_id + CryptoKey in IndexedDB
5. Later: browser signs a JWT with the stored private key, POSTs to token
   endpoint with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`
   → gets a fresh access_token. No login needed.

**Pros**:
- **Proper security model**: The private key is truly non-extractable. Even
  XSS can't read it (can only use it for signing, but can't exfiltrate it).
- **Per-device binding**: Each browser gets its own dynamic client_id. Revoking
  one device doesn't affect others.
- **Server never touches secrets**: The server only registers the `software_id`
  with Epic. Everything else is browser ↔ Epic.
- **Epic explicitly supports this**: It's documented, tested, and expected.
  No risk of app review rejection.
- **No shared secret**: There's no single secret that compromises all users.

**Cons**:
- **Epic-only**: This DCR flow is an Epic-specific extension. Cerner, Athena,
  etc. don't support it (yet?). SMART App Launch IG v2 has a broader DCR spec
  but real-world support is thin.
- **Likely to rot**: Epic could change the API, require new registration fields,
  or deprecate it. You're coupling to one vendor's OAuth extension.
- **Browser storage fragility**: CryptoKey objects in IndexedDB survive browser
  restarts but not "Clear site data" or incognito mode. Users will lose their
  saved connections unexpectedly.
- **No service worker story**: The JWT bearer grant requires the WebCrypto
  private key. Service workers *can* access IndexedDB and WebCrypto, so
  background sync is possible — but you need a service worker that knows how
  to sign JWTs and make FHIR calls. More complex.
- **Discovery complexity**: Finding the `/oauth2/register` endpoint requires
  the `Epic-Client-ID` header in the metadata request. CORS may need config.
- **User-chosen duration**: Patients choose how long access lasts when they
  authorize. Could be 1 hour. You can't control this.

**Verdict**: Technically superior, but Epic-specific and more complex to build.
The security properties are genuinely better (non-extractable keys), but the
practical value is marginal if you're also supporting non-Epic EHRs.

## Recommendation: Option A (with nuance)

**Do Option A, but use asymmetric JWT auth instead of client_secret.**

Here's the key insight: Epic supports `private_key_jwt` as a token endpoint
auth method. You can register a JWK Set URL that serves your app's public key.
The "private" key ships in your JS bundle — yes, anyone can see it, but:

1. It's functionally equivalent to a public client with PKCE (the security
   comes from PKCE, not the key)
2. It satisfies the "confidential client" checkbox so Epic issues refresh tokens
3. The refresh token is per-user and bound to that client registration
4. It works with the standard SMART refresh token flow, not an Epic-specific
   extension

For non-Epic EHRs, you can fall back to client_secret_basic with an embedded
secret, or just use the public client flow (no refresh tokens = no persistent
access, which is the status quo).

### But also: the auto-sync feature is harder than it looks

Regardless of which auth option you pick, "auto-sync every N days" requires:

1. **Service Worker with background sync** — The `periodicSync` API is only
   available in Chrome and only if the site is installed as a PWA. Safari and
   Firefox don't support it. Real-world background sync is unreliable.

2. **Notification permission** — To remind users to re-sync, you need push
   notification permission. Users hate notification prompts.

3. **Data destination** — Where does the auto-synced data go? Currently it goes
   to a Claude session, but sessions expire in 1 hour. You'd need a persistent
   store concept.

A more realistic UX: when the user visits the connect page and has a saved
refresh token, show "Reconnect to [Hospital]" as a one-click button instead of
the full OAuth dance. The user still initiates — no background magic — but it's
frictionless.

## Implementation Sketch (Option A, asymmetric JWT)

### Server changes

**None for the secret.** The private key ships in the client bundle. The server
just hosts the JWK Set URL:

```
GET /.well-known/jwks.json → { "keys": [{ "kty": "RSA", ... }] }
```

This is the public key registered with Epic. The corresponding private key is
hardcoded in the client JS.

### Client changes

#### 1. JWT-authenticated token exchange

```typescript
// In oauth.ts — add JWT-based token exchange
async function exchangeCodeForTokenConfidential(
  code: string,
  tokenEndpoint: string,
  clientId: string, 
  redirectUri: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const jwt = await createClientAssertionJWT(clientId, tokenEndpoint);
  
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: jwt,
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  return response.json();
  // Response now includes refresh_token!
}
```

#### 2. Refresh token storage (IndexedDB)

```typescript
interface SavedConnection {
  ehrEndpoint: string;        // e.g., "https://fhir.hospital.org/R4"
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;       // encrypted? or just stored raw
  patientId: string;
  providerName: string;
  connectedAt: string;
  expiresAt?: string;         // if known
}
```

#### 3. Silent reconnect

```typescript
async function reconnect(saved: SavedConnection): Promise<TokenResponse> {
  const jwt = await createClientAssertionJWT(saved.clientId, saved.tokenEndpoint);
  
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: saved.refreshToken,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: jwt,
  });

  const response = await fetch(saved.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  return response.json(); // New access_token (and possibly new refresh_token)
}
```

#### 4. UI: "Saved Connections" on the connect page

When the user visits `/connect/:sessionId`, check IndexedDB for saved
connections. If found, show:

```
┌─────────────────────────────────────────┐
│  🏥 Saved Connections                   │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🏥 Epic Sandbox                 │    │
│  │ Connected 2 days ago            │    │
│  │ [Reconnect] [Remove]            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ─── or ───                             │
│                                         │
│  [+ Connect New Provider]               │
└─────────────────────────────────────────┘
```

"Reconnect" silently refreshes the token → fetches data → encrypts → done.

### What About Epic's DCR?

Keep it as a future enhancement. If/when SMART App Launch IG v2 standardizes
DCR for browser apps across vendors, revisit. For now, it's not worth the
complexity for an Epic-only feature.

However, the WebCrypto + IndexedDB pattern from Epic's DCR flow is worth
stealing for one thing: **encrypting the refresh token at rest**. Generate a
non-extractable AES key via WebCrypto, store it in IndexedDB alongside the
refresh token encrypted with that key. This way even if someone reads IndexedDB
via a backup tool, the refresh token is encrypted with a key that can't be
exported. It's defense in depth, not a security boundary, but it's free.

## What needs to happen in Epic's app registration

To get refresh tokens from Epic, the health-skillz app registration would need:

1. Register as a **confidential client** (not public)
2. Select **JWT authentication** (not client_secret, since we don't want a
   symmetric secret)
3. Provide a **JWK Set URL** hosting the public key
4. Request `offline_access` scope
5. The app review team needs to approve this — which is the risk point.
   They may push back on a browser app using confidential client profile.

Alternatively, keep the current public client registration and just add the
DCR capability checkbox ("Can Register Dynamic Clients"). Then you get the
best of both worlds: public client for the initial auth, DCR for persistent
access. But that's the Epic-specific path.

## Summary

| | Option A (embedded key) | Option B (Epic DCR) |
|---|---|---|
| Works with non-Epic EHRs | ✅ | ❌ |
| Server-side secrets | None | None |
| Implementation complexity | Low | Medium |
| Security of stored credential | Refresh token in IDB | Non-extractable CryptoKey in IDB |
| Epic app review risk | Medium ("browser confidential") | None (explicitly supported) |
| Maintenance burden | Low | High (Epic-specific API) |
| Background auto-sync | Possible (service worker) | Possible (service worker) |

**TL;DR**: Ship Option A with JWT auth. It's simpler, works across EHR vendors,
and the security tradeoff is honest. Consider encrypting stored refresh tokens
with a WebCrypto key for defense-in-depth. Leave Epic DCR as a documented
future option for when the standards catch up.
