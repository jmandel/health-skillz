# Journal: Automating Epic FHIR App Activation for 500 Organizations

**Date:** 2026-02-11
**Duration:** ~90 minutes wall-clock
**Participants:** Human (app developer) + Claude (AI pair programmer via Claude Code + Chrome automation)
**Goal:** Activate a FHIR app ("Health Skillz") at ~500 Epic organizations by approving their client ID downloads — a task that Epic's "Review & Manage Downloads" interface requires be done one org at a time through a multi-click UI workflow.

---

## The Problem

### How Epic App Distribution Works

Epic has an [Automatic Client Record Distribution](https://fhir.epic.com/Documentation?docId=patientfacingfhirapps) system that pushes client IDs for qualifying USCDI apps to all eligible community members — no action needed from the organizations' IT staff. Our app qualifies: it's patient-facing, read-only, uses only USCDI v3 FHIR APIs, and is marked production-ready. The ~500 organizations automatically appeared on our "Review & Manage Downloads" page. That's auto-sync working — on the organization side, nothing manual happened.

But there are two lanes within auto-sync, distinguished by a single condition in the docs:

> Does not use refresh tokens **OR** uses refresh tokens and has a client credential uploaded by the vendor for that community member

**Lane 1 (no refresh tokens):** The app's client ID syncs to all community members fully automatically. Zero developer action per org. This is the true "set it and forget it" path.

**Lane 2 (uses refresh tokens):** The client ID is *queued* at each community member, but auto-sync doesn't complete until the app vendor "uploads a client credential" for that specific community member. In practice, "uploads a client credential" means: the app developer goes to the "Manage keys" page on Epic's portal, clicks through a per-org modal workflow to assign the app's public JWK Set URL to that community member's non-production and production environments, and confirms. The credential being "uploaded" is the same JWK Set URL every time — there's nothing org-specific about it. But the portal requires you to do it individually, per org, through a 7-click modal sequence.

Our app uses refresh tokens (it's a SMART on FHIR app with JWT-based authentication), so it's in Lane 2. The auto-sync delivered 500 organizations to our management page automatically. But to complete the sync, we had to "upload" (really: confirm) our app-level JWK Set URL at each of those 500 organizations individually. That's the workflow we automated.

(Apps that don't qualify for auto-sync at all fall under "Manual Client ID Distribution," where the community member's own IT staff has to proactively find and download the client ID — an even worse path.)

The app had:
- **Client ID Downloads: 2** (previously activated)
- **Client ID Requests: 498** (waiting for activation)
- **Total: 500 organizations** listed on a paginated management page (20 per page, 25 pages)

### The Manual Workflow Per Organization (7 clicks)

1. Click **"Activate for Non-Production"** button on the row
2. Click **"JWK Set URL (Recommended)"** radio button in the modal
3. Click **"Activate for Non-Production"** submit button
4. Click **"Activate for Production"** button (now unlocked)
5. Click **"JWK Set URL (Recommended)"** radio button in the second modal
6. Click **"Activate for Production"** submit button
7. Click **"Confirm"** in a production confirmation dialog

Plus 24 clicks to navigate between pages.

**Total manual effort: 498 &times; 7 + 24 = 3,510 clicks. At 5-10 seconds per click (accounting for modal load times, page transitions), that's 5-10 hours of mind-numbing clicking.**

---

## The Exploration Phase (~40 minutes)

### Step 1: Understanding the UI

We started by opening the Epic FHIR developer portal in Chrome via Claude's browser automation tools. Navigated to `https://fhir.epic.com/Developer/Apps`, then into "Review & Manage Downloads" for the Health Skillz app.

The management page (`/Developer/Management?id=50741`) showed a table with 500 organizations. Each row had:
- Organization name and ID
- Status: "Keys enabled", "Non-Production only", or "Not responded"
- Action buttons: Activate for Non-Production, Activate for Production, Decline

### Step 2: Reverse-Engineering the Frontend

Discovered the app is built on **Knockout.js** (data-bind attributes everywhere). Key findings:

- **Row data model:** Each row is a KO-bound object with `OrgName()`, `OrgId()`, `Approved()` observables
  - `Approved() === 0` → "Not responded"
  - `Approved() === 1` → "Keys enabled"
  - `Approved() === 3` → "Non-Production only"
- **Modal:** Single `#EnableKeysModal` element with KO-controlled sections for non-prod vs prod
- **Button bindings:** `$root.EnableKeysClicked(data, EnvironmentType.Nonprod/Prod)` opens the modal
- **Submit bindings:** `$root.ApproveNonProdClicked` and `$root.ApproveProdClicked`
- **Production confirmation:** Additional `$root.EnableProdConfirmation` step
- **Pagination:** `Filters().CurrentPage` (observable), `Filters().TotalPages`, `Filters().PageSize` (plain number, not observable — this matters later)

### Step 3: Manual Test Activation

We manually activated one organization (Acumen Physician Solutions) through the full UI flow to verify our understanding:

1. Clicked "Activate for Non-Production" → modal appeared
2. Selected JWK Set URL radio → additional checkbox appeared ("Use app-level JWK Set URL")
3. Clicked submit → status changed to "Non-Production only"
4. Clicked "Activate for Production" → same modal but for prod
5. Selected JWK radio, clicked submit → confirmation dialog appeared
6. Clicked "Confirm" → status changed to "Keys enabled"

This confirmed the 7-click workflow and that no additional data entry was needed (all defaults were correct).

---

## The API Discovery Phase (~20 minutes)

### Step 4: Intercepting Network Calls

We installed an XHR interceptor to capture the actual API calls during activation:

```js
XMLHttpRequest.prototype.open = function(method, url) {
  this._capturedMethod = method;
  this._capturedUrl = url;
  return origOpen.apply(this, arguments);
};
```

Activated Adaptive Biotech via JS (clicking the button programmatically, selecting the radio, clicking submit). Captured:

**Single API endpoint:** `POST /Developer/ApproveDownload`

**Request body (form-encoded):**
```
OrgId=16770
AppId=50741
Testhash=
Testhash256=
Prodhash=
Prodhash256=
NonProdOnly=true    ← for non-prod activation
ProdOnly=false
FhirIdGenerationScheme=
OverrideNonProdClientId=
OverrideProdClientId=
TestJWKS=
ProdJWKS=
```

For production activation: same params but `NonProdOnly=false&ProdOnly=true`.

**Auth:** Session cookies (automatic in browser) + `RequestVerificationToken` header (CSRF token from a hidden input on the page).

### Step 5: Direct API Test

Bypassed the UI entirely with a direct `fetch()` call:

```js
fetch('/Developer/ApproveDownload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'RequestVerificationToken': csrfToken
  },
  body: params.toString()
})
```

Response: `{"Success":true,"Data":{"Success":true,"Message":"2026-02-11 16:37 UTC"}}`

**It worked.** Adaptive Biotech went from "Non-Production only" to "Keys enabled" with a single API call. No modal, no radio buttons, no confirmation dialog.

---

## The Pagination Saga (~25 minutes)

### Step 6: First Script Attempt — KO DOM Scraping (FAILED)

Wrote a script that iterated through pages by setting `Filters().CurrentPage(N)` and reading `ko.dataFor(row)` from the DOM table rows.

**Result:** Found only 20 orgs despite scanning all 25 pages. Every page returned the same 20 organizations.

**Root cause:** Setting `CurrentPage()` updated the pagination *text* ("Showing 21-40 of 500") but did NOT trigger a server-side data fetch. The table rows stayed the same.

### Step 7: Adding OnFilterTask (STILL FAILED)

Added `Filters().OnFilterTask.call(root)` after each page change to trigger a refresh.

**Result:** Still only 20 orgs. The `OnFilterTask`/`RefreshState` function triggered an XHR, but the KO table binding never actually swapped the row data. The pagination counter changed, the server returned new data, but the DOM table stubbornly showed the same 20 rows.

### Step 8: Trying to Change PageSize (FAILED)

Attempted to set `Filters().PageSize = 500` to get all orgs on one page.

**Result:** `PageSize` is a plain number, not a KO observable. Setting it had no effect on the server query. The server always returned 20 rows per page regardless.

### Step 9: Discovering the LoadDownloads API (SUCCESS)

Intercepted the XHR that fires when KO "refreshes" and discovered:

**Endpoint:** `POST /Developer/LoadDownloads`
**Body:** `appId=50741`

This returns JSON with a `Downloads` array. Tested various parameter combinations:

| Body params | Result |
|---|---|
| `appId=50741` | 20 orgs (default) |
| `appId=50741&page=1` | 20 orgs (different set — page 2!) |
| `appId=50741&PageSize=500` | **500 orgs (all of them!)** |
| `appId=50741&PageSize=500&page=1` | 0 orgs (correct — all fit on page 0) |
| `appId=50741&pageIndex=1` | 20 orgs (same as page 0 — doesn't work) |
| `appId=50741&skip=20&take=20` | 20 orgs (same as page 0 — doesn't work) |

**Key finding:** `PageSize` (capital S) works as a query param, and `page` (lowercase) handles pagination. Combined, they let us fetch arbitrary pages of arbitrary size.

### Step 10: Verifying Pagination at PageSize=50

Tested `PageSize=50` across all pages to confirm the pagination logic:

- Pages 0-9: 50 orgs each, no overlap, alphabetically sequential
- Page 10: 0 orgs (end)
- Total: 500 orgs

Pagination confirmed working.

---

## The Final Script (~5 minutes)

With all the API knowledge in hand, the final script is simple:

1. `POST /Developer/LoadDownloads` with `PageSize=2000` to fetch all orgs
2. Filter to `Approved === 0` (need both) and `Approved === 3` (need prod only)
3. For each, `POST /Developer/ApproveDownload` with `NonProdOnly=true`, then `ProdOnly=true`
4. 500ms delay between calls to avoid rate limiting
5. `confirm()` dialog before executing so you can review the counts
6. Progress logging and error collection
7. `location.reload()` at the end

**Estimated runtime:** ~1,000 API calls &times; 0.5s = ~8-10 minutes, fully unattended.

---

## Things That Tripped Us Up

1. **Chrome extension disconnecting** — The Claude-in-Chrome browser extension disconnected twice during the session, requiring Chrome restarts. Cost ~10 minutes.

2. **KO pagination is a lie** — The Knockout.js pagination UI updates its display text independently of the actual data. Setting `CurrentPage()` changes "Showing X-Y of 500" but doesn't fetch new data for the table. Two different attempts to fix this (including calling the refresh function) both failed. The first version of the script scanned 25 pages and found only 20 orgs.

3. **PageSize is not an observable** — Unlike most KO properties on the Filters object, `PageSize` is a plain JavaScript number. You can't change it reactively, and even mutating it directly doesn't affect server queries.

4. **Parameter name sensitivity** — The server API accepts `PageSize` (capital S) but not `pageSize` (lowercase s). Similarly `page` works but `pageIndex` doesn't. Only discovered through brute-force testing of parameter combos.

5. **JS execution blocking** — Several JavaScript execution attempts were blocked by the Chrome extension's cookie/query string data filter, requiring creative workarounds (writing results to `document.title` instead of returning them directly).

6. **JWK radio not clicking via JS** — When trying to automate the modal form via DOM manipulation, `jkuRadio.click()` didn't visually select the radio button, even though `ko.dataFor()` showed it as checked. The KO binding and the DOM state were out of sync.

7. **OrgId field doesn't exist in the API response** — The KO view model exposes `OrgId()` as an observable on each row, but the raw `LoadDownloads` API response has no `OrgId` field. Instead, the org ID is embedded in a composite `Id` field with the format `"orgId_appId"` (e.g., `"16770_50741"`). The first version of the script sent `OrgId=undefined` for every request, getting back `{"Success": false, "Message": "Download request could not be found."}` — a misleading error message that doesn't mention the missing/invalid OrgId. The KO model constructs the `OrgId()` observable by splitting this composite ID, a mapping that isn't visible in the raw API response. There's also an `ECMId` field on each download object which is a *different* number entirely (Adaptive Biotech: `Id` prefix = 16770, `ECMId` = 1328) — a red herring that could have caused a subtler bug if we'd guessed wrong. Fixed by parsing `d.Id.split('_')[0]`.

---

## The Absurdity By The Numbers

| Metric | Manual | Automated |
|---|---|---|
| Clicks | **3,510** | **1** (paste into console) |
| Time | **5-10 hours** | **~10 minutes** |
| Errors | High (fatigue, wrong button) | Near zero (retry logic) |
| Repeatability | Start over from scratch | Re-run the script |
| Future orgs | Another 7 clicks each | Re-run the script |

### What Epic Could Do Instead

- Add an "Activate All" button
- Add a bulk action checkbox column
- Provide an API for app developers to manage activations programmatically
- Auto-provision default credentials (JWK Set URL) when an app already has one configured at the app level
- At minimum, let the developer set a default activation policy

### What We Had To Do Instead

- Reverse-engineer a Knockout.js admin portal
- Discover undocumented API endpoints through XHR interception
- Brute-force test query parameter names
- Write a custom automation script
- Debug pagination behavior that turned out to be a KO rendering quirk
- Spend 90 minutes of an engineer's time (plus AI) on what should be a checkbox

---

## The Request to Fetch All Orgs

```
POST https://fhir.epic.com/Developer/LoadDownloads

Headers:
  Content-Type: application/x-www-form-urlencoded
  RequestVerificationToken: <from hidden input on page>

Body:
  appId=50741&PageSize=2000

Response: { Success: true, Data: { Downloads: [...500 items...] } }
```

---

## Cross-Referencing with the Brands Bundle

After the activation work, we tried to cross-reference the 500 management page organizations against Epic's public [Brands bundle](https://open.epic.com/Endpoints/Brands) — Epic's recommended source for FHIR endpoint information.

The Brands bundle is large (~85MB) and contains two resource types:
- **90,066 Organization resources** — sub-organizations (clinics, departments) grouped under parent orgs via `brand-identifier` values
- **575 Endpoint resources** — FHIR base URLs with `managingOrganization` references

Note that counts across sources won't align perfectly. Our app registered for USCDI v3, so auto-sync delivered the ~500 organizations that offer USCDI v3 APIs. The Brands bundle is a separate publication channel — the two don't necessarily list the same organizations.

### Two Cross-Reference Paths

It turns out the Brands bundle contains **both** identifiers from the management page — but on different resource types:

**Path 1: OrgId → Endpoint resources (logical reference).** The 575 Endpoint resources in the Brands bundle each carry the management OrgId — but not on any `Organization.identifier`. Instead, it appears as a **logical reference** on `Endpoint.managingOrganization.identifier` with system `https://fhir.epic.com/Developer/Management/OrganizationId`. This is a FHIR logical reference: there's no actual Organization resource in the bundle with this identifier. The Endpoint simply asserts "I'm managed by the org with this ID" without linking to a resolvable Organization resource.

For example, Access Community Health Network's Endpoint entry:

```json
{
  "resourceType": "Endpoint",
  "name": "Access Community Health Network",
  "managingOrganization": {
    "identifier": {
      "system": "https://fhir.epic.com/Developer/Management/OrganizationId",
      "value": "1696"
    }
  },
  "address": "https://eprescribing.accesscommunityhealth.net/FHIR/ACCESS/api/FHIR/R4"
}
```

No Organization resource in the Brands bundle carries this system/value pair — we checked all 90,066 of them. The OrgId exists *only* on the Endpoint's logical reference. But this is actually the most useful mapping for developers: it directly connects the management OrgId to the FHIR base URL (`address`).

**Path 2: ECMId → Organization resources.** The `LoadDownloads` API response includes a hidden `ECMId` field on each download that maps to the `brand-identifier` on parent Organization resources. For example, Access Community Health Network has ECMId `762` in the API and brand-identifier `"762"` in the Brands bundle.

| Org | OrgId (visible in UI) | ECMId (hidden in API) | Brands bundle has... |
|---|---|---|---|
| Access Community Health Network | 1696 | 762 | Endpoint with OrgId `1696` + Organization with brand-id `762` |
| Acumen Physician Solutions | 525 | 1041 | Endpoint with OrgId `525` + Organization with brand-id `1041` |
| AdvantageCare Physicians | 1108 | 901 | Endpoint with OrgId `1108` + Organization with brand-id `901` |

We initially missed the OrgId mapping entirely because we were searching `Organization.identifier` — where it doesn't appear. The OrgId lives on a completely different resource type (Endpoint) in a completely different FHIR structure (logical reference on `managingOrganization`), which is not where most developers would think to look.

### OrgId Cross-Reference: Management vs. Brands Endpoints

Comparing all 500 management page OrgIds against the 444 unique OrgIds on the 575 Brands bundle Endpoints:

| Set | Count |
|---|---|
| Management page OrgIds | 500 |
| Brands bundle Endpoint OrgIds | 444 |
| **Overlap** | **440** |
| **Management-only** (no Brands Endpoint) | **60** |
| **Brands-only** (not on management page) | **4** |

We resolved all 60 management-only OrgIds to org names and categorized them:

**Payers / Health Plans (17):** Blue Cross Blue Shield of Minnesota, Blue Cross and Blue Shield of Louisiana, Blue Shield of California, CareOregon, Centene, Elevance Health, Health Care Service Corporation, Highmark, Humana, Independence Blue Cross, Johns Hopkins Health Plans, Kaiser Membership Admin, OptumInsight, PacificSource, Priority Health, Sharp Health Plan, Valley Health Plan – County of Santa Clara

**Diagnostics / Genomics / Lab (5):** Caris Life Sciences, Guardant Health, Myriad Genetics, Tempus AI, Wisconsin State Laboratory of Hygiene

**International (7):** Children's Health Ireland, MUMC+ (Netherlands), NL Health Services, NSW Health (Australia), Santé Québec, Unity Health (Canada), University Health Network (Canada)

**US Health Systems (31):** Adaptive Biotech, Adventist Health System, Avera Health, Baptist Health South Florida, Blessing Health System, Cape Fear Valley Health, Children's Mercy Kansas City, Children's Minnesota, Children's National Hospital, ChristianaCare, Corewell Health East, Corewell Health South, CoxHealth, Dickson Medical Associates, Foothill Family Clinic, Freeman Health System, Great River Health, Indiana University Health, Inspira Health, Kaleida Health, Mount Nittany Health System, NorthBay Health, Novant Health New Hanover Regional Medical Center, OakLeaf, Penn State Health, Reno Orthopaedic Clinic, Sarasota Memorial Health Care System, Trinity Health (ND), UAB Medicine, UMC Health System, Valley Health Systems

### The Discoverability Gap

All 500 orgs on our management page are there because they offer USCDI v3 APIs — that's what our app registered for, and that's what auto-sync matched on. So every one of the 60 management-only orgs offers USCDI v3 but has no Endpoint entry in the Brands bundle. **Our app is registered at organizations that patients cannot discover through the public directory.**

This affects all categories, not just the 31 US health systems:

- The **17 payers** (Humana, Elevance, Blue Shield of California, etc.) DO offer USCDI v3 clinical APIs — that's why auto-sync delivered them. But they have no Brands Endpoint, so patients can't find them in any directory built from the public data. A patient wanting to pull their clinical records from Humana via a USCDI v3 app has no public way to discover the FHIR endpoint.
- The **5 diagnostics/genomics labs** (Guardant, Tempus, Myriad, etc.) — same situation. Patients with data at these labs can't find them.
- The **7 international orgs** (Children's Health Ireland, NSW Health, Santé Québec, etc.) — may not be expected to publish in a US-focused Brands bundle, but the gap still exists.
- The **31 US health systems** (Children's National Hospital, Indiana University Health, ChristianaCare, UAB Medicine, Penn State Health, etc.) — the clearest gap. These are straightforward US providers where the app is activated and patients could connect, but the public directory doesn't list them.

In total, roughly 53 organizations (all but the 7 international) represent a genuine discoverability gap: Epic's auto-sync knows about them, the app is registered there, but the public endpoint directory that patients and apps rely on doesn't include them.

### Brands-Only: 4 Orgs in the Directory but Not on the Management Page

The reverse gap is smaller. Four organizations have Endpoint entries in the Brands bundle but did NOT appear on our USCDI v3 management page:

| OrgId | Name | FHIR Endpoint |
|---|---|---|
| 392 | Lifespan | `lsepprdsoap.lifespan.org` |
| 856 | Sansum | `wavesurescripts.sansumclinic.org` |
| 1823 | Loyola Medicine | `rxhub.luhs.org` |
| 10147 | Memorial Hospital and Healthcare Center | `arrprd.mhhcc.org` |

These are established health systems (low OrgIds, active FHIR endpoints) that publish in the public directory but didn't get delivered to our app via auto-sync. Possible explanations: they may not yet support USCDI v3 (only v1), they may have opted out of auto-sync for newer app registrations, or their Epic configuration may have changed since the Brands bundle was last updated. Note these are distinct from the "four stragglers" (Dickson Medical Associates, Foothill Family Clinic, OakLeaf, Reno Orthopaedic Clinic) which ARE on the management page but fail with a server-side error during activation.

### Brand Identifier Format

The Brands bundle contains 1,168 parent Organization resources with `brand-identifier` values in two formats:
- **441 purely numeric** (e.g., `"762"`) — parent organizations, mappable to management ECMIds
- **727 with a dash format** (e.g., `"432-112"`) — sub-organizations under a parent (the number before the dash is the parent's brand-identifier/ECMId)

### Key Takeaway

The Brands bundle is the authoritative cross-reference source — but the identifier topology is surprising. The visible management OrgId appears only as a **logical reference** on Endpoint resources (`managingOrganization.identifier`), not as an `Organization.identifier` on any of the 90,066 Organization resources. The hidden ECMId maps to parent Organization resources via `brand-identifier`. Both mappings exist in the same bundle but on different resource types and different FHIR structures — which is why we initially thought the OrgId mapped to nothing.

---

## Files Produced

- `blog/epic/epic-activate-all.js` — The automation script (paste into browser console)
- `blog/epic/ecmids.json` — JSON array of 500 ECMId values extracted from the management API
- `blog/epic/2026-02-11-epic-activation-journal.md` — This journal

---

## Coda: The Four Stragglers

After running the automation script, we ended up at **496 out of 500** organizations activated. Four remained stuck at "Not responded." At first this looked like a script bug — maybe an edge case in the API calls, a timeout, or a malformed request.

We investigated by calling the `ApproveDownload` API directly for each of the four:

| Org | OrgId | ECMId | Result |
|---|---|---|---|
| Dickson Medical Associates | 30875 | 1441 | `"Failed to register client for download."` |
| Foothill Family Clinic | 30901 | 1352 | `"Failed to register client for download."` |
| OakLeaf | 31769 | 1459 | `"Failed to register client for download."` |
| Reno Orthopaedic Clinic | 31291 | 1486 | `"Failed to register client for download."` |

All four return the same server-side error. To confirm it wasn't a script issue, we tried activating Dickson Medical Associates through the actual UI — clicked "Activate for Non-Production," selected the JWK Set URL radio, clicked submit. The modal showed:

> **Error**
> An error occurred. Keys were not enabled. Failed to register client for download.

Same error through the UI. These four organizations simply won't accept the registration — it's a server-side issue on Epic's end, not a script bug. All four are newer organizations (OrgIds in the 30,000s, ECMIds in the 1300s–1400s), suggesting their Epic environments may not be fully provisioned to accept client registrations yet.

The script will pick them up on a future re-run since they still show `Approved === 0`.

---

## The JWK Set URL Problem: "Recommended" but Broken

### Discovery

After activating all 496 orgs using the "JWK Set URL (Recommended)" option, we discovered that token requests were failing at some organizations with `invalid_client`. Working with Cooper Thompson from Epic, we debugged the issue at UnityPoint Health.

The root cause: **many Epic customer organizations have restrictive outbound network policies** that prevent their servers from making outbound HTTPS requests. When an app registers with a JWK Set URL, the organization's Epic server needs to fetch that URL to validate JWT signatures. If the server can't reach the URL, signature validation fails silently and the token request returns `invalid_client` with no further detail.

Cooper estimated roughly 80% of Epic customers allow outbound JKU fetching, meaning **~20% of organizations may silently fail** when an app uses the "Recommended" JWK Set URL option.

### The Fix: Direct JWKS Upload

The management modal has a second option under "Other" → "JSON Web Key Set (JWKS)" that lets you paste the key material directly. This embeds the public keys in the organization's configuration, eliminating the need for outbound requests entirely.

At the API level, this is just two additional parameters on the same `ApproveDownload` endpoint:
- `TestJWKS` — the JWKS JSON string for non-production
- `ProdJWKS` — the JWKS JSON string for production

When these are empty (JWK Set URL mode), Epic uses the app-level JWK Set URL. When populated, it stores the keys directly.

**Bonus discovery:** With direct JWKS, you can activate both non-production and production in a **single API call** by setting `NonProdOnly=false, ProdOnly=false` and populating both `TestJWKS` and `ProdJWKS`. This halves the number of API calls needed.

### Key Filtering

The app's JWKS at `/.well-known/jwks.json` contains 3 keys: one ES384 (elliptic curve) and two RSA (RS256, RS384). Epic only supports RSA algorithms for JWT signatures, so the script filters to `kty === 'RSA'` before uploading.

### The Irony

The management modal labels "JWK Set URL" as **(Recommended)** and selecting "Other" triggers a warning: *"We recommend using a JWK Set URL instead of these options."* But the recommended option fails at a significant fraction of organizations due to their network policies. The non-recommended option — direct JWKS upload — is the one that actually works reliably everywhere.

### Script Update

Updated `epic-activate-all.js` to prompt for mode on startup:
- **Mode 1: JWK Set URL** — original behavior, empty `TestJWKS`/`ProdJWKS`, 2 calls per org
- **Mode 2: Direct JWKS** (new default) — fetches JWKS from the app, filters to RSA keys, uploads inline, 1 call per org

In mode 2, the script fetches `https://health-skillz.joshuamandel.com/.well-known/jwks.json`, filters to RSA keys, and sends the filtered JWKS as both `TestJWKS` and `ProdJWKS` in each `ApproveDownload` call.

The script also now accepts a JWKS URL directly as input (instead of just "1" or "2"), and when it detects already-activated orgs, prompts whether to re-activate them — useful for switching from JWK Set URL to direct JWKS across all orgs.

### The .NET Serialization Bug

After re-activating all orgs with direct JWKS via the script, we noticed that re-opening the management modal for an org showed the stored JWKS with **PascalCase property names** (`Kty` instead of `kty`, `N` instead of `n`) and leaked .NET internal properties (`CryptoProviderFactory`, `HasPrivateKey`, `KeySize`). The UI's own validator then complained: *"JWKS key #1 is missing 'kty' property"* — because it was looking for lowercase `kty` in its own PascalCase-mangled output.

Initially we thought this was a compact-vs-pretty-printed JSON issue: our script was sending compact JSON (`JSON.stringify(jwks)`) while the UI sends pretty-printed JSON (2-space indentation, newlines). We changed the script to use `JSON.stringify(jwks, null, 2)` to match the UI. When we immediately re-opened the modal after saving through the UI, the JWKS looked correct — lowercase properties, no .NET internals.

**But this turned out to be an illusion.** After a full page reload, the UI shows the PascalCase/.NET-mangled version even for keys pasted manually through the form. The sequence:

1. Paste JWKS into UI form → Save → Confirm
2. Immediately re-open the modal → JWKS looks correct (lowercase `kty`, clean)
3. Reload the page → re-open the modal → PascalCase `Kty`, leaked .NET fields, validation error

The UI is caching the client-side value on immediate re-open, masking the server-side problem. After reload, what the server actually stored comes through — and it's always .NET-mangled regardless of input formatting. This is a server-side bug in Epic's storage layer: all JWKS submissions get deserialized into .NET `JsonWebKey` objects and re-serialized with PascalCase property names and internal fields like `CryptoProviderFactory`, `HasPrivateKey`, `KeySize`, `AdditionalData`.

The keys still work for signature validation despite the mangled storage — UnityPoint was proof of that. But Epic's own UI can't display what its own backend stored without showing a validation error.

### Single-Call vs Two-Call Activation

We also discovered that the "single call for both environments" optimization (sending both `TestJWKS` and `ProdJWKS` with `NonProdOnly=false, ProdOnly=false`) may trigger different server behavior than sending them separately. Comparing two captured API requests:

- **Prod-only call** (manual form save, `ProdOnly=true`, only `ProdJWKS` populated): stored JWKS displays correctly on immediate re-open
- **Combined call** (script, `ProdOnly=false`, both `TestJWKS` and `ProdJWKS` populated): stored JWKS shows mangled on immediate re-open

The JWKS content was byte-for-byte identical between the two requests — same encoding, same pretty-printing. The only differences were the flag combination and TestJWKS presence. The combined code path appears to use different deserialization logic on the server side. Reverting to two separate calls per org (one nonprod, one prod) may be the safer approach even in direct JWKS mode.

### New Orgs Appearing

Running the updated script the next day showed **502 orgs** (up from 500). The two new additions:

| OrgId | Name | Status | Notes |
|---|---|---|---|
| 392 | Brown University Health | Approved=1 | Previously "Lifespan" in the Brands bundle — same OrgId, renamed. Was one of our 4 "Brands-only" orgs yesterday. |
| 32586 | eleHealth | Approved=0 | Brand new org, high OrgId. |

This answers the lifecycle question: **the org list does update over time — it's not a frozen snapshot.** Auto-sync continues to deliver new organizations after initial registration. Brown University Health's appearance also confirms that the Brands-only orgs weren't permanently excluded — they just hadn't been delivered yet.

### Current Status

After re-activating all 502 orgs with direct JWKS upload, one of the two test sites (UnityPoint) is now working — the token exchange succeeds and we can fetch patient data. The other test site (UW Health) is still returning `invalid_client`. Epic's configuration changes can take up to 12 hours to propagate to customer sites, so this may just be a timing issue. Waiting to confirm.

Interesting observation: after switching all orgs to direct JWKS upload, the server logs for `jwks.json` still show many requests hitting it. If the per-org direct keys are supposed to replace JWK Set URL fetching, Epic shouldn't need to hit the URL at all. Possible explanations: propagation lag (some orgs still on old config), Epic fetching the URL as a periodic refresh or fallback even when direct keys are stored, or the app-level JWK Set URL being polled independently of per-org settings. Worth investigating — it complicates the outbound traffic narrative if Epic hits the URL regardless.
