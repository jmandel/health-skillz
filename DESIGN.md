# Health Skillz - Design Document

## Overview

Health Skillz is a **Claude Skill** that enables Claude to securely fetch and analyze a user's electronic health records (EHR) from their healthcare provider's patient portal using the **SMART on FHIR** standard.

## Goals

### Primary Goals

1. **Enable health data analysis in Claude** - Allow users to ask Claude questions about their personal health records without manually copying/pasting data

2. **Secure, standards-based access** - Use SMART on FHIR, the same OAuth-based standard that powers patient-facing health apps, ensuring proper authorization

3. **Rich analysis capabilities** - Provide Claude with both structured FHIR data (labs, meds, conditions) and unstructured clinical notes for comprehensive analysis

4. **Simple user experience** - One-click connection flow: user clicks a link, signs into their patient portal, done

### Non-Goals (for MVP)

- ~~End-to-end encryption~~ **Now implemented!**
- Long-term data storage (sessions expire after 1 hour)
- ~~Multi-provider aggregation~~ **Now implemented!**
- Direct EHR write-back

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLAUDE WEB UI                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Claude with Health Record Assistant Skill                          │   │
│  │  - Creates session via API                                          │   │
│  │  - Shows user connection link                                       │   │
│  │  - Polls until data ready                                           │   │
│  │  - Analyzes FHIR data with JavaScript                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │     1. POST /api/session    │
                    │     4. GET /api/poll/:id    │
                    ▼                             │
┌─────────────────────────────────────────────────┴───────────────────────────┐
│                        HEALTH-SKILLZ.EXE.XYZ                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Bun Server (src/server.ts)                                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │   │
│  │  │ /api/session│  │ /api/poll/* │  │ /api/data/* │                 │   │
│  │  │   (create)  │  │   (poll)    │  │  (receive)  │                 │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │   │
│  │         │                │                │                         │   │
│  │         └────────────────┼────────────────┘                         │   │
│  │                          ▼                                          │   │
│  │                 ┌─────────────────┐                                 │   │
│  │                 │  SQLite DB      │                                 │   │
│  │                 │  - sessions     │                                 │   │
│  │                 │  - health data  │                                 │   │
│  │                 └─────────────────┘                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  /connect/:id - Wrapper Page                                        │   │
│  │  - Opens EHR connector popup                                        │   │
│  │  - Receives data via postMessage                                    │   │
│  │  - POSTs data to /api/data/:id                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  /ehr-connect/* - EHR Connector (Static)                            │   │
│  │  - Provider selection UI                                            │   │
│  │  - SMART on FHIR OAuth flow                                         │   │
│  │  - FHIR data fetching                                               │   │
│  │  - Document text extraction                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  2. User clicks link        │
                    │  3. OAuth + Data fetch      │
                    ▼                             │
┌─────────────────────────────────────────────────┴───────────────────────────┐
│                         PATIENT PORTAL (e.g., Epic MyChart)                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SMART on FHIR Authorization Server                                 │   │
│  │  - User authentication                                              │   │
│  │  - Consent/authorization                                            │   │
│  │  - Access token issuance                                            │   │
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
│Claude │          │health-skillz│          │EHR Connector│          │Patient   │
│+ Skill│          │  Server    │          │  (popup)    │          │Portal    │
└───┬───┘          └─────┬──────┘          └──────┬──────┘          └────┬─────┘
    │                    │                        │                      │
    │ 1. POST /api/session                        │                      │
    │───────────────────>│                        │                      │
    │                    │                        │                      │
    │ {sessionId, userUrl, pollUrl}               │                      │
    │<───────────────────│                        │                      │
    │                    │                        │                      │
    │ 2. Show link to user                        │                      │
    │ "Click to connect: [userUrl]"               │                      │
    │                    │                        │                      │
    │                    │ 3. User clicks link    │                      │
    │                    │ GET /connect/:id       │                      │
    │                    │<───────────────────────│                      │
    │                    │                        │                      │
    │                    │ 4. Wrapper opens popup │                      │
    │                    │───────────────────────>│                      │
    │                    │                        │                      │
    │                    │                        │ 5. User selects      │
    │                    │                        │    provider          │
    │                    │                        │                      │
    │                    │                        │ 6. SMART OAuth       │
    │                    │                        │───────────────────────>
    │                    │                        │                      │
    │                    │                        │ 7. User logs in      │
    │                    │                        │    & authorizes      │
    │                    │                        │<──────────────────────
    │                    │                        │                      │
    │                    │                        │ 8. Fetch FHIR data   │
    │                    │                        │───────────────────────>
    │                    │                        │                      │
    │                    │                        │ {Patient, Conditions,│
    │                    │                        │  Meds, Labs, Notes}  │
    │                    │                        │<──────────────────────
    │                    │                        │                      │
    │                    │ 9. postMessage(data)   │                      │
    │                    │<───────────────────────│                      │
    │                    │                        │                      │
    │                    │ 10. POST /api/data/:id │                      │
    │                    │    (from wrapper page) │                      │
    │                    │                        │                      │
    │ 11. Poll /api/poll/:id                      │                      │
    │───────────────────>│                        │                      │
    │                    │                        │                      │
    │ {ready: true, data: {...}}                  │                      │
    │<───────────────────│                        │                      │
    │                    │                        │                      │
    │ 12. Analyze with JS                         │                      │
    │    (labs, meds, notes)                      │                      │
    │                    │                        │                      │
```

## Key Design Decisions

### 1. Popup + postMessage Pattern

**Why not direct redirect?**
- Claude needs to maintain context while user authenticates
- Popup allows polling to continue in background
- User can return to Claude tab when done

**Why postMessage?**
- Secure cross-origin communication
- No server-side session needed during OAuth flow
- Works with any SMART on FHIR endpoint

### 2. Session-Based Polling

**Why polling instead of webhooks?**
- Claude can't receive webhooks
- Simple implementation
- Works with Claude's execution model

**Session lifecycle:**
1. Created when Claude calls `/api/session`
2. Pending until data received
3. Complete when data POSTed from wrapper
4. Auto-deleted after 1 hour

### 3. EHR Connector from health-record-mcp

**Why reuse health-record-mcp?**
- Battle-tested SMART on FHIR implementation
- Handles complex OAuth flows
- Extracts text from PDFs, documents
- Supports Epic endpoint directory

**Build-time configuration:**
- Client IDs injected at build time
- Redirect URLs configured per-environment
- Brand files (endpoint directory) bundled

### 4. Data Structure

```typescript
interface ClientFullEHR {
  fhir: {
    Patient: Patient[];
    Condition: Condition[];
    MedicationRequest: MedicationRequest[];
    Observation: Observation[];  // Labs, vitals
    Procedure: Procedure[];
    Immunization: Immunization[];
    AllergyIntolerance: AllergyIntolerance[];
    Encounter: Encounter[];
    DocumentReference: DocumentReference[];
    DiagnosticReport: DiagnosticReport[];
    // ... other FHIR resources
  };
  attachments: {
    resourceType: string;
    resourceId: string;
    contentType: string;
    contentPlaintext: string;  // Extracted text from PDFs, notes
  }[];
}
```

**Why this structure?**
- Preserves full FHIR fidelity
- Attachments pre-extracted for easy text search
- Claude can use JavaScript to query both

## Claude Skill Design

### Skill Structure

```
health-record-assistant/
├── SKILL.md              # Main instructions + API docs + JS examples
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
  .filter(a => a.contentPlaintext?.toLowerCase().includes('diabetes'));
```

## Security Considerations

### End-to-End Encryption

Health data is end-to-end encrypted so the server never sees plaintext health records:

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
│             │     │              │<────│ 6. Encrypt  │
│             │     │ 7. Store     │     │    with     │
│             │     │    ciphertext│     │    ECDH+AES │
│             │     │    (opaque)  │     │             │
│             │     │              │     │             │
│ 8. Poll     │<────│ 9. Return    │     │             │
│    receives │     │    encrypted │     │             │
│    blob     │     │    blob      │     │             │
│             │     │              │     │             │
│ 10. Decrypt │     │              │     │             │
│     with    │     │              │     │             │
│     private │     │              │     │             │
│     key     │     │              │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
```

**Encryption details:**
- **Key exchange**: ECDH with P-256 curve
- **Encryption**: AES-256-GCM
- **Per-provider keys**: Each provider connection uses a fresh ephemeral keypair
- **Server sees**: Only encrypted ciphertext, ephemeral public key, IV
- **Server cannot**: Decrypt any health data

### Data Handling

- **Transit (encrypted mode)**: Ciphertext flows through server; plaintext never leaves browser/Claude
- **Transit (legacy mode)**: Data flows user browser → our server → Claude
- **Storage**: SQLite, auto-deleted after 1 hour
- **No persistence**: Health data not logged or retained

### Authentication

- **User auth**: Handled by patient portal (Epic, etc.)
- **Session auth**: Random 32-char hex session IDs
- **No user accounts**: Stateless, session-based only

## API Reference

### POST /api/session

Create a new session for health data retrieval.

**Request body (optional, for E2E encryption):**
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
  "pollUrl": "https://health-skillz.exe.xyz/api/poll/d2d5a05d...",
  "encrypted": true
}
```

### GET /api/poll/:sessionId

Check if health data is ready. Supports long-polling with `?timeout=N` (max 60s).

**Response (pending):**
```json
{
  "ready": false,
  "encrypted": true,
  "status": "collecting",
  "providerCount": 1,
  "providers": [{"name": "Epic Hospital", "connectedAt": "2024-01-15T10:30:00Z"}],
  "message": "Still waiting for user to connect and finalize. Keep polling."
}
```

**Response (complete, encrypted):**
```json
{
  "ready": true,
  "encrypted": true,
  "providerCount": 2,
  "encryptedProviders": [
    {
      "ephemeralPublicKey": {"kty": "EC", "crv": "P-256", ...},
      "iv": [1, 2, 3, ...],
      "ciphertext": [4, 5, 6, ...],
      "providerName": "Epic Hospital",
      "connectedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Response (complete, unencrypted/legacy):**
```json
{
  "ready": true,
  "encrypted": false,
  "data": {
    "fhir": {...},
    "attachments": [...]
  }
}
```

### POST /api/data/:sessionId

Receive health data from the EHR connector (called by wrapper page).

**Request body (encrypted):**
```json
{
  "encrypted": true,
  "ephemeralPublicKey": {"kty": "EC", "crv": "P-256", ...},
  "iv": [1, 2, 3, ...],
  "ciphertext": [4, 5, 6, ...],
  "providerName": "Epic Hospital"
}
```

**Request body (unencrypted/legacy):**
```json
{
  "fhir": {...},
  "attachments": [...]
}
```

**Response:**
```json
{"success": true, "providerCount": 1, "encrypted": true}
```

### POST /api/finalize/:sessionId

Mark session as complete (user is done adding providers).

**Response:**
```json
{"success": true, "providerCount": 2, "encrypted": true}
```

## File Structure

```
health-skillz/
├── src/
│   └── server.ts           # Bun HTTP server
├── scripts/
│   ├── download-brands.ts  # Fetch Epic endpoint directory
│   ├── build-connector.ts  # Build EHR connector
│   └── package-skill.ts    # Create skill .zip
├── templates/
│   ├── index.html          # Homepage
│   └── connect.html        # Wrapper page
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md
│       └── references/
│           └── FHIR-GUIDE.md
├── brands/                 # Processed endpoint data
├── static/
│   └── ehr-connect/        # Built EHR connector
├── config.json             # Server + SMART client config
├── package.json
└── README.md
```

## Future Roadmap

### Phase 2: Multi-Provider Support
- Connect to multiple patient portals in sequence
- Aggregate data before returning to Claude
- Cross-provider analysis

### Phase 3: End-to-End Encryption
- Claude generates ECDH keypair
- Data encrypted in user's browser
- Server only sees ciphertext

### Phase 4: Enhanced UX
- Provider logos and branding
- Geolocation-based provider suggestions  
- Remember recent providers

### Phase 5: Additional Data Sources
- Apple Health / Google Fit integration
- Wearable device data
- Patient-uploaded documents
