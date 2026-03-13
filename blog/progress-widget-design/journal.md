# Development journal: progress widget design

This documents the actual process of designing the Health Skillz progress widget over ~45 minutes on February 11, 2026, using exe.dev + Shelley (a coding agent backed by Claude). The conversation happened in a persistent VM where Shelley could spawn parallel sub-agents, each with full filesystem and browser access.

## Starting point

The existing UI was a spinner and a status line that cycled through raw FHIR resource names:

```
Fetching: Observation:vital-signs (3/20)
```

It was functional but gave the user almost nothing — FHIR jargon flashing by too fast to read, no sense of overall progress, no sense of what was done vs. pending.

---

## Round 1: Diverge with six metaphors

**User prompt to Shelley:**

> Please articulate the aesthetics and user facing goals and information intensity after hypothesis that I have for this screen in a clear way and then come up with six totally different visual approaches to meet it, each of which you believe could possibly be meet my needs and then launch that agents to create static snapshots of these different approaches

Shelley generated six visual metaphors and spawned a sub-agent for each. Here's an example of how the sub-agent prompts were structured — each got a detailed design brief specifying the exact approach, aesthetic, cell states, and three required snapshots (early, mid, complete):

**Sub-agent prompt (Heatmap Grid):**

> You are designing a static HTML/CSS mockup of a data download progress visualization for a health records app. Create a file at `/home/exedev/health-skillz/prototype/viz-a.html`.
>
> **YOUR APPROACH: "Heatmap Grid"**
> A single rectangular grid like a GitHub contribution chart. Each resource type is one cell in a fixed grid (e.g., 5 columns × 4 rows). Cells are labeled with short 2-3 letter abbreviations. Active cells pulse gently. Done cells show intensity by resource count (light→dark green gradient). Empty cells are near-white. The page number appears as a small digit inside active cells. Below the grid: a single line of text that cycles through currently-active resource names.
>
> **CREATE THREE SNAPSHOTS in one HTML file**, shown vertically:
> 1. "Early" — ~3 cells done (light green), ~4 cells active (pulsing, showing "p1" or "p2"), rest pending (light grey)
> 2. "Mid" — ~12 cells done (varying green intensities), ~3 active (one showing "p5"), rest pending
> 3. "Complete" — all cells done, varying green intensities based on count, summary text below
>
> Use pure HTML/CSS, no JavaScript needed. Make it look polished — this is a design comp, not a wireframe.

**Sub-agent prompt (Mosaic Chips):**

> **YOUR APPROACH: "Mosaic with Inline Labels"**
> A hybrid of the GitHub grid and labeled list. The widget has category headers (bold, 11px, uppercase). Under each header, resource types appear as small inline tags/chips — like a tag cloud but in a fixed grid-like flow. Each chip background transitions: light grey (pending) → pulsing soft blue (active, with "p2" suffix) → green (done, with count suffix like "· 342"). The key insight: this is MORE readable than a pure grid because you can see the actual names, but MORE compact than a list because chips pack tightly.

Six HTML files generated in parallel, each showing the widget at three stages. 

**Result:** Some were good, some ugly. The waterfall felt too technical. The radial chart looked cool but was hard to parse quickly. The ticker was too sparse. The mosaic had interesting density. But the main finding: the prototypes treated each query's page count as known ahead of time, which it isn't.

---

## Round 2: Correct the constraint model

**User feedback to Shelley:**

> This was a good exercise but I think you haven't fully understood the constraints. We have 44 requests that we're going to make... within each of these requests there could be multiple pages and we don't know ahead of time how many there will be. Furthermore after we make those requests we then need to go back and refetch the attachment data for all document references... The space in this visualization needs to be preallocated and stable.

Shelley responded by writing a **data spec document** (`/tmp/viz-data-spec.md`) that sub-agents would read before building. This was a key evolution — instead of embedding all the constraints in each sub-agent prompt, the orchestrator wrote a shared reference document:

```markdown
# Visualization Data Shape & Constraints

## What actually happens during a fetch

### Phase 1: Resource Queries (44 queries, fixed, known upfront)

We fire exactly 44 search queries in parallel (max 5 concurrent)...
Each query can return 0+ pages. **We do NOT know how many pages until
we reach the last one.** Epic often does not populate bundle.total.

## Constraints on the visualization

1. **The layout must be stable.** No reflow, no resizing, no adding cells.
2. **Pages are unknown.** A query that's "in progress" might be on page 1
   of 1, or page 1 of 20.
3. **Resource counts are unknown until done.**
4. **Many queries will be empty.** Expect 10-20 of 44 to return nothing.
5. **Phases 2 and 3 are simple progress bars.** Known totals.
```

Sub-agent prompts now started with:

> Read `/tmp/viz-data-spec.md` first — it describes the exact data shape and constraints.

Six new prototypes, same parallel structure. Approaches: Pixel Grid, Grouped Mini-Bars, Waffle Chart, Timeline Feed, Ring Counter, Dense Mosaic v2.

**Result:** Better, but several still showed page numbers and FHIR jargon. The ring counter implied progress-bar semantics on something with no known total. The timeline feed would scroll forever.

---

## Round 3: Five-state model crystallizes

**User feedback to Shelley:**

> The ring counter implies progress bar semantics and we don't know how much there is to fetch at the beginning... throughout designs there are random things like P2 scattered but P2 is not a meaningful term to show somebody, I think you are over indexing on current strings that appear in the code base... make sure the agents demonstrate success and error cases across this full pad of queries, and there should be a pretty clear way to visualize a successful query that returned no results versus an errored query versus a successful query that returned some or lots

This feedback drove Shelley to write an explicit **state model document** (`/tmp/viz-state-model.md`) with the five visual states and exact simulation data for every one of the 44 elements across all three snapshots:

```
| State     | Meaning                | Visual treatment                    |
|-----------|------------------------|-------------------------------------|
| pending   | Waiting to start       | Neutral, unobtrusive. Light grey.   |
| active    | Currently downloading  | Animated/pulsing. Clearly alive.    |
| done      | Found data (count > 0) | Green. Darker = more data. Settled. |
| empty     | Checked, nothing there | Muted but settled. NOT an error.    |
| error     | Request failed         | Red. Clearly broken.                |
```

Sub-agent prompts became much more prescriptive about per-element state:

> **Cell states (this is critical — get these right):**
> - **Pending**: white fill, thin light grey border. Calm, invisible, waiting.
> - **Active**: light teal fill, pulsing gently (opacity 0.4→1.0). CSS @keyframes.
> - **Done**: green fill. Intensity varies by resource count: 1-5 very light (#c8e6c9), 6-20 light (#81c784), 21-100 medium (#4caf50), 101+ dark (#2e7d32).
> - **Empty**: white fill, single small grey dot centered. Clearly "nothing here" not "waiting."
> - **Error**: light red fill, small "!" centered.

**Result:** The pixel grid and dot matrix were now correct — showing exactly 44 elements with proper group counts (19+3+2+4+3+4+9). But the Grouped Inline approach invented fake category names, and page numbers still leaked into several designs.

---

## Round 4: No page numbers, no FHIR jargon

**User feedback to Shelley:**

> E: You've made up categories that don't correspond to resources or even concepts that we are downloading. Throughout designs there are random things like P2 scattered but P2 is not a meaningful term to show somebody.

Shelley wrote a new brief (`/tmp/viz-brief.md`) that was now explicitly patient-facing, opening with:

```markdown
## Who sees this

A patient who clicked "connect" to their hospital. They're waiting for
their health records to download. They are NOT developers. They don't
know what FHIR is, what a "page" of results means, or what
"Observation/cognitive-status" refers to.

## What they do NOT need to see

- Page numbers ("p3", "page 5") — meaningless implementation detail
- FHIR resource type names ("DiagnosticReport") — jargon
- Internal category codes ("observation-adi-documentation") — gibberish
- "Phase 1", "Phase 2", "Phase 3" — implementation stages
```

The brief also included all 44 queries with user-facing labels and realistic count ranges, organized by group.

Sub-agent prompts now explicitly banned jargon:

> Below: ONE line of muted 11px text listing what's currently active by user-friendly name: "Labs · Vitals · Encounters · Notes · ..." — just the names, NO page numbers, NO counts.

**Result:** Much better. But the user spotted that some visualizations still implied known totals for multi-page queries by varying the width/size of elements.

---

## Round 5: Lock it down — nothing grows, nothing is added

**User feedback to Shelley:**

> You are repeatedly giving me visualizations where it implies that we know how many pages of labs and vitals there will be and we don't! Please think carefully about the actual constraints and then come up with ideas where we can pre-allocate all the space we will need.

Shelley wrote a final brief (`/tmp/viz-brief-v2.md`) that opened with the constraint in bold:

```markdown
## THE CORE CONSTRAINT

The visualization has exactly **44 fixed visual elements**. They are
allocated at t=0 and NEVER change in size, position, or number. The
only thing that changes is each element's visual STATE (color,
animation, text content). Nothing grows. Nothing is added. Nothing moves.

Each element = one query. A query that internally fetches 8 pages of
results still gets ONE element. It stays in the "active" state longer.
That's it.
```

The brief also included **exact per-element state data** for all three snapshots — every one of the 44 elements specified as pending, active, done(count), empty, or error.

Sub-agent prompts were now very tight:

> Create `/home/exedev/health-skillz/prototype/viz5-d.html`.
>
> Read `/tmp/viz-brief-v2.md` FIRST. Follow it exactly.
>
> **YOUR APPROACH: "Counter Hero + Dot Strip"**
>
> Most minimal of all. The hero is a large resource count number. Below it, a single horizontal strip of 44 tiny dots with group gaps. That's the entire Phase 1 visualization.
>
> Build THREE SNAPSHOTS using the EXACT per-element state data from the brief.

Six final candidates produced. All correct.

---

## Round 6: Pick one, refine, implement

**User feedback:**

> vis5-d looks promising but early/mid need to pre-allocate the progress bars for resources/attachments. Use a subagent to take the feedback.

One sub-agent refined viz5-d to show the References and Attachments progress bars in every snapshot (as empty grey tracks with "—" before their phase begins), eliminating the last possible layout shift.

**User:**

> Nice, now make an implementation plan with everything you've learned written out to disk so a new agent can read that.

Shelley wrote a full implementation plan (`docs/design/PROGRESS_WIDGET_IMPLEMENTATION.md`) covering: the chosen design, the TypeScript types, the 44 query slots with labels and groups, what's knowable at each phase, the visual spec with exact CSS, the full React component code, integration points with line numbers, and migration advice.

A fresh agent read the plan and implemented the component as a clean rip-and-replace of the old progress system.

---

## What the orchestrator actually did

Shelley's role across the six rounds was:

1. **Translate vague feedback into precise sub-agent prompts.** The user said things like "there should be a pretty clear way to visualize a successful query that returned no results versus an errored query." Shelley turned that into a five-state model with exact colors and CSS specifications.

2. **Write shared reference documents that evolved round over round.** Each round's brief got tighter as constraints were discovered. The Round 1 prompts embedded everything inline. By Round 3, sub-agents read a shared spec file. By Round 5, that file included exact per-element simulation data.

3. **Dispatch six sub-agents in parallel.** Each round, six independent agents built HTML prototypes simultaneously. The orchestrator screenshotted each result and presented them as a gallery.

4. **Absorb corrections without losing context.** When the user pointed out that page numbers are meaningless to patients, Shelley didn't just remove page numbers — it restructured the brief around the patient's perspective.

5. **Write the handoff document.** After selection, the orchestrator produced a spec detailed enough that a fresh agent with no conversation context could implement the component correctly.

## The prompts got better, not just the designs

The most interesting evolution wasn't in the prototypes — it was in the sub-agent briefs. Compare:

**Round 1:** "Each resource type is one cell. Active cells pulse gently. Done cells show intensity by resource count."

**Round 5:** "The visualization has exactly 44 fixed visual elements. They are allocated at t=0 and NEVER change in size, position, or number. The only thing that changes is each element's visual STATE. Nothing grows. Nothing is added. Nothing moves."

Round 1's prompt left room for the sub-agent to make structural assumptions. Round 5's prompt eliminated ambiguity about the one thing that kept going wrong. Each round of user feedback about the prototypes was really feedback about the prompt — the designs were downstream of the brief.
