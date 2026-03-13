# One way to collect and share records

Health Skillz has gone through a meaningful UX and architecture cleanup. The short version: we moved from multiple overlapping flows to one canonical path for record collection and sharing.

This post explains what changed, why it changed, and what it means for users and implementers.

## The old model

The project evolved quickly, and we accumulated multiple paths that all did similar things:

- local collection and management pages
- AI session pages
- callback/legacy URL variants from earlier iterations

The result worked, but it was harder to reason about:

- users saw different routes for similar actions
- docs drifted from implementation over time
- API descriptions referenced older payload versions and lifecycle language

In particular, user guidance often implied a separate "Done" step. In the current app, the real action is explicit record selection followed by **Send ... to AI**.

## The new model: one way

The core UX now centers on a single records model:

- `/records` is the persistent records hub
- `/records/add` is the provider search/selection path
- `/connect/:sessionId` is a thin session wrapper over the same records UI, adding session-aware send/finalize behavior

Conceptually:

- connections are durable, browser-side assets
- sessions are temporary envelopes for encrypted sharing

That separation simplifies both the product and the codebase.

From a user perspective, the important part is simple: after portal sign-in, you land back in the same records experience and continue where you left off.

Implementation note (not user-facing UX): the app currently accepts callback returns at both `/records/callback` and `/connect/callback` so standalone and session-driven flows share the same callback handler.

## What changed for users

1. One mental model
Users manage records in one place, then share selected records with AI when needed.

2. Clear action language
Instead of a vague "Done" notion, users explicitly select records and press **Send ... to AI**.

3. Consistent navigation
The same records concepts apply whether users arrive directly or from an AI-issued session link.

4. Better trust signaling
The send/finalize moment is explicit, which better matches user expectations for consent and data transfer.

## What changed in the implementation

1. API/docs alignment to the current protocol
- chunked upload flow is the documented default (v3-style behavior)
- finalize is documented as token-gated session completion after upload
- poll/chunk behavior is documented in metadata + chunk-download terms

2. Route documentation cleanup
- removed stale references to older path variants as primary flows
- documented canonical callback and records routes

3. Session lifecycle language cleanup
- "finalized" now describes completion after send/upload, not a separate legacy "Done" click model

## Documentation refresh included

As part of this cleanup, we updated:

- `README.md` flow and endpoint descriptions
- `docs/design/DESIGN.md` route model, lifecycle, and API examples
- `docs/ai-platform-skill-setup-guide.md` troubleshooting language for the current send flow

This is important operationally: health-data products need docs that match reality, especially around consent, encryption, and transfer behavior.

## Why this matters

This rewrite reduces ambiguity in three high-impact areas:

- user understanding of when sharing actually happens
- developer understanding of which routes and payloads are canonical
- operator confidence that docs and runtime behavior match

The goal is simple: one way, clearly documented, with compatibility where needed and no confusion about the primary path forward.
