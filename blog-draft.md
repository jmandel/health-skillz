# Your records should outlast the conversation

Health Skillz started as a way to get your health records to an AI. You'd click a link from Claude, sign into your patient portal, and data would flow through — fetched, encrypted, uploaded — in one shot. It worked, but every time a new conversation wanted your records, you'd start from scratch. New OAuth login, new FHIR fetch, new upload. Your data existed only in transit.

This week we redesigned the whole thing around a different idea: your health records should live in your browser, under your control, for as long as you want them there. Sharing with an AI becomes something you do *with* data you already have — not a reason to go fetch it.

## What actually changed

The app used to have three separate flows: one for sharing with an AI, one for downloading records yourself, and one for managing saved connections. Three pages, three code paths, overlapping but subtly different. If you'd collected records through the "download" flow, they wouldn't show up when an AI asked for them. The mental model was fragmented.

Now there's one page. `/records` is your health records hub. Every connection you've made is there — patient name, provider, how much data you have, how fresh it is. When you visit on your own, you see "My Health Records" with a download button. When an AI sends you a link, you see the exact same page with an additional "Send to AI" button. Same data, same connections, different action.

The AI session didn't go away — it's still how Claude requests your records and how end-to-end encryption works. But the session is now an envelope you put your data into, not the thing that organizes your data.

## Save once, share many times

The biggest practical difference: you authorize with your health system once, and then your data is available for however many AI conversations you want.

The old flow did everything during the OAuth redirect. You'd come back from your patient portal login and the callback page would exchange the token, fetch your FHIR data, encrypt it, and upload it — all while you stared at a spinner. If the upload failed partway through, you might need to start over.

Now the callback page just saves. It exchanges the token, fetches your records, and writes them to your browser's local database. That's it. No encryption, no upload, no server calls. Your data has a home before it goes anywhere.

When you're ready to share — maybe right away, maybe next week — you pick which connections to include, click send, and the app encrypts and uploads from the local cache. If you want to share with a different AI tool tomorrow, the data's still there. No re-authorization, no waiting.

## Keeping things fresh

Connections aren't snapshots. Each one stores a refresh token from your health system, so when you want updated records — new lab results, a recent visit note — you tap Refresh. The app silently gets a new access token and re-pulls everything. No portal login, no re-authorization.

Each connection card shows you what you need to know at a glance: the patient's name and date of birth (important if you're managing records for family members), which provider it's from, how much data is cached, and when it was last updated. A green dot means the connection is healthy. If the refresh token has expired after months of inactivity, the dot goes amber and you'll need to sign in again — but the cached data is still there.

This is the shift from treating a health record as a one-time export to treating it as a living link. Your records accumulate and stay current.

## Design details

Some smaller things that shipped alongside the redesign:

**Cards as checkboxes.** Each connection is a tappable card — touch anywhere to select or deselect it. The old tiny checkboxes were fine on desktop but miserable on a phone. Selected cards get a blue tint so the state is obvious.

**Buttons that tell you what they'll do.** "Send 2 records to AI" instead of just "Send." "Download AI Skill with 3 records" instead of just "Download." When nothing is selected, the buttons are greyed out. You never have to wonder what's going to happen.

**Info tips that work on mobile.** We had `title` attributes on some buttons to explain what they do — totally invisible on phones since there's no hover. Replaced them with little ⓘ buttons that show a tooltip bubble when you tap.

**Instant provider search on return visits.** The provider directory is about 90,000 endpoints. It used to re-download and re-parse that list every time you visited the "add connection" page. Now it's cached in memory across navigations — first visit loads the file, subsequent visits render instantly.

## Cleaning house

The UX redesign surfaced a lot of state management debt. We ran a formal audit of every piece of state in the app — which store owns it, where it's persisted, what can get out of sync.

The headline: we deleted an entire Zustand store that had zero imports (dead code from an earlier architecture), gutted the persistence layer from 215 lines down to 35, and ended up with a clean picture: health data in IndexedDB, transient OAuth state in sessionStorage, and nothing at all in localStorage. The app went from -409 lines net across the sprint despite adding significant functionality.

We also set up proper deployment infrastructure — a systemd service with the right config, ETag support for the provider directory so browsers can do conditional cache validation.

## What's next

The connection model opens up ideas that didn't make sense when data was ephemeral:

- A unified timeline across providers — medications, labs, conditions from multiple health systems in one view
- Smarter refresh — only pull resource types that are likely to have changed
- Portable connections — some way to move your saved connections between devices

But the core shift already happened. Your browser is the home for your health data, and sharing is something you do from a position of already having it. That feels like the right foundation.

---

*Health Skillz is open source. Try it at [health-skillz.joshuamandel.com](https://health-skillz.joshuamandel.com) or grab the code at [github.com/jmandel/health-skillz](https://github.com/jmandel/health-skillz).*
