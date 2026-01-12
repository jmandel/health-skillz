# Plan: Native EHR Retrieval (Replace health-record-mcp)

## Current Architecture

```
ConnectPage → opens popup → /ehr-connect/ehretriever.html
                                    ↓
                            Brand search UI
                                    ↓
                            SMART OAuth (redirect to EHR)
                                    ↓
                            Fetch FHIR data
                                    ↓
                            Our patched bundle encrypts
                                    ↓
                            POST to /api/receive-ehr
```

Problems:
- External dependency (health-record-mcp clone)
- Bundle patching is fragile
- Popup + postMessage adds complexity
- Hard to debug encryption issues
- ehretriever.ts is 65K lines with features we don't use

## New Architecture

```
ConnectPage → click → /connect/:id/select
                            ↓
                    React provider search
                            ↓
                    Build auth URL, redirect to EHR
                            ↓
/connect/:id/callback?code=...
                            ↓
                    Exchange code for token (React)
                            ↓
                    Fetch FHIR data with progress
                            ↓
                    Encrypt with stored publicKey
                            ↓
                    POST to /api/receive-ehr
                            ↓
                    Redirect to /connect/:id?success=true
```

Benefits:
- Single React codebase
- No external dependencies
- Direct redirect (no popup)
- Progress visible in React UI
- TypeScript throughout
- Easier debugging

## Implementation Phases

### Phase 1: Provider Search UI (4h)

**Files:**
```
web/src/pages/ProviderSelectPage.tsx
web/src/components/ProviderSearch.tsx
web/src/components/ProviderCard.tsx
web/src/lib/brands/loader.ts
web/src/lib/brands/types.ts
```

**Route:** `/connect/:sessionId/select`

**Features:**
- Load brand JSON with progress indicator
- Debounced search (300ms)
- Virtual scrolling for large lists (50K+ items in prod)
- Show matched count / total
- Click card → show confirm modal → redirect to OAuth

**Brand data format (existing):**
```typescript
interface BrandItem {
  id: string;
  displayName: string;
  brandName: string;
  city?: string;
  state?: string;
  itemType: 'brand' | 'facility';
  endpoints: { url: string; name: string }[];
  searchName: string;  // lowercase for fast search
}
```

### Phase 2: SMART OAuth (3h)

**Files:**
```
web/src/lib/smart/oauth.ts
web/src/lib/smart/types.ts
web/src/lib/storage.ts (enhance)
```

**OAuth flow:**
1. Fetch `.well-known/smart-configuration` from FHIR endpoint
2. Generate PKCE (code_verifier, code_challenge)
3. Build authorization URL with:
   - client_id (from config, per vendor)
   - redirect_uri: `{origin}/connect/{sessionId}/callback`
   - scope: `launch/patient patient/*.rs openid fhirUser`
   - state: random string
   - code_challenge + code_challenge_method
4. Save to sessionStorage: verifier, state, token_endpoint, fhir_base
5. Redirect to auth URL

**Config injection:** Server already serves session info with publicKey.
We'll add vendor config lookup based on FHIR endpoint domain.

### Phase 3: Token Exchange & FHIR Client (5h)

**Files:**
```
web/src/pages/OAuthCallbackPage.tsx
web/src/lib/smart/client.ts
web/src/lib/smart/resources.ts
web/src/store/session.ts (enhance with fetch progress)
```

**Callback page flow:**
1. Parse `code` and `state` from URL
2. Validate state matches stored state
3. Exchange code for access_token via token_endpoint
4. Extract patient ID from token response
5. Fetch FHIR resources with progress
6. Encrypt and POST
7. Redirect to ConnectPage

**FHIR fetching strategy:**
```typescript
const RESOURCE_QUERIES = [
  { resourceType: 'Patient' },
  { resourceType: 'Observation', params: { category: 'laboratory' } },
  { resourceType: 'Observation', params: { category: 'vital-signs' } },
  { resourceType: 'Condition' },
  { resourceType: 'MedicationRequest' },
  { resourceType: 'AllergyIntolerance' },
  { resourceType: 'Immunization' },
  { resourceType: 'Procedure' },
  { resourceType: 'DiagnosticReport' },
  { resourceType: 'DocumentReference' },
  { resourceType: 'Encounter' },
  // ... more as needed
];
```

**Pagination:** Follow Bundle.link[rel="next"] until exhausted.

**Concurrency:** Max 5 parallel requests.

**Progress:** Track completed/total queries, show in UI.

### Phase 4: Attachment Extraction (3h)

**Files:**
```
web/src/lib/smart/attachments.ts
```

**Strategy:**
1. Find DocumentReference resources with `content[].attachment`
2. For each attachment with supported contentType:
   - `text/plain`: fetch directly
   - `text/html`: fetch and strip tags
   - `application/pdf`: fetch, base64 encode, include raw (defer parsing)
   - `application/xml`, `text/xml`: fetch and extract text
3. Skip attachments > 10MB
4. Include extracted text in `attachments[]` array

**Note:** Full PDF text extraction would need server-side help or pdf.js.
For MVP, include raw PDF bytes so Claude's skill can potentially handle them.

### Phase 5: Integration (2h)

**Files:**
```
web/src/App.tsx (add routes)
web/src/pages/ConnectPage.tsx (enhance)
web/src/store/session.ts (add progress states)
```

**New routes:**
```tsx
<Route path="/connect/:sessionId/select" element={<ProviderSelectPage />} />
<Route path="/connect/:sessionId/callback" element={<OAuthCallbackPage />} />
```

**ConnectPage changes:**
- "Connect" button → navigate to `/select` instead of popup
- Show fetch progress when returning from callback
- Handle `?success=true` query param

**Session store additions:**
```typescript
interface SessionState {
  // ... existing
  fetchProgress: {
    phase: 'idle' | 'token' | 'fetching' | 'encrypting' | 'sending';
    completed: number;
    total: number;
    currentResource?: string;
  };
}
```

### Phase 6: Cleanup (1h)

**Remove:**
- `scripts/build-connector.ts`
- `static/ehr-connect/` (except brands/)
- health-record-mcp clone step from setup
- Template fallbacks in server.ts

**Keep:**
- `brands/` directory with processed JSON
- `scripts/download-brands.ts`

**Update:**
- `package.json` scripts
- `README.md`
- Server routes (remove /ehr-connect/* except brands)

## Vendor Configuration

Current config.json has brand-level client IDs:
```json
{
  "brands": [
    {
      "name": "epic-sandbox",
      "file": "./brands/epic-sandbox.json",
      "clientId": "...",
      "scopes": "patient/*.rs"
    }
  ]
}
```

We need to make this available to the frontend.

**Option A:** Embed in session response (server knows which brands are configured)
**Option B:** New endpoint `/api/config/brands` returns available vendors
**Option C:** Build-time injection into React app

**Recommendation:** Option A - extend `/api/session/:id` response:
```json
{
  "sessionId": "...",
  "publicKey": {...},
  "vendors": {
    "epic": {
      "clientId": "abc123",
      "scopes": "patient/*.rs",
      "brandFile": "/static/ehr-connect/brands/epic-prod.json"
    }
  }
}
```

## Risk Mitigation

1. **Large brand files (45MB+):**
   - Stream parse or use web worker
   - Show loading progress
   - Consider server-side search API for prod

2. **FHIR pagination edge cases:**
   - Set reasonable limits (max 1000 resources per type)
   - Timeout individual requests (30s)
   - Graceful degradation on errors

3. **Vendor differences:**
   - Epic is our main target, test thoroughly
   - Abstract vendor-specific quirks in client.ts

4. **Attachment size:**
   - Skip > 10MB
   - Warn user if many attachments skipped

## Testing Plan

1. **Epic Sandbox:**
   - User: fhircamila / epicepic1
   - Full flow from search → OAuth → fetch → encrypt → poll

2. **Error cases:**
   - Network failure during fetch
   - Token expiration
   - Invalid session
   - User cancels OAuth

3. **Performance:**
   - Large brand file loading time
   - Many resources (hundreds of observations)
   - Multiple providers

## Estimated Timeline

| Phase | Description | Hours |
|-------|-------------|-------|
| 1 | Provider Search UI | 4 |
| 2 | SMART OAuth | 3 |
| 3 | Token + FHIR Client | 5 |
| 4 | Attachments | 3 |
| 5 | Integration | 2 |
| 6 | Cleanup | 1 |
| **Total** | | **18** |

## Decision: Start with Phase 1?

The plan is incremental. Each phase produces working code.
Phase 1 can be tested standalone (just renders UI, button is no-op).
Phase 2-3 are the core and most complex.
Phase 4 can be simplified if needed.

**Recommendation:** Yes, start Phase 1. Build the provider search UI.
This gives immediate visual progress and validates the brand loading approach.
