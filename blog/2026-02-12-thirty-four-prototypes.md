# Thirty-four prototypes in an afternoon

Health Skillz needs a progress widget. When you connect your patient portal, the app fires off a bunch of FHIR queries in parallel — labs, vitals, conditions, encounters, medications, documents — and the user needs to see *something* while that's happening. The existing UI was a spinner with a line of status text. It worked fine. But I had a vague sense that it could be better, and for once I had the means to actually explore that.

I'm building this on [exe.dev](https://exe.dev), using Shelley — a coding agent backed by Claude — that lives in a persistent VM with a browser, a filesystem, and the ability to spin up sub-agents in parallel. What follows is a description of what it's actually like to do iterative visual design with this kind of tool. Not to sell anyone on it, but because I think the workflow is genuinely new and I'm still figuring out what it's good for.

## Round 1: "Give me six different ideas"

I described the problem: we're fetching about 20 resource types, each might paginate, and I want some kind of visual progress indicator. Rather than go back and forth on a single approach, I asked for six completely different ones — a heatmap grid, a waterfall chart, a treemap, a radial diagram, a text ticker, and a mosaic of labeled chips. Each built as a standalone HTML file showing the widget at several stages of loading.

Shelley spawned six sub-agents simultaneously. Each one built its prototype in isolation. A few minutes later I had six HTML files to look at.

<!-- TODO: 2-3 screenshots from Round 1 -->

The interesting thing here isn't the output quality. Some of these were genuinely good, some were kind of ugly, a couple had the wrong vibe entirely. What was interesting was what happened in my head. Before seeing these I had a fuzzy preference — something compact, something that shows progress without demanding attention. After seeing six concrete options, I had *specific* opinions. The waterfall felt too developer-tool-ish. The radial chart was visually interesting but I couldn't quickly parse which segment was which. The ticker was too minimal. The mosaic was onto something.

I didn't know any of that before I saw the prototypes. I learned it by reacting to artifacts.

## Rounds 2–4: Tightening the constraints

Each round followed the same pattern. I'd look at the batch, say what was working and what wasn't, and Shelley would generate six more. The conversation was fast and informal — sometimes just a sentence or two of feedback, sometimes voice-transcribed and full of typos.

What changed between rounds wasn't just the visuals. It was the *problem definition*. In round 2, I realized the prototypes were assuming knowledge we don't have at render time — how many pages of results to expect for each query. I hadn't thought to specify that constraint upfront because I hadn't thought about it. Seeing it violated in six different ways made it obvious.

In round 3, the state model got formalized — five distinct states per query slot (pending, active, done, empty, error), each needing to be visually distinguishable at a glance. That came from looking at prototypes where "pending" and "empty" looked the same and realizing that was confusing.

In round 4, the labels shifted from technical identifiers to patient-friendly names. Not because anyone told me to, but because seeing "Observation:vital-signs" on a widget that was starting to look polished felt wrong. The design was outgrowing the placeholder data.

Each round, the brief got more precise. Not because I sat down and wrote a spec, but because each batch of prototypes revealed assumptions I hadn't examined.

## Round 5: Choosing

By the fifth round I had a tight brief — 44 fixed query slots in 7 groups, five visual states, no layout shift ever, three phases (resources, references, attachments). Six final candidates:

<!-- TODO: Round 5 grid with all 6 -->

The winner was "Counter Hero + Dot Strip" — a big resource count with a row of tiny colored dots underneath. Not the most information-dense option, not the most visually novel. But the one that felt right for a loading screen that should provide comfort without demanding attention.

One refinement pass (pre-allocate the reference and attachment progress bars so the layout never shifts), an implementation plan written to disk, and then a new agent picked it up and built the React component.

## The animation

Here's what the final widget looks like in motion — 21 seconds of simulated loading with realistic data:

<!-- TODO: Embed video -->

[Full gallery of all 34 prototypes →](progress-widget-design/index.html)

## What I'm actually trying to say

I've been a software developer for a long time, and there are a lot of tasks like this one. Not hard, exactly, but expansive — the kind of problem where the space of reasonable solutions is large and your first idea is fine but probably not your best idea. Normally you go with the first idea because exploring alternatives takes real time and you have other things to do.

The thing that's different with agentic tools isn't the quality of any individual output. I could have built any of these prototypes myself, probably better in some cases. What's different is the *tempo*. Six alternatives in parallel, in minutes. Feedback applied instantly to the next batch. Constraints that emerge from reaction rather than speculation.

It's a different kind of thinking. Instead of imagining what a widget might look like and trying to evaluate it in my head, I describe the space and then *react to real things*. My design taste still drives every decision — the AI has no opinion about whether dots or bars better suit a health app loading screen. But I get to exercise that taste against a much broader range of options than I'd ever produce on my own, on a schedule that fits inside the actual work rather than displacing it.

For a solo developer, this changes the math on a lot of decisions. Not the big architectural ones — those still need deep thought and you wouldn't want to rush them. But the hundred small design questions that come up in any application: how should this transition work, what's the right layout for this card, how should errors be displayed. These are all questions with a large solution space and a historically high cost of exploration. That cost just dropped by an order of magnitude.

I don't think this replaces design expertise. A skilled designer looking at my 34 prototypes would probably propose a 35th that's better than all of them. But "hire a designer" was never the realistic alternative for a loading widget on an open-source side project. The realistic alternative was spending ten minutes on it and moving on. What happened instead was spending forty-five minutes — not much more — and ending up with something I'm genuinely happy with, after a process that was itself interesting and educational.

That last part is easy to overlook. The prototypes I rejected taught me more about what I wanted than the one I picked. That's the actual value — not AI-generated design, but accelerated development of your own design intuition through rapid exposure to concrete alternatives.

---

*Built with [exe.dev](https://exe.dev) + Shelley + Claude Opus 4. Health Skillz is open source at [github.com/jmandel/health-skillz](https://github.com/jmandel/health-skillz).*
