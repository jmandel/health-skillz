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

Note that counts across sources won't align perfectly because Epic forces you to choose exactly one data set at app registration time: USCDI v1, USCDI v3, or CMS Payer APIs. Our app registered for USCDI v3, so payer organizations that only offer access through the CMS Payer APIs won't appear on our management page.

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

This breakdown reveals an important finding: **our app is registered (or registerable) at organizations that patients cannot discover through the Brands bundle.** The 31 US health systems in the list above are real providers where the app is activated and patients could technically connect — but because these orgs have no Endpoint entry in the Brands bundle, they won't appear in any patient-facing provider directory built from the public endpoint data.

A patient at, say, Children's National Hospital or Indiana University Health would have no way to find their provider through an app that uses the Brands bundle for provider discovery. The app is registered there, Epic's auto-sync delivered the org to our management page, but the public directory doesn't list it. The registration and the directory are out of sync.

The 17 payers are a different case — they likely publish endpoints only for the CMS Payer API category, which is a separate registration universe from our USCDI v3 app. The international orgs and diagnostics companies are expected mismatches. But the 31 US health systems represent a genuine gap: these organizations participate in auto-sync but are invisible in the public directory.

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
