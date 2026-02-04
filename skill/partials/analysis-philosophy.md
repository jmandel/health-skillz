## Analysis Philosophy

### Getting started with a patient's data

After downloading and decrypting the data, **don't dump a generic dashboard**. Instead:

1. **Do a quick scan** — glance at conditions, recent encounters, medication count, and attachment index to orient yourself
2. **Open with a brief clinical sentence** that shows you understand the patient's situation (e.g., "You have records from two providers spanning about 5 years, mostly primary care visits with some specialist referrals and recent lab work.")
3. **Offer a few specific directions** as numbered choices based on what you see in the data — let the user steer:

> Based on your records, here are some things I can help with:
> 1. Review your recent lab results and trends
> 2. Summarize a specific condition or health topic from your records
> 3. Check your medications and allergies
> 4. Look through your clinical notes for a specific topic
>
> What interests you, or is there something else you'd like to explore?

This is better than producing a long overview the user didn't ask for. Let them choose what matters to them.

### Going deep on what the user asks

**Clinical notes are the primary source for most questions.** Structured FHIR resources (Observation, Condition, MedicationRequest) are useful as lookup tools — checking a specific lab value, listing current meds, confirming a diagnosis. But the answers to most real questions ("what happened with my concussion?", "what did my doctor recommend?", "why was I referred to neurology?") live in the clinical notes.

When exploring a topic:
- **Search attachments by keyword** to find relevant notes
- **Read the most relevant notes in full** — don't just skim snippets
- **Be thorough on the question actually asked** — it's better to read 5 notes deeply on one topic than to skim 20 notes across everything
- **Cross-reference with structured data** when it adds value (e.g., pull lab trends alongside a note discussing those results)

### Context window management

Patient records vary enormously — from a single encounter to decades of history with hundreds of notes. Attachments can easily total 300K+ characters, overwhelming your context.

- **Always deduplicate attachments first** — Epic produces HTML + RTF pairs for the same document; prefer HTML (see deduplication code in examples below)
- **Index before reading** — build a compact list of documents (date, type, size, preview) to understand what's there
- **Search, then read selectively** — keyword search with context snippets, then read full text only for documents that matter
- **Use structured data for structured questions** — lab values, med lists, and allergy lists are more efficient to query from FHIR resources than to extract from note text

### If the user wants a live artifact/app

Pre-processing is still valuable:
- Do your exploratory analysis first
- Identify the key data points and insights
- Then build the artifact with pre-processed results or focused queries
- This avoids shipping analysis code you can't see or debug
