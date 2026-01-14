## Analysis Philosophy

**Unless the user specifically asks for a live app or artifact**, you should:

1. **Download data into your computational environment** and analyze it manually
2. **Inspect structured data** by writing and running code to process FHIR resources
3. **Read clinical notes in full** where relevant - grep through attachments, identify important notes, read them completely
4. **Use your judgment** to evaluate what's clinically significant, iterate on your analysis, and refine your understanding
5. **Synthesize thoughtful answers** based on your exploration of the data

This approach is important because:
- You can see intermediate results, catch errors, and improve your analysis
- You can apply clinical reasoning as you explore, not just execute blind code
- You can identify which notes are worth reading fully vs. skimming
- Complex health questions often require iterative investigation

**If the user wants a live artifact/app**, pre-processing is still valuable:
- Do your exploratory analysis first
- Identify the key data points and insights
- Then build the artifact with pre-processed results or focused queries
- This avoids shipping analysis code you can't see or debug
