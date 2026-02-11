# Your Health Records, Your Browser, Your Choice

*How we rebuilt Health Skillz around a simple idea: patients should own their health data, not rent access to it.*

---

Every major US hospital now has a live FHIR API. 90,000+ endpoints, mandated by the 21st Century Cures Act. The infrastructure for patient-controlled health data is built. Almost nobody has bothered to use it.

Health Skillz is a web app that does. You connect to your patient portal, pull your records into your browser, and share them — with an AI, as a download, however you want. The server never sees your health data.

We recently rebuilt the entire user experience around a core insight: **connections are the product, sessions are envelopes.** This post is about what changed and why it matters.

---

## The Old Model: Data as a One-Shot Pipe

The original design treated the app as a conduit. An AI creates a session, gives you a link. You sign into your portal, data flows through, gets encrypted, gets uploaded. Done. The pipe closes.

This worked, but it had a problem: your data was ephemeral. Each session was a one-shot transfer. Want to share with a different AI conversation tomorrow? Log in again. Wait for the fetch again. Hope the upload works again.

The app had separate code paths for "share with AI" and "download for yourself" — two implementations of the same action (connect to a health system). Seven page components. 616 lines in ConnectPage alone, handling session init, provider display, encrypted upload, error recovery, and cleanup all in one monster component.

## The New Model: A Personal Health Data Wallet

The rebuild flipped the mental model. Your browser's IndexedDB is now a **health data wallet**. You connect to a health system once. The app fetches your FHIR resources — labs, meds, conditions, clinical notes, everything — and saves them locally. That connection persists.

Now you have options:

- **Share with an AI** — When Claude (or any AI with the Health Record Assistant skill) creates a session and sends you a link, your connections are already there. Select which ones to share, click send. Data is encrypted in your browser with ECDH + AES-256-GCM, uploaded, decrypted only by the AI. Takes seconds instead of minutes.
- **Share again later** — Different AI conversation next week? Same data, already cached. Click send.
- **Keep it fresh** — Hit "Refresh" on any connection to pull the latest records using your stored refresh token. New labs? Updated in seconds, no re-authorization.
- **Download it** — Export as an AI skill zip with your records bundled in. Give it to any AI tool, no network needed.
- **Delete it** — Remove a connection and all its data is immediately purged from IndexedDB. No server-side backup to worry about.

One store, one page, two modes. `RecordsPage` renders the same UI whether you're managing records solo or sharing with an AI. The session context just adds a "Send N records to AI" button. ConnectPage shrunk from 616 lines to 60.

## What Gets Pulled

The FHIR fetch is comprehensive. The client fires 40+ parallel search queries across 20+ resource types:

- **Conditions** — active problems, encounter diagnoses, health concerns
- **Observations** — labs (with LOINC codes and reference ranges), vitals, social history, screenings
- **Medications** — active prescriptions with dosage
- **Encounters** — visit history with dates and reasons
- **Clinical notes** — the real gold. Visit notes, discharge summaries, operative reports, consultation notes. Full text, extracted from DocumentReference attachments.
- **Plus**: procedures, immunizations, allergies, care teams, insurance, goals, family history, devices, and more

After fetching patient resources, the client walks every reference and resolves linked Practitioners, Organizations, Locations, and Medications — so the data is self-contained. Then it extracts and processes clinical document attachments, converting HTML to plaintext and handling various content types.

The result: a comprehensive, structured health record with the clinical narrative intact. Exactly what an AI needs to provide useful analysis.

## Multi-Provider, One View

Patients don't get care from one place. You see a PCP at one system, a specialist at another, get labs at a third.

Each connection in Health Skillz is independent — its own FHIR server, patient ID, refresh token, and cached data. Connect Epic at one hospital, Epic at another, eventually Cerner too. See them all on one page with patient name, DOB, data size, and freshness. Select any subset to share.

The data stays separate per provider — no lossy merging. When sent to an AI, each provider becomes its own JSON file. The AI can reason across all of them while knowing exactly where each piece of data came from.

## The Security Model: Server Can't Read Your Data

This is non-negotiable for health data. The server is a blind relay.

1. **AI generates an ECDH key pair**, publishes the public key in the session
2. **Your browser generates an ephemeral key pair** for each encryption
3. **Shared secret derived via ECDH** — browser's ephemeral private key + AI's public key
4. **Data compressed (gzip) and encrypted (AES-256-GCM)** entirely in the browser
5. **Ciphertext uploaded** — the server stores an opaque blob it cannot decrypt
6. **AI decrypts** using its private key + the ephemeral public key from the upload

For large records (>5MB), the system uses streaming encryption — JSON → gzip → 5MB chunks → each chunk gets its own ephemeral key → uploaded separately. Memory stays bounded regardless of dataset size.

The FHIR data itself is fetched directly from the EHR to your browser. SMART on FHIR is a client-side protocol. The server never touches unencrypted health data at any point in the flow.

## The State Management Story

The UX improvements required getting the state management right. We ran a formal audit of every page, component, store, and lib — tracking which state lived where, what was duplicated, and what could flicker.

The findings:

- **A dead Zustand store** (`session.ts`) with zero runtime imports — pure zombie code from an earlier architecture
- **Split-brain status** in the OAuth callback page — local `useState` duplicated the store's status, merged with `||`, causing stale text to flash between state transitions
- **Double-load race** — two components independently calling `loadConnections()`, potentially thrashing IndexedDB
- **Wrong source of truth** — one page reading a public key from `localStorage` instead of the Zustand store
- **215 lines of persistence code** touching localStorage, sessionStorage, and IndexedDB — most of it dead

After cleanup:

- **localStorage**: nothing
- **sessionStorage**: only transient OAuth state (written before redirect, deleted after callback)
- **IndexedDB**: health data wallet (connections + cached FHIR data)
- **Zustand**: two in-memory stores — `records` (source of truth for connections and session) and `brands` (cached provider directory)

The persistence layer went from 215 lines to 35. The dead store was deleted. The split-brain was eliminated. Net result: -503 lines across the state management changes.

## What This Enables for Patients

The practical difference is significant:

**Before**: Each AI conversation required a full re-authorization with your health system. OAuth login, wait for FHIR fetch, wait for encrypted upload. If something failed on the upload, you might have to start over.

**After**: Authorize once, share many times. Your data is cached locally, ready to encrypt-and-send in seconds. Refresh when you need updated records. Download when you want a local copy. Delete when you're done.

The connection cards show real information: patient name and DOB (not opaque IDs), provider name, data size ("2.3 MB"), freshness ("12m ago"), and a status dot (green = active, red = token expired). You know whose data this is, how much there is, and whether it's current.

When an AI asks for your records, you're not starting from scratch. You're choosing what to share from data you already own.

## The Broader Picture

The 21st Century Cures Act created a capability: standardized patient access to health data via FHIR APIs. The infrastructure is live — 90,000+ endpoints, working OAuth, rich clinical data including full notes.

But the patient experience hasn't changed much. You still log into MyChart, look at your data in the vendor's UI, maybe download a PDF. The vision of patients controlling their data and sharing it with tools of their choice hasn't materialized.

Health Skillz is a proof of concept that it *can*. No accounts, no server-side storage of health data, no vendor lock-in. Just the mandated public APIs that every health system is required to support, a browser that acts as your data wallet, and end-to-end encryption when you choose to share.

The hardest part isn't the technology. The FHIR APIs work. The OAuth flows work. The data is there. The hardest part is that almost nobody has bothered to build consumer tools that use them.

---

*Health Skillz is open source at [github.com/jmandel/health-skillz](https://github.com/jmandel/health-skillz). Try it at [health-skillz.joshuamandel.com](https://health-skillz.joshuamandel.com).*
