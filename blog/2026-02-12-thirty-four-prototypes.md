# Thirty-four prototypes in an afternoon

I needed a progress widget. Health Skillz fetches your medical records through 44 parallel FHIR queries — labs, vitals, conditions, medications, encounters, documents — and the existing UI for this was a spinner with a single line of text that flashed by too fast to read:

> ⟳ Fetching: Observation:vital-signs (3/20)

Functional for me during development. Meaningless to a patient watching it. No sense of overall progress, no indication of what "3/20" means, no way to tell if the thing is stuck or just working through a lot of data.

I knew I wanted something better but didn't have a strong opinion about *what*. A grid? A bar chart? Dots? Numbers? I could picture several approaches, each with tradeoffs I wouldn't really understand until I saw them. This is the kind of design question that, on a solo project, you normally just... pick something reasonable and move on. You don't have a design team to brainstorm with. You can't justify spending a day exploring radically different directions for a loading screen.

Except now you can.

## The new economics of exploration

I'm building Health Skillz on [exe.dev](https://exe.dev), which gives me a persistent cloud VM with [Shelley](https://exe.dev) — an agentic coding assistant backed by Claude. Shelley has a browser, a filesystem, shell access, and the ability to spawn parallel sub-agents. When I described what I wanted, Shelley didn't just build one widget. It articulated the design constraints back to me, proposed six fundamentally different visualization approaches, and then launched six sub-agents simultaneously — each one building a complete, styled HTML prototype with multiple snapshots showing early, mid, and completed states.

Six prototypes. In parallel. Each one a self-contained HTML file I could open and evaluate. The whole batch took a couple of minutes.

<!-- TODO: Insert 2-3 example screenshots from Round 1, e.g. the heatmap, radial, and mosaic -->

This is the part that's hard to convey if you haven't experienced it. It's not that any individual prototype was amazing — some were, some weren't. It's that the *cost of exploration collapsed*. Instead of committing to an approach and refining it, I could look at six different directions and develop an informed opinion about what I actually wanted.

## Feedback loops, not prompts

The first round taught me something I didn't know before I saw the prototypes: all six assumed I'd know upfront how many pages of lab results there would be. I don't. The FHIR server might return 1 page or 8 pages for any given query, and I only learn that as each page comes back. Every prototype that pre-allocated space per page was wrong.

So I said that. Not in carefully worded requirements — just a quick voice-transcribed note: "You are repeatedly giving me visualizations where it implies that we know how many pages of labs and vitals there will be and we don't!"

Six new prototypes. This time with a proper constraint: 44 fixed query slots, pre-allocated from the start, that change state in place. No growing, no reflowing, no adding elements as pages are discovered.

But they still had page numbers displayed inside the active cells. Patients don't care about "page 3." And they were using FHIR resource type names — "Observation," "DiagnosticReport" — instead of anything a human would recognize.

Another round. Six more. Now with patient-friendly labels like "Labs," "Vitals," "Clinical Notes" and no technical details exposed.

Then another round, refining the state model. Then a final round, where I could see the real tradeoffs clearly:

<!-- TODO: Insert the Round 5 grid showing all 6 final candidates, with the chosen one highlighted -->

The "Counter Hero + Dot Strip" won. A big number counting up (the thing patients actually care about — how much data has been found), a strip of 44 tiny dots below it (giving a gestalt sense of progress without requiring any reading), and pre-allocated progress bars for the references and attachments phases.

## What thirty-four prototypes teaches you

Six rounds × six variants = thirty-four prototypes (plus a refinement pass on the winner). Each round took a few minutes of wall-clock time. My contribution was looking at results and saying what I liked and didn't like — usually in a sentence or two.

Here's what I learned that I wouldn't have learned by just building one:

**The counter matters more than the visualization.** I thought I wanted a clever grid or chart. After seeing a dozen of them next to a version with just a big number, it was obvious: "1,490 resources found" is what a patient actually wants to see. The dot strip is decoration that provides comfort — you can see things are happening — but the number is the hero.

**Layout stability is a feature you only appreciate in contrast.** Several early prototypes grew or reflowed as data arrived. I didn't realize how much that bothered me until I saw versions where the layout was completely static from the first frame. The widget should claim its space and hold it.

**Empty states need design too.** Many of the 44 queries return nothing — there are no "disability status" observations for most patients. Early prototypes didn't visually distinguish "pending" from "done but empty." Once I saw a version where empty slots faded to a distinct light grey, the information density jumped.

**You can't evaluate a progress widget from a screenshot.** I needed three snapshots per variant — early, mid, complete — to understand how each one would feel over time. The winning design was the one where all three snapshots felt like the same widget in different states, rather than three different-looking things.

None of these insights came from the AI. They came from me looking at real artifacts and having opinions. The AI just made it feasible to generate enough artifacts to have opinions about.

## The final result

Here it is in motion — a 21-second simulation running through all three phases with realistic data volumes:

<!-- TODO: Embed loading-widget-animation.mp4 video -->

Forty-four queries fire with a concurrency of 5. The big number ticks up as resources arrive. Dots transition from grey (pending) through teal (active, pulsing) to green (done, with intensity proportional to count) or light grey (empty) or red (error). When all 44 settle, the references phase kicks in, then attachments, then a final checkmark.

The whole thing is ~140px tall. It never changes size. Every element is present from the first frame.

[Browse the full gallery of all 34 prototypes →](progress-widget-design/index.html)

## What this means for small teams

I want to be clear about what happened here. I didn't use AI to *design* a widget. I used it to *explore a design space* that I then navigated with my own taste and judgment. The difference matters.

A designer with a week could have done better work on any single prototype. But I wouldn't have hired a designer for a loading widget on a side project. The realistic alternative wasn't "professional design" — it was "pick the first idea that seems okay and ship it." That's what solo developers do for everything that isn't the core product, because exploration has always been expensive.

What's changed is that exploration is now cheap. Not free — I still had to look at every prototype, form opinions, and articulate what I wanted differently. That's real cognitive work. But the mechanical cost of turning "what if we tried a radial chart?" into an artifact I can evaluate went from hours to seconds.

This shifts which problems are worth going deep on. A loading widget is a small thing. But it's the kind of small thing that, multiplied across an entire application, is the difference between software that feels considered and software that feels like someone got it working and moved on. When the cost of "let me see six different ways to do this" is a couple of minutes, you start doing it for things you never would have before.

That's what I'm most excited about. Not AI-generated design, but AI-enabled *taste development*. You learn what you want by seeing what you don't want, and now the bottleneck on that process is your attention, not your implementation capacity.

---

*Built with [exe.dev](https://exe.dev) + Shelley + Claude. Health Skillz is open source at [github.com/jmandel/health-skillz](https://github.com/jmandel/health-skillz).*
