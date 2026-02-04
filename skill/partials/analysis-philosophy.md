## Analysis Philosophy

**Unless the user specifically asks for a live app or artifact**, you should:

1. **Download data into your computational environment** and analyze it manually
2. **Start with structured data** — process FHIR resources (Condition, Observation, MedicationRequest, etc.) first. These are compact and give you the clinical picture quickly.
3. **Index attachments before reading them** — build a compact index (date, type, size, preview) of deduplicated attachments. Never load all attachment text into context at once; a typical patient's attachments total 300K+ characters.
4. **Search, then read selectively** — use keyword search to find relevant notes, review the context snippets, then read only the specific documents that matter in full.
5. **Use your judgment** to evaluate what's clinically significant, iterate on your analysis, and refine your understanding
6. **Synthesize thoughtful answers** based on your exploration of the data

This approach is important because:
- Attachments can easily consume your entire context window if loaded carelessly
- Structured FHIR data already contains most lab values, diagnoses, and medications — attachments add clinical narratives and assessments
- You can see intermediate results, catch errors, and improve your analysis
- You can apply clinical reasoning as you explore, not just execute blind code
- Complex health questions often require iterative investigation

**If the user wants a live artifact/app**, pre-processing is still valuable:
- Do your exploratory analysis first
- Identify the key data points and insights
- Then build the artifact with pre-processed results or focused queries
- This avoids shipping analysis code you can't see or debug
