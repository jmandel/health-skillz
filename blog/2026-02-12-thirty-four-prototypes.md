# Thirty-four prototypes in an afternoon

When you connect your patient portal to Health Skillz, the app fires off 44 FHIR queries in parallel — different categories of labs, vitals, conditions, encounters, medications, clinical notes, and so on. The whole fetch takes maybe fifteen seconds. Up until this week, the UI for that was a spinner and a line of text that cycled through resource type names faster than you could read them. It worked. Nobody complained. But every time I watched it I thought, I should really do something with this.

I never did, because "do something with this" is open-ended in a way that makes it easy to defer. I could picture a lot of different approaches, couldn't tell which would actually feel right, and didn't want to spend half a day building a progress widget when there were real features to ship. So the spinner stayed.

This week I explored it anyway, using a workflow that didn't exist a year ago. I'm building Health Skillz on [exe.dev](https://exe.dev) with Shelley, a coding agent backed by Claude that runs in a persistent VM with browser access and the ability to spin up sub-agents in parallel. Over about forty-five minutes, working with Shelley, I went through six rounds of prototyping — thirty-four distinct visual designs for the same progress widget — and ended up with something I like a lot. What I want to write about isn't the widget. It's what the process felt like and what I think it means.

## Six ideas at once

I started by describing the problem and asking for six completely different approaches. Not variations on a theme — six different visual metaphors for showing progress across a batch of parallel queries. A heatmap grid like GitHub's contribution chart, a waterfall like Chrome DevTools, a treemap where rectangles grow with data volume, a radial donut, a minimal text ticker, and a mosaic of labeled chips.

Shelley spawned six sub-agents and they each built a standalone HTML prototype in isolation. A few minutes later I had six files to open, each showing the widget at three stages: early in the fetch, midway through, and complete.

![Heatmap grid](progress-widget-design/screenshots/01a-heatmap.png)
![Waterfall rows](progress-widget-design/screenshots/01b-waterfall.png)
![Radial segments](progress-widget-design/screenshots/01d-radial.png)

Some of these were good. Some were ugly. A couple missed the mark entirely. But something useful happened as I looked through them: my vague sense that the spinner "could be better" turned into specific opinions. The waterfall was too technical. The radial chart looked cool but I couldn't parse it quickly. The ticker was too sparse. The mosaic had an interesting density to it. I couldn't have told you any of that before I saw the prototypes. I learned what I wanted by seeing things I didn't want.

## The brief writes itself

I gave quick feedback and asked for another round. And another. The conversation was informal and fast — a few sentences of reaction, sometimes voice-transcribed typos and all, then six more prototypes.

The surprising thing was how the *problem definition* evolved alongside the visuals. In round two I noticed that every prototype was allocating space per page of results — as if we know upfront that labs will have eight pages and vitals will have four. We don't know that. We learn it as pages come back. I hadn't thought to specify this constraint because I hadn't really thought about it. Seeing it violated six different ways made it obvious, and from that point on the brief included "44 fixed slots, pre-allocated, no layout changes ever."

In round three, looking at prototypes where finished-but-empty slots looked identical to not-yet-started slots, I realized the state model needed to be explicit: pending, active, done, empty, error — five states, each visually distinct. That wasn't something I'd reasoned out ahead of time. It fell out of looking at a prototype and thinking "wait, I can't tell what's happening here."

Each round, the brief got tighter. Not because I sat down to write a spec, but because each batch of prototypes surfaced assumptions I hadn't examined. By round five I had a brief that was genuinely precise — 44 query slots in 7 named groups, five visual states with specific color tiers for data volume, three sequential phases, pre-allocated progress bars for all of them. That brief didn't exist in my head at the start. The prototypes drew it out.

## Picking a winner

The sixth round produced six final candidates against that tight spec:

![Dot matrix rows](progress-widget-design/screenshots/05a-dot-matrix-rows.png)
![Segmented bar with counter](progress-widget-design/screenshots/05b-segmented-bar-counter.png)
![Square grid](progress-widget-design/screenshots/05c-square-grid.png)
![Counter hero + dot strip](progress-widget-design/screenshots/05d-counter-hero-dot-strip.png)
![Stacked group bars](progress-widget-design/screenshots/05e-stacked-group-bars.png)
![Fixed chip grid](progress-widget-design/screenshots/05f-fixed-chip-grid.png)

I picked "Counter Hero + Dot Strip" — a big resource count front and center, with a single row of 44 tiny colored dots underneath. It's not the cleverest design in the batch. The chip grid packs more information, the stacked bars show group structure better. But for a loading screen — something that should provide reassurance without demanding attention — the big number just works. You glance at it, you see 1,200 resources found and a bunch of green dots, and you know things are going well. That's all a patient needs from this screen.

One refinement pass to make sure the references and attachments progress bars are pre-allocated in every state, then Shelley wrote up a full implementation plan and a fresh agent picked it up and built the React component.

Here's the widget in motion — a 21-second simulation with realistic data volumes:

<!-- TODO: Embed video -->

[Browse all 34 prototypes →](progress-widget-design/index.html)

## What I think about this

There are a lot of tasks like this one in software development. Not hard exactly, but wide open — the kind of problem where lots of solutions are reasonable, your first idea would be fine, and the only way to know if you can do better is to try a bunch of things. Normally you don't try a bunch of things. You pick something, build it, ship it, move on. The cost of exploration is too high relative to the value of a marginally better answer.

What changed here is the cost. Six parallel prototypes, built and screenshotted in minutes. Feedback applied, six more. The elapsed time for the whole process was about forty-five minutes, most of which was me looking at things and thinking.

There's something genuinely new about this as a way of working, and I don't think I fully understand it yet. It shifts design from a constructive process — reason about the problem, synthesize a solution — to a reactive one. You generate a bunch of options and then pattern-match against your own taste. That's a real tradeoff. It's faster and it surfaces ideas you wouldn't have had on your own, but you're exercising a different cognitive muscle than the one you use when you sit down and think carefully about a design from first principles. I suspect that if this became the *only* way you designed things, you'd lose something. The careful thinking matters and it produces things that reactive selection can't.

But for the vast majority of design decisions on a project like this — a solo developer building an open-source tool — careful first-principles design was never the realistic alternative. The realistic alternative was ten minutes and move on. Against that baseline, forty-five minutes of reactive exploration is a massive improvement, both in the quality of the output and in what I learned along the way. And the tools keep getting better at this. The prototypes from round five were substantially more polished than round one, partly because the brief improved but partly because these models are just getting good at this kind of work.

The thing I keep coming back to: the prototypes I rejected taught me more than the one I picked. Each round, I understood the problem better — not because I thought harder about it, but because I saw concrete things that were wrong and could articulate why. The thirty-three rejects aren't waste. They're the process by which the thirty-fourth became the right answer.

---

*Built with [exe.dev](https://exe.dev) + Shelley + Claude Opus 4. Health Skillz is open source at [github.com/jmandel/health-skillz](https://github.com/jmandel/health-skillz).*
