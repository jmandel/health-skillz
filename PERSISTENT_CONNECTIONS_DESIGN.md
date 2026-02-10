# Persistent Connections Design

## Core Concept

The browser becomes a **personal health data wallet**. It accumulates
connections to EHR systems over time. These connections persist across
browser sessions via IndexedDB. When a Claude session requests health data,
the user selects which connections to share — or adds a new one.

Two separate concepts that are currently conflated:

| Concept | Lifetime | Storage | Purpose |
|---|---|---|---|
| **Connection** | Weeks to months | IndexedDB (persistent) | Refresh token + metadata for an EHR |
| **Session** | Minutes to hours | Server + sessionStorage | Claude's request for health data |

Today, everything is a session. The new model: connections are the durable
thing; sessions are transient requests that draw from them.

## User Journey

### First time ever (no connections)

```
Claude: "Can you look at my health records?"
  → Claude creates session, shows link
  → User clicks link

┌─────────────────────────────────────────────┐
│  🏥 Connect Your Health Records             │
│                                             │
│  No saved connections.                      │
│                                             │
│  [+ Connect a Health Provider]              │
│                                             │
│  🔒 Your connections are stored only in     │
│  this browser. Your server never sees your  │
│  login credentials or health data.          │
└─────────────────────────────────────────────┘

  → User picks provider, does OAuth, data fetched
  → After OAuth callback:
```

```
┌─────────────────────────────────────────────┐
│  🏥 Connect Your Health Records             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ ✅ Epic Sandbox                     │    │
│  │ Connected just now                  │    │
│  │ Patient: Camila Lopez               │    │
│  │ ☑ Include in this session           │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [+ Connect Another Provider]               │
│                                             │
│  ─── After sending ───                      │
│                                             │
│  ○ Keep this connection for later            │
│    (refresh silently next time)             │
│  ○ Clear everything after sending            │
│                                             │
│  [Send to AI ✅]                            │
└─────────────────────────────────────────────┘
```

If user picks "Keep this connection", the refresh token stays in IndexedDB.

### Returning with saved connections

```
Claude: "Can you look at my health records?"
  → User clicks link

┌─────────────────────────────────────────────┐
│  🏥 Connect Your Health Records             │
│                                             │
│  Saved connections:                         │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🏥 Mass General (Epic)              │    │
│  │ Last refreshed: 3 days ago          │    │
│  │ ☑ Include in this session           │    │
│  │ [Refresh Now] [Remove]              │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🏥 Stanford Health (Epic)           │    │
│  │ Last refreshed: 12 days ago         │    │
│  │ ☐ Include in this session           │    │
│  │ [Refresh Now] [Remove]              │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [+ Connect Another Provider]               │
│                                             │
│  [Send Selected to AI ✅]                   │
└─────────────────────────────────────────────┘
```

"Send Selected to AI" does:
1. For each checked connection: silently use refresh token → get access token → fetch FHIR data
2. Encrypt all fetched data with Claude's session public key
3. Upload ciphertext to server
4. Claude decrypts

The user never leaves the page. No OAuth redirects. Takes ~10-30 seconds depending on data volume.

### Connection went stale (refresh token expired)

```
┌─────────────────────────────────────────────┐
│  ┌─────────────────────────────────────┐    │
│  │ ⚠️ Mass General (Epic)              │    │
│  │ Connection expired                  │    │
│  │ [Re-authorize] [Remove]             │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

"Re-authorize" starts the OAuth flow again, replacing the stale refresh token.

### Managing connections outside of a session

The `/connections` page (accessible from homepage) lets users manage
connections without a Claude session:

```
┌─────────────────────────────────────────────┐
│  🔗 My Health Connections                   │
│                                             │
│  These connections are stored in this       │
│  browser only. No data is on any server.    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 🏥 Mass General (Epic)              │    │
│  │ Connected: Jan 15, 2025             │    │
│  │ Last refreshed: Jan 18, 2025        │    │
│  │ Status: ✅ Active                    │    │
│  │ [Refresh Now] [Remove]              │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [+ Add Connection]                         │
│  [Clear All Connections]                    │
└─────────────────────────────────────────────┘
```

## Refresh Token Lifecycle

### Assumptions
- Epic refresh tokens last ~90 days if unused (not documented, conservative)
- Each use of a refresh token may return a new refresh token (rolling refresh)
- Patient picks the access duration at authorization time

### Keeping connections alive

The goal: exercise each refresh token at least once every ~60 days so it
doesn't expire. Three mechanisms, from least to most intrusive:

**1. Opportunistic refresh (invisible)**
Whenever the user visits any health-skillz page (session link, homepage,
`/connections`), silently refresh all connections that are >30 days old.
This happens in the background. If it fails, mark the connection as stale.

```typescript
// On any page load:
const connections = await getAllConnections();
for (const conn of connections) {
  if (conn.lastRefreshedAt < Date.now() - 30 * DAY_MS) {
    try {
      await silentRefresh(conn);
    } catch {
      conn.status = 'stale';
      await saveConnection(conn);
    }
  }
}
```

This works great if the user uses health-skillz at least once a month.
For infrequent users, we need:

**2. Push notification nudge (opt-in)**
When a user saves a connection, offer: "Want a reminder to keep this
connection active?" If yes, request notification permission and register
a service worker.

The service worker checks IndexedDB periodically. If any connection is
>45 days since last refresh and the page isn't open:

```
🏥 Health Skillz
Your Mass General connection expires soon.
Tap to keep it active.
```

Tapping opens the site → opportunistic refresh kicks in → done.

**Important**: This does NOT require a push server. The service worker can
use the Notification API directly (local notifications) triggered by
periodic checks when the browser is open. True push notifications would
require a server, but local notifications triggered by a service worker's
periodic wake-up may be enough.

Actually — let's be honest about the limitations:
- `periodicSync` requires Chrome + PWA install. No Safari, no Firefox.
- Local notifications from service workers require the page to be open
  or the service worker to wake up, which browsers throttle aggressively.
- The most reliable approach: when the user visits, check and refresh.
  If they don't visit for 90 days, the connection dies. That's okay.

**3. Accept graceful degradation**
If a connection expires, it's not catastrophic. The user just re-authorizes.
The UX clearly shows "Connection expired — Re-authorize" and the OAuth
flow is familiar. Don't over-engineer the keep-alive.

### Recommended approach

Do #1 (opportunistic refresh on page load) and #3 (graceful degradation).
Skip #2 for now. The complexity of service worker + notifications isn't
worth it when the fallback (re-authorize) is straightforward.

Later, if demand exists, add an email-based reminder: "Your health
connection is about to expire. Click here to refresh it." This requires
collecting an email address but is far more reliable than push notifications.

## Data Model

### Connection (IndexedDB, persistent)

```typescript
interface SavedConnection {
  id: string;                  // UUID
  providerName: string;        // "Mass General"
  fhirBaseUrl: string;         // "https://fhir.hospital.org/R4"
  tokenEndpoint: string;       // Cached from SMART config
  clientId: string;            // Epic client_id used
  patientId: string;           // FHIR Patient ID
  refreshToken: string;        // The golden ticket
  scopes: string;              // Granted scopes
  createdAt: number;           // When first authorized
  lastRefreshedAt: number;     // When refresh token was last used
  lastDataFetchAt: number;     // When FHIR data was last pulled
  status: 'active' | 'stale' | 'refreshing' | 'error';
  errorMessage?: string;       // If status is 'error'
}
```

The refresh token is the only real secret here. We can optionally encrypt
it with a non-extractable WebCrypto AES key (defense in depth), but the
primary protection is the browser's origin isolation.

### Connection Data Cache (IndexedDB, persistent, optional)

```typescript
interface CachedData {
  connectionId: string;
  fetchedAt: number;
  fhir: Record<string, any[]>;
  attachments: ProcessedAttachment[];
}
```

This is optional. When the user says "send to AI", we can either:
- Use cached data (instant, but potentially stale)
- Re-fetch fresh data (takes 10-30s, but current)
- Let user choose: "Use data from 3 days ago, or refresh now?"

For v1, always re-fetch. Caching adds complexity and staleness concerns.

### Session (server + sessionStorage, transient)

Sessions remain as-is: a Claude-initiated request with a public key,
where encrypted data gets parked for Claude to poll. No changes needed
to the server-side session model.

The session doesn't know about connections. It just receives encrypted
blobs. The browser is the bridge.

## Architecture Changes

### New routes

```
/connections                  — Manage saved connections (standalone)
/connect/:sessionId           — Fulfill a session (select connections + add new)
/connect/:sessionId/select    — Add new connection (OAuth flow)
/connect/:sessionId/callback  — OAuth callback
/connect/callback             — OAuth callback (shared)
/collect                      — Local collection (existing, unchanged)
```

### New files

```
src/client/lib/connections.ts      — IndexedDB CRUD for SavedConnection
src/client/lib/smart/refresh.ts    — Silent refresh token flow
src/client/lib/smart/confidential.ts — JWT client assertion creation
src/client/pages/ConnectionsPage.tsx — Manage connections standalone
```

### Modified files

```
src/client/lib/smart/oauth.ts      — Add confidential client token exchange
src/client/pages/ConnectPage.tsx   — Show saved connections, select for session
src/client/pages/OAuthCallbackPage.tsx — Save connection after OAuth
src/client/App.tsx                 — Add /connections route
src/client/lib/storage.ts          — Connection storage helpers
config.json                        — Add JWK Set URL config?
```

### Server changes

Minimal. The server needs to host the JWKS endpoint:

```
GET /.well-known/jwks.json → { "keys": [{ public key }] }
```

And the Epic app registration needs to change from public to confidential
with JWT auth. That's a registration-time change, not a code change
(aside from the JWKS endpoint).

## The Embedded Key Question

For confidential client auth with JWT, we need a private key in the
browser. Options:

### Option A: Ship private key in the JS bundle

The private key is literally in the source code. `import PRIVATE_KEY from './keys/private.json'`.

Pros: Dead simple. One key for all users.
Cons: Anyone can extract it. But... that's fine? PKCE protects the auth
code exchange. The refresh token is per-user. The "private" key just
satisfies the confidential client requirement.

### Option B: Server generates JWT on demand

The browser asks the server to sign a client_assertion JWT. The server
holds the private key and signs it. The server never sees the refresh
token — it just signs a JWT that says "I am client_id X".

```
Browser: POST /api/sign-assertion { clientId, tokenEndpoint }
Server:  { assertion: "eyJ..." }  (signed JWT, valid ~5 min)
Browser: POST token_endpoint { client_assertion: "eyJ...", refresh_token: "..." }
```

Pros: Private key stays on server. Proper confidential client.
Cons: Server is involved in every token refresh (but doesn't see the
refresh token or the access token — it just signs a JWT). Adds a round
trip. If server is down, can't refresh.

### Option C: Per-browser key via WebCrypto (Epic DCR approach)

As explored in OFFLINE_ACCESS_ANALYSIS.md. Epic-only.

### Recommendation: Option A for v1

It's honest about what it is: a browser app wearing a confidential
client's hat. The security posture is identical to a public client
(PKCE protects the code exchange, refresh tokens are per-user, the
"secret" is decorative). If Epic's app review objects, fall back to
Option B.

Option B is the "proper" answer and only adds one server round-trip per
refresh. Worth considering if you want to be unimpeachable.

## What the User Sees: Full Flow

### Happy path with saved connection

1. User asks Claude about health records
2. Claude creates session, shows link
3. User clicks link → sees saved connections with checkboxes
4. User checks "Mass General", clicks "Send to AI"
5. Browser: refresh token → access token → fetch FHIR → encrypt → upload
6. User sees progress bar: "Refreshing token... Fetching records... Encrypting... Sending..."
7. Done. "Data sent to Claude. You can close this window."
8. Total time: ~15 seconds, zero OAuth redirects

### Happy path with new connection

1-3. Same as above
4. User clicks "+ Connect Another Provider"
5. Normal OAuth flow (redirect to patient portal, login, authorize)
6. Callback page: fetches data, offers to save connection
7. User checks "Keep this connection" + "Include in session"
8. Encrypt + upload → done

### Mixed: saved + new

1-3. Same
4. User checks saved "Mass General", also clicks "+ Connect Another"
5. OAuth flow for new provider
6. On return: both providers checked, ready to send
7. Encrypt both → upload → done

## Open Questions

### Q: What if the user has connections but visits without a session?

The `/connections` management page works without a session. Users can
refresh connections, remove them, or add new ones. No data is sent
anywhere — it's just maintenance.

### Q: Should we cache FHIR data between sessions?

Probably not for v1. Caching adds complexity (when is it stale? how much
space?) and the re-fetch is fast enough (~15s). Later, could offer
"Use cached data from 2 days ago" as an option.

### Q: What about the /collect flow?

The `/collect` flow (local-only, no server session) could also benefit
from saved connections. When the user visits `/collect`, they see their
connections and can refresh + download without OAuth. This is a natural
extension but not required for v1.

### Q: Multiple browsers / devices?

Connections are per-browser. If the user uses Chrome on their laptop and
Safari on their phone, they have two independent sets of connections.
There's no sync mechanism. This is a feature (no server-side state) and
a limitation (no cross-device convenience).

### Q: How does this interact with the existing session expiry?

Sessions still expire after 1 hour (server-side). Connections don't expire
(browser-side) until the refresh token dies. These are independent
lifetimes. A connection can outlive many sessions.

### Q: What scopes do we need?

Add `offline_access` to the requested scopes. Epic requires this to issue
refresh tokens. The patient will see a consent screen asking how long
to grant access.

```typescript
// Current:
scopes: "patient/*.rs"

// New:
scopes: "patient/*.rs offline_access"
```

### Q: Rolling refresh tokens?

Epic supports rolling refresh: when you use a refresh token, you may get
a new one back. The old one is invalidated. We need to handle this:

```typescript
const response = await refreshTokenExchange(connection);
if (response.refresh_token && response.refresh_token !== connection.refreshToken) {
  connection.refreshToken = response.refresh_token; // Save the new one!
  await saveConnection(connection);
}
```

This is critical — if you don't save the new refresh token, the old one
is dead and the connection is broken.
