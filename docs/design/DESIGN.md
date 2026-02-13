# Health Skillz - Design Document

## Overview

Health Skillz is a **Claude Skill** that enables Claude to securely fetch and analyze a user's electronic health records (EHR) from their healthcare provider's patient portal using the **SMART on FHIR** standard.

## Goals

### Primary Goals

1. **Enable health data analysis in Claude** - Allow users to ask Claude questions about their personal health records without manually copying/pasting data

2. **Secure, standards-based access** - Use SMART on FHIR, the same OAuth-based standard that powers patient-facing health apps, ensuring proper authorization

3. **End-to-end encryption** - Health data is encrypted in the user's browser before transmission; only Claude can decrypt it. The server never sees plaintext health data.

4. **Rich analysis capabilities** - Provide Claude with both structured FHIR data (labs, meds, conditions) and unstructured clinical notes for comprehensive analysis

5. **Multi-provider support** - Users can connect multiple healthcare providers in a single session for cross-provider analysis

6. **Simple user experience** - One records hub for collection/management, plus an explicit "Send to AI" step for sharing

### Non-Goals

- Long-term data storage (sessions expire after 1 hour)
- Direct EHR write-back
- Server-side data processing (all analysis happens in Claude)

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLAUDE DESKTOP / WEB                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Claude with Health Record Assistant Skill                          │   │
│  │  - Generates ECDH keypair (keeps private key)                       │   │
│  │  - Creates session via API (sends public key)                       │   │
│  │  - Shows user connection link                                       │   │
│  │  - Polls until encrypted data ready                                 │   │
│  │  - Decrypts and analyzes FHIR data                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  1. POST /api/session       │
                    │     (with ECDH public key)  │
                    │  5. GET /api/poll/:id       │
                    │     (receives ciphertext)   │
                    ▼                             │
┌─────────────────────────────────────────────────┴───────────────────────────┐
│                         HEALTH-SKILLZ SERVER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Bun Server (src/server.ts) + React SPA (src/client/)               │   │
│  │                                                                      │   │
│  │  API Endpoints:                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐                │   │
│  │  │POST /api/   │  │GET /api/    │  │POST /api/     │                │   │
│  │  │  session    │  │  poll/:id   │  │  receive-ehr  │                │   │
│  │  │  (create)   │  │  (poll)     │  │  (encrypted)  │                │   │
│  │  └──────┬──────┘  └──────┬──────┘  └───────┬───────┘                │   │
│  │         │                │                 │                         │   │
│  │         └────────────────┼─────────────────┘                         │   │
│  │                          ▼                                           │   │
│  │                 ┌─────────────────┐                                  │   │
│  │                 │  SQLite DB      │                                  │   │
│  │                 │  - sessions     │                                  │   │
│  │                 │  - public keys  │                                  │   │
│  │                 │  - ciphertext   │  ← Server stores only encrypted  │   │
│  │                 └─────────────────┘    blobs, never plaintext        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  React SPA Routes (Bun fullstack):                                  │   │
│  │                                                                      │   │
│  │  /                        HomePage (skill download, docs)            │   │
│  │  /records                  RecordsPage (connection hub)              │   │
│  │  /records/add              ProviderSelectPage (search providers)     │   │
│  │  /records/callback         OAuthCallbackPage (OAuth → fetch → save)  │   │
│  │  /connect/:sessionId       ConnectPage (session wrapper around       │   │
│  │                            RecordsPage + Send to AI)                 │   │
│  │  /connect/callback         OAuthCallbackPage (shared callback route) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  2. User clicks link        │
                    │  3. OAuth redirect flow     │
                    │  4. FHIR fetch + encrypt    │
                    ▼                             │
┌─────────────────────────────────────────────────┴───────────────────────────┐
│                         PATIENT PORTAL (e.g., Epic MyChart)                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SMART on FHIR Authorization Server                                 │   │
│  │  - User authentication                                              │   │
│  │  - Consent/authorization                                            │   │
│  │  - Access token issuance (with PKCE)                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  FHIR R4 API                                                        │   │
│  │  - Patient demographics                                             │   │
│  │  - Conditions, Medications, Allergies                               │   │
│  │  - Observations (labs, vitals)                                      │   │
│  │  - DocumentReferences (clinical notes)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Sequence

```
┌───────┐          ┌────────────┐          ┌─────────────┐          ┌──────────┐
│Claude │          │health-skillz│          │   User's    │          │Patient   │
│+ Skill│          │  Server    │          │   Browser   │          │Portal    │
└───┬───┘          └─────┬──────┘          └──────┬──────┘          └────┬─────┘
    │                    │                        │                      │
    │ 1. Generate ECDH keypair                    │                      │
    │    (keep private key)                       │                      │
    │                    │                        │                      │
    │ 2. POST /api/session                        │                      │
    │    {publicKey: ...}│                        │                      │
    │───────────────────>│                        │                      │
    │                    │                        │                      │
    │ {sessionId, userUrl, pollUrl}               │                      │
    │<───────────────────│                        │                      │
    │                    │                        │                      │
    │ 3. Show link to user                        │                      │
    │ "Click to connect: [userUrl]"               │                      │
    │                    │                        │                      │
    │                    │ 4. User clicks link    │                      │
    │                    │    GET /connect/:id    │                      │
    │                    │<───────────────────────│                      │
    │                    │                        │                      │
    │                    │ 5. Serve React SPA     │                      │
    │                    │    (with publicKey)    │                      │
    │                    │───────────────────────>│                      │
    │                    │                        │                      │
    │                    │                        │ 6. User selects      │
    │                    │                        │    provider, clicks  │
    │                    │                        │    "Connect"         │
    │                    │                        │                      │
    │                    │                        │ 7. OAuth redirect    │
    │                    │                        │    (PKCE flow)       │
    │                    │                        │─────────────────────>│
    │                    │                        │                      │
    │                    │                        │ 8. User logs in &    │
    │                    │                        │    authorizes app    │
    │                    │                        │<─────────────────────│
    │                    │                        │                      │
    │                    │                        │ 9. OAuth callback    │
    │                    │                        │    with auth code    │
    │                    │                        │<─────────────────────│
    │                    │                        │                      │
    │                    │                        │ 10. Exchange code    │
    │                    │                        │     for token        │
    │                    │                        │─────────────────────>│
    │                    │                        │                      │
    │                    │                        │ 11. Fetch all FHIR   │
    │                    │                        │     resources        │
    │                    │                        │─────────────────────>│
    │                    │                        │                      │
    │                    │                        │ {Patient, Conditions,│
    │                    │                        │  Meds, Labs, Notes}  │
    │                    │                        │<─────────────────────│
    │                    │                        │                      │
    │                    │                        │ 12. Generate         │
    │                    │                        │     ephemeral ECDH   │
    │                    │                        │     keypair          │
    │                    │                        │                      │
    │                    │                        │ 13. Derive shared    │
    │                    │                        │     secret with      │
    │                    │                        │     Claude's pubkey  │
    │                    │                        │                      │
    │                    │                        │ 14. Encrypt data     │
    │                    │                        │     with AES-256-GCM │
    │                    │                        │                      │
    │                    │ 15. POST /api/receive-ehr (chunk uploads)     │
    │                    │     {version:3, finalizeToken, providerKey,   │
    │                    │      totalChunks, chunk{index,key,iv,data}}   │
    │                    │<───────────────────────│                      │
    │                    │                        │                      │
    │                    │ 16. Store ciphertext   │                      │
    │                    │     (cannot decrypt)   │                      │
    │                    │                        │                      │
    │                    │                        │ 17. User selects     │
    │                    │                        │     records and      │
    │                    │                        │     clicks "Send..." │
    │                    │                        │                      │
    │                    │ 18. POST /api/finalize/:id                    │
    │                    │<───────────────────────│                      │
    │                    │                        │                      │
    │ 19. Poll GET /api/poll/:id                  │                      │
    │───────────────────>│                        │                      │
    │                    │                        │                      │
    │ {ready: true,      │                        │                      │
    │  providers: [...]}                          │                      │
    │<───────────────────│                        │                      │
    │                    │                        │                      │
    │ 20. Download chunk ciphertext via           │                      │
    │     /api/chunks/:sessionId/...              │                      │
    │                    │                        │                      │
    │ 21. Derive shared secret + decrypt chunks   │                      │
    │                    │                        │                      │
    │ 22. Analyze FHIR data                       │                      │
    │     (labs, meds, notes)                     │                      │
    │                    │                        │                      │
```

## Key Design Decisions

### 1. OAuth Redirect Flow (not popup)

The app uses a standard OAuth redirect flow within a single-page React application:

1. User clicks "Connect" on provider selection page
2. Browser redirects to EHR's authorization endpoint
3. User authenticates and authorizes
4. EHR redirects back to `/connect/callback` (or `/records/callback` in standalone mode)
5. Callback page exchanges code for token, fetches data, and saves it to local browser storage

**Why redirect instead of popup?**
- Simpler implementation with React Router
- Better mobile support
- Session state preserved via sessionStorage and URL state parameter
- No cross-origin postMessage complexity

### 2. Session-Based Polling

**Why polling instead of webhooks?**
- Claude's skill environment can't receive webhooks
- Simple, reliable implementation
- Long-polling reduces latency (up to 60s timeout)

**Session lifecycle:**
1. **Created**: Claude calls `POST /api/session` with ECDH public key
2. **Collecting**: User connects providers, encrypted data accumulates
3. **Finalized**: User clicks "Send ... to AI", upload completes, session finalized
4. **Expired**: Auto-deleted after 1 hour

### 3. End-to-End Encryption

**Why E2E encryption?**
- Health data is highly sensitive (HIPAA, privacy)
- Server operator doesn't need to see plaintext
- Reduces liability and attack surface
- User can trust that only Claude sees their data

**Crypto details:**
- **Key exchange**: ECDH with P-256 curve
- **Encryption**: AES-256-GCM (authenticated encryption)
- **Per-provider ephemeral keys**: Each provider connection generates a fresh keypair for forward secrecy
- **What's encrypted**: All health data including provider name, FHIR resources, attachments

### 4. Integrated SMART on FHIR Client

The SMART on FHIR implementation is fully integrated into the React app (`src/client/lib/smart/`):

- **oauth.ts**: PKCE generation, authorization URL building, token exchange
- **client.ts**: FHIR resource fetching with pagination, reference resolution
- **attachments.ts**: Document extraction (HTML, RTF, XML → plaintext)

**Key features:**
- PKCE (Proof Key for Code Exchange) for security
- Concurrent fetching with semaphore (5 parallel requests)
- Comprehensive resource coverage (US Core profiles)
- Text extraction from clinical documents

### 5. Browser-Side Data Storage

During a session, the browser stores data locally:

- **sessionStorage**: OAuth state, session metadata, provider summaries
- **IndexedDB**: Full health data for multi-provider aggregation and download

**Why browser storage?**
- Enables "Download My Records" feature before encryption
- Supports multi-provider aggregation in single session
- Survives OAuth redirects
- Large data (health records can be 10MB+) exceeds sessionStorage limits

### 6. Data Structure

```typescript
interface ProviderData {
  name: string;           // Provider display name
  fhirBaseUrl: string;    // FHIR server URL
  connectedAt: string;    // ISO timestamp
  fhir: {
    Patient?: Patient[];
    Condition?: Condition[];
    MedicationRequest?: MedicationRequest[];
    Observation?: Observation[];  // Labs, vitals
    Procedure?: Procedure[];
    Immunization?: Immunization[];
    AllergyIntolerance?: AllergyIntolerance[];
    Encounter?: Encounter[];
    DocumentReference?: DocumentReference[];
    DiagnosticReport?: DiagnosticReport[];
    CareTeam?: CareTeam[];
    Goal?: Goal[];
    // Referenced resources
    Practitioner?: Practitioner[];
    Organization?: Organization[];
    Location?: Location[];
    Medication?: Medication[];
  };
  attachments: AttachmentSource[];
}

interface AttachmentSource {
  source: {
    resourceType: string;     // "DocumentReference" or "DiagnosticReport"
    resourceId: string;       // FHIR resource ID
  };
  bestEffortFrom: number | null;    // Index into originals[]
  bestEffortPlaintext: string | null;
  originals: AttachmentOriginal[];  // originals[contentIndex] aligns to source content index
}

interface AttachmentOriginal {
  contentIndex: number;
  contentType: string | null;
  contentPlaintext: string | null;
  contentBase64: string | null;
}
```

**Design rationale:**
- Each provider is a separate object (preserves data provenance)
- FHIR resources grouped by type for easy querying
- **Attachments are canonical**: Inline `attachment.data` is stripped from FHIR resources to avoid duplication. All attachment content lives in `attachments[]`, grouped by source resource (`source.resourceType` + `source.resourceId`)
- Attachments pre-extracted for text search
- Referenced resources (Practitioner, Organization) fetched and included

## Claude Skill Design

### Skill Structure

```
health-record-assistant/
├── SKILL.md              # Main instructions + API docs + JS examples
├── scripts/
│   ├── create-session.ts    # Create session with ECDH keypair
│   └── finalize-session.ts  # Poll, decrypt, save to files
└── references/
    └── FHIR-GUIDE.md     # LOINC codes, resource schemas
```

### Key Skill Capabilities

1. **Structured queries** - Find specific labs by LOINC code, filter active medications
2. **Text search** - Search clinical notes for keywords, symptoms, discussions
3. **Trend analysis** - Chart lab values over time, detect changes
4. **Care gap detection** - Check for overdue screenings, vaccines
5. **Plain language translation** - Explain medical terms to users

### Example Skill Usage

```javascript
// Find A1c trend
const a1c = data.fhir.Observation
  .filter(o => o.code?.coding?.some(c => c.code === '4548-4'))
  .sort((a,b) => new Date(b.effectiveDateTime) - new Date(a.effectiveDateTime))
  .map(o => ({date: o.effectiveDateTime, value: o.valueQuantity?.value}));

// Search notes for diabetes discussions
const notes = data.attachments
  .filter(a => a.bestEffortPlaintext?.toLowerCase().includes('diabetes'));
```

## Security Considerations

### End-to-End Encryption Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Claude    │     │   Server     │     │   Browser   │
│             │     │              │     │             │
│ 1. Generate │     │              │     │             │
│    ECDH     │     │              │     │             │
│    keypair  │     │              │     │             │
│             │     │              │     │             │
│ 2. POST     │────>│ 3. Store     │     │             │
│    publicKey│     │    publicKey │     │             │
│             │     │              │     │             │
│             │     │ 4. Serve     │────>│ 5. Fetch    │
│             │     │    page with │     │    FHIR     │
│             │     │    publicKey │     │    data     │
│             │     │              │     │             │
│             │     │              │     │ 6. Generate │
│             │     │              │     │    ephemeral│
│             │     │              │     │    keypair  │
│             │     │              │     │             │
│             │     │              │     │ 7. ECDH     │
│             │     │              │     │    derive   │
│             │     │              │     │    shared   │
│             │     │              │     │    secret   │
│             │     │              │     │             │
│             │     │              │<────│ 8. Encrypt  │
│             │     │ 9. Store     │     │    AES-GCM  │
│             │     │    ciphertext│     │    + send   │
│             │     │    (opaque)  │     │             │
│             │     │              │     │             │
│ 10. Poll    │<────│ 11. Return   │     │             │
│    receives │     │    encrypted │     │             │
│    blob     │     │    blob      │     │             │
│             │     │              │     │             │
│ 12. ECDH    │     │              │     │             │
│    derive   │     │              │     │             │
│    shared   │     │              │     │             │
│    secret   │     │              │     │             │
│             │     │              │     │             │
│ 13. Decrypt │     │              │     │             │
│    AES-GCM  │     │              │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Security properties:**
- **Confidentiality**: Server cannot decrypt health data
- **Forward secrecy**: Each provider uses ephemeral keys; compromising one doesn't reveal others
- **Authenticity**: AES-GCM provides authenticated encryption
- **No key escrow**: Private key exists only in Claude's execution environment

### Data Handling

- **In transit**: Always encrypted (TLS + E2E)
- **At rest on server**: Only ciphertext stored in SQLite
- **At rest in browser**: Plaintext temporarily in IndexedDB (user's device)
- **Retention**: Sessions auto-expire after 1 hour
- **No logging**: Plaintext health data never logged

### Authentication & Authorization

- **User auth**: Delegated to patient portal (Epic, etc.) via OAuth
- **Session auth**: Random 32-character hex session IDs (128 bits entropy)
- **No user accounts**: Stateless, session-based only
- **PKCE**: Protects OAuth flow from code interception attacks

## API Reference

### POST /api/session

Create a new session for health data retrieval.

**Request body (required):**
```json
{
  "publicKey": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "..."
  }
}
```

**Response:**
```json
{
  "sessionId": "d2d5a05d63f8ff899755d3da58a76522",
  "userUrl": "https://health-skillz.exe.xyz/connect/d2d5a05d...",
  "pollUrl": "https://health-skillz.exe.xyz/api/poll/d2d5a05d..."
}
```

### GET /api/session/:sessionId

Get session info for an existing AI session.

**Response:**
```json
{
  "sessionId": "d2d5a05d...",
  "publicKey": {"kty": "EC", "crv": "P-256", ...},
  "status": "pending",
  "providerCount": 0,
  "pendingChunks": {
    "abcd1234ef567890": {
      "receivedChunks": [0, 1, 2],
      "totalChunks": 10
    }
  }
}
```

### GET /api/poll/:sessionId

Check if health data is ready. Supports long-polling with `?timeout=N` (max 60s).

**Response (pending):**
```json
{
  "ready": false,
  "status": "collecting",
  "providerCount": 1
}
```

**Response (complete):**
```json
{
  "ready": true,
  "providerCount": 1,
  "providers": [
    {
      "providerIndex": 0,
      "version": 3,
      "totalChunks": 10,
      "chunks": [
        {
          "index": 0,
          "ephemeralPublicKey": {"kty": "EC", "crv": "P-256", ...},
          "iv": "base64..."
        }
      ]
    }
  ]
}
```

> **Note:** `GET /api/poll/:sessionId` returns chunk metadata only.
> Ciphertext bytes are fetched separately from `GET /api/chunks/:sessionId/:providerIndex/:chunkIndex`.

### POST /api/receive-ehr

Receive encrypted health data from the browser.

**Request body:**
```json
{
  "sessionId": "d2d5a05d...",
  "finalizeToken": "9d6a...uuid...",
  "version": 3,
  "totalChunks": 10,
  "providerKey": "abcd1234ef567890",
  "chunk": {
    "index": 0,
    "ephemeralPublicKey": {"kty": "EC", "crv": "P-256", ...},
    "iv": "base64...",
    "ciphertext": "base64..."
  }
}
```

> **Note:** Browser sends one chunk per request. `totalChunks: -1` is allowed for intermediate chunks when the final total is not known yet.

**Response:**
```json
{
  "success": true,
  "providerCount": 1,
  "redirectTo": "https://health-skillz.exe.xyz/connect/d2d5a05d...?provider_added=true"
}
```

### GET /api/chunks/:sessionId/meta

Return chunk metadata for finalized sessions (same shape as `poll.providers`).

### GET /api/chunks/:sessionId/:providerIndex/:chunkIndex

Return raw binary ciphertext for one chunk.

### POST /api/finalize/:sessionId

Finalize session after upload completes.

**Request body:**
```json
{"finalizeToken": "9d6a...uuid..."}
```

**Response:**
```json
{"success": true, "providerCount": 2}
```

## File Structure

```
health-skillz/
├── src/
│   ├── server.ts              # Bun HTTP server + API routes
│   ├── index.html             # HTML entry point for React SPA
│   └── client/
│       ├── App.tsx            # React Router configuration
│       ├── main.tsx           # React entry point
│       ├── index.css          # Styles
│       ├── pages/
│       │   ├── HomePage.tsx           # Skill download, documentation
│       │   ├── ConnectPage.tsx        # Session wrapper around RecordsPage
│       │   ├── ProviderSelectPage.tsx # Search and select healthcare provider
│       │   └── OAuthCallbackPage.tsx  # OAuth callback, FHIR fetch, save connection
│       ├── components/
│       │   ├── ProviderSearch.tsx     # Search input
│       │   ├── ProviderCard.tsx       # Provider display card
│       │   ├── ProviderList.tsx       # Connected providers list
│       │   └── StatusMessage.tsx      # Loading/error/success messages
│       ├── lib/
│       │   ├── api.ts                 # Server API client
│       │   ├── crypto.ts              # ECDH + AES-GCM encryption
│       │   ├── storage.ts             # sessionStorage + IndexedDB helpers
│       │   ├── smart/
│       │   │   ├── oauth.ts           # PKCE, authorization URL, token exchange
│       │   │   ├── client.ts          # FHIR resource fetching
│       │   │   └── attachments.ts     # Document text extraction
│       │   └── brands/
│       │       ├── types.ts           # Brand/provider type definitions
│       │       └── loader.ts          # Brand file loading and search
│       └── store/
│           └── records.ts             # Zustand state management
├── scripts/
│   ├── download-brands.ts    # Fetch Epic endpoint directory
│   └── package-skill.ts      # Create skill .zip for distribution
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md                   # Skill instructions for Claude
│       ├── scripts/
│       │   ├── create-session.ts      # Create session with ECDH keypair
│       │   └── finalize-session.ts    # Poll, decrypt, save to files
│       └── references/
│           └── FHIR-GUIDE.md          # LOINC codes, resource schemas
├── static/
│   └── brands/               # Epic endpoint directory JSON files
├── data/
│   └── health-skillz.db      # SQLite database (sessions, ciphertext)
├── config.json               # Server config + SMART client IDs
├── package.json
└── README.md
```

## Future Enhancements

### Enhanced UX
- Provider logos and branding
- Geolocation-based provider suggestions
- Remember recent providers (with user consent)

### Additional Data Sources
- Apple Health / Google Fit integration
- Wearable device data
- Patient-uploaded documents (PDF, images)

### Additional EHR Vendors
- Cerner/Oracle Health
- Athenahealth
- Other SMART on FHIR compliant systems
