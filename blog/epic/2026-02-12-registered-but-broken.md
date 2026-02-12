# Registered at 500 organizations. Couldn't connect to any of them.

*Josh Mandel, MD · February 2026*

*This is a follow-up to [7,000+ Clicks to Register a FHIR App](./2026-02-11-epic-activation-journal.md). That post covered the work of getting a confidential SMART on FHIR client registered at ~500 Epic organizations. This post covers what happened next.*

---

The management portal said "Keys enabled" at 496 organizations. Everything looked green. The automation script had run, the credentials were confirmed, the status column was a wall of green checkmarks. Time to actually use the app.

I opened Health Skillz, picked a provider close to home in Madison, Wisconsin — UW Health, one of the largest Epic installations in the country — and tried to connect. The OAuth flow started normally: redirect to the patient portal, log in, approve the scopes. Then the token exchange failed.

`invalid_client`

That's it. No description, no error detail, no hint about what went wrong. Just `invalid_client` — a catch-all OAuth error that could mean the client ID is wrong, the JWT assertion is malformed, the algorithm is unsupported, the signature is invalid, the audience is wrong, the token is expired, the redirect URI doesn't match, or roughly a dozen other things. It's the HTTP 500 of OAuth errors.

I tried UnityPoint Health, also in the Madison area. Same thing. `invalid_client`. Two for two.

This was a confidential client using JWT-based authentication with an ES384 key. The same client worked fine in Epic's sandbox. It worked in nonproduction environments. It just didn't work in production, at real organizations, where real patients have real data.

## Debugging with help from Epic

I reached out to Epic's developer support team. The representative I worked with is one of the people who actually understands the internals of Epic's OAuth implementation, and he was generous with his time.

The problem with `invalid_client` is that there's nothing to go on from the client side. The token endpoint returns the error, and that's all you get. There's no way to ask "why did you reject my client assertion?" or "what specifically about my JWT didn't validate?" The information exists — Epic's server knows exactly why it rejected the token — but it doesn't surface in the response. He mentioned that Epic has development in progress to include more detail in the error description, but it's stalled on prioritization. So for now, you're blind.

He offered to do something unusual: coordinate with UnityPoint's operations team to enable debug logging on their production Epic servers, so we could reproduce the failure and see what their system actually recorded. This required human coordination — asking the right people at the right customer to turn on the right logging at the right time — and we set it up for the following day.

In the meantime, he checked a few things. He initially wondered about the algorithm — our JWT was signed with ES384, and he wasn't sure all signature types were supported everywhere. He sent a link to Epic's troubleshooting documentation for `invalid_client`, which covers the basics: wrong redirect URI, wrong client ID, signature validation issues. As he put it: "Since this is Josh Mandel we're talking about, sending you a link to the basics feels a bit weird." Fair enough — I'd been building SMART on FHIR apps for over a decade. But the basics were worth ruling out.

I retried the token request. Failed again. Tried RS256 instead of ES384, in case the algorithm was the issue. Still failed. He confirmed the algorithm wasn't the problem after checking against Epic's internal tooling.

## Outbound traffic

The next day, with logging enabled at UnityPoint, I reproduced the failure and shared the curl command. He looked at the logs and found something unexpected: there was nothing in their database logs. No record of the token request being processed at all.

The only scenario where that happens, he explained, is if signature validation fails before the request even reaches the database layer. Signature validation runs on a separate server, and many Epic customers have historically configured those servers with very restrictive outbound network policies — specifically to prevent malware command-and-control traffic. The security policy is straightforward: the server should not be making arbitrary outbound HTTPS requests.

But when an app registers with a JWK Set URL, that's exactly what needs to happen. The Epic server receives a JWT, looks up the app's JWK Set URL, makes an outbound HTTPS request to fetch the public keys, and validates the signature. If the server can't make that outbound request, signature validation fails. The token request returns `invalid_client`. No further detail.

He estimated that roughly 80% of Epic customers have opened up their outbound network policies to allow JKU fetching. That means roughly 20% haven't — and at those organizations, any app using the "JWK Set URL (Recommended)" authentication method will silently fail. The patient will see a generic error. The developer will see `invalid_client`. Nobody will know that the problem is a network policy on a server they don't control and can't inspect.

## The fix nobody recommends

He asked me to try something at UnityPoint: instead of pointing to my JWK Set URL, paste the actual public keys directly into the per-organization configuration. Epic's management portal has this option — you click "Other" instead of "JWK Set URL (Recommended)," then select "JSON Web Key Set (JWKS)" and paste your keys into a textarea.

When you select "Other," the portal shows a warning in bold: **"We recommend using a JWK Set URL instead of these options."** There's a link to documentation about JWKS URLs. The UI is designed to steer you away from direct key upload and toward the JWK Set URL option.

I pasted my keys. Saved. He coordinated a manual sync with UnityPoint's team (because key updates don't propagate instantly). Within minutes, the token exchange worked. I could fetch patient data. The app was live.

The recommended option doesn't work. The option the UI warns you against is the one that works.

## Re-activating 500 organizations, again

This meant every organization I'd activated — all 496 of them, via the automation script from the previous post — had been configured with the wrong authentication method. They all used JWK Set URL. Some fraction of them (at least 20%, possibly more) would fail when real patients tried to connect.

I needed to re-activate all of them with direct JWKS upload instead. Back to the script.

The good news: the `ApproveDownload` API accepts `TestJWKS` and `ProdJWKS` parameters. When these are empty, Epic uses the app-level JWK Set URL. When populated with a JWKS JSON string, it stores the keys directly at that organization. Same endpoint, same parameters, just with the JWKS filled in instead of blank.

I also discovered that when uploading JWKS directly, you can activate both nonproduction and production environments in a single API call — `NonProdOnly=false, ProdOnly=false` with both `TestJWKS` and `ProdJWKS` populated. The original script needed two calls per org (one for nonprod, one for prod). The updated script needs one. Half the API calls, and the keys are embedded rather than referenced.

The updated script prompts for mode at startup: enter "1" to use JWK Set URL (the original behavior), or paste a JWKS URL to fetch keys and upload them directly. It defaults to the app's `.well-known/jwks.json` endpoint. When it detects that organizations are already activated, it asks whether to re-activate them — which is what you need when switching from one authentication method to the other.

## EC keys: accepted at registration, rejected at configuration

One more surprise during the script update. My app's JWKS contains three keys: one ES384 (elliptic curve) and two RSA (RS256 and RS384). Epic's app registration page happily accepts all three in the app-level JWKS configuration. No errors, no warnings.

But the per-organization configuration panel — the modal where you paste keys for a specific community member — rejects EC keys. If you include an ES384 key in the JWKS you upload, the save fails.

So the same keys that Epic accepts at the app level are rejected at the organization level. There's no indication during app registration that EC keys won't work downstream. You discover it later, when you're trying to configure individual organizations and the keys you've been using all along are suddenly invalid.

The fix in the script is simple: filter the fetched JWKS to RSA keys only (`kty === 'RSA'`) before uploading. But a developer who didn't know to do this would hit a confusing wall — the keys work at the app level, work in the sandbox, and then fail when you try to deploy to production organizations.

## .NET serialization artifacts

After re-running the script to upload direct JWKS at all organizations, I reopened the management modal for one of them to verify the keys were stored correctly. What I saw was unexpected.

The stored JWKS had capitalized property names: `Kty` instead of `kty`, `N` instead of `n`, `E` instead of `e`. It also contained properties that don't belong in a JWK at all: `CryptoProviderFactory`, `HasPrivateKey`, `KeySize`, `AdditionalData`. These are internal fields from .NET's `JsonWebKey` class — they'd leaked into the stored representation. And at the bottom of the modal, a validation error: "JWKS key #1 is missing 'kty' property."

The keys actually worked — UnityPoint was proof of that. But Epic's own UI couldn't display what its own backend had stored without throwing a validation error.

I initially thought this was a formatting issue. My script was sending compact JSON, while the UI sends pretty-printed JSON with 2-space indentation. When I pasted the same JWKS manually through the UI and immediately re-opened the modal, the keys looked correct: lowercase properties, no .NET internals, no validation error. I changed the script to pretty-print and assumed the problem was solved.

It wasn't. After a full page reload, the PascalCase properties and .NET internals were back — even for keys pasted manually through the form. The sequence: paste JWKS → save → immediately re-open the modal (looks fine) → reload the page → re-open the modal (mangled). The UI was caching the client-side value on immediate re-open, hiding what the server actually stored.

This is a server-side bug. All JWKS submissions — compact or pretty-printed, API or form — get deserialized into .NET `JsonWebKey` objects and re-serialized with PascalCase property names and internal framework fields. The keys still validate signatures correctly, so it's cosmetic from a functionality standpoint. But Epic's own management UI can't display what its own backend stored without triggering a validation error on every single organization.

## New organizations, overnight

The next morning I ran the script again to re-activate everything with pretty-printed JWKS. The org count had changed: 502, up from 500.

Two new organizations had appeared overnight:

- **Brown University Health** (OrgId 392) — this was previously "Lifespan" in Epic's public Brands bundle. Same OrgId, renamed. Notably, this was one of four organizations that had been in the public endpoint directory but *not* on our management page the day before. It appeared via auto-sync overnight.

- **eleHealth** (OrgId 32586) — a brand new organization with a high OrgId, not previously in any list.

This answered a question from the previous post: does Epic's auto-sync continue delivering new organizations after initial app registration, or is the list frozen? It continues. The org list is a living thing, updated at least daily. Brown University Health's appearance also confirmed that the four "Brands-only" organizations we'd identified weren't permanently excluded — they just hadn't been synced yet.

## What this means for developers

If you're building a confidential SMART on FHIR client on Epic:

1. **Don't use JWK Set URL.** I know the portal says "Recommended." I know the alternative triggers a warning. Use direct JWKS upload anyway. JWK Set URL fails silently at organizations that restrict outbound traffic, and there's no way to know which organizations those are until a patient tries to connect and gets a generic error.

2. **Filter to RSA keys.** Even if your app-level JWKS includes EC keys and Epic accepts them at registration, the per-org configuration rejects them. Strip EC keys before uploading. Only `kty === 'RSA'` keys work.

3. **Ignore the validation errors.** After uploading JWKS, Epic's management UI will show your keys with PascalCase property names (`Kty` instead of `kty`) and .NET internal fields (`CryptoProviderFactory`, `HasPrivateKey`), along with a validation error claiming the `kty` property is missing. This is a server-side serialization bug — the keys work fine for signature validation despite the mangled display. Don't let the error message send you on a debugging wild goose chase.

4. **Expect to re-activate.** If you initially registered with JWK Set URL and later switch to direct JWKS (which you should), you need to re-activate every organization. The script in our repo handles this — it detects already-activated orgs and offers to re-process them.

5. **The org list updates.** New organizations appear via auto-sync. Plan for your script to be re-run periodically to pick up new additions.

None of this is documented. The portal actively steers you toward the option that doesn't work. The error messages don't tell you what's wrong. The management UI shows validation errors on its own stored data. A developer without a direct line to Epic's engineering team would be stuck — and even Epic's own representative acknowledged that the developer experience tooling hasn't received the attention the underlying infrastructure deserves.

---

*The [automation script](https://github.com/jmandel/health-skillz/blob/main/blog/epic/epic-activate-all.js) and [full technical journal](https://github.com/jmandel/health-skillz/blob/main/blog/epic/2026-02-11-epic-activation-journal.md) are in the [Health Skillz repo](https://github.com/jmandel/health-skillz).*

*Health Skillz is open source and not affiliated with Epic, Anthropic, OpenAI, or any healthcare provider. I work at Microsoft but this is a personal project.*
