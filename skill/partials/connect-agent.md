## How to Connect

Helper scripts are provided in `scripts/` to simplify the workflow.

**Prerequisites:** These scripts require [Bun](https://bun.sh) to be installed:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 1: Create a Session

```bash
bun scripts/create-session.ts
```

Output:
```json
{
  "sessionId": "abc123...",
  "userUrl": "https://health-skillz.exe.xyz/connect/abc123...",
  "pollUrl": "https://health-skillz.exe.xyz/api/poll/abc123...",
  "privateKeyJwk": { "kty": "EC", "crv": "P-256", "d": "...", ... }
}
```

**Save the `privateKeyJwk`** - you'll need it to decrypt the data.

### Step 2: Show the User a Link

Present `userUrl` to the user as a clickable link:

> **To access your health records, please click this link:**
>
> [Connect Your Health Records]({userUrl})
>
> You'll sign into your patient portal (like Epic MyChart), and your records will be securely transferred for analysis.
> 
> 🔒 Your data is end-to-end encrypted - only this conversation can decrypt it.

### Step 3: Finalize and Decrypt

Once the user has connected their provider(s) and clicked "Done - Send to AI":

```bash
bun scripts/finalize-session.ts <sessionId> '<privateKeyJwk>' ./health-data
```

This script:
1. Polls until data is ready (outputs JSON status lines while waiting)
2. Decrypts each provider's data
3. Writes one JSON file per provider:

Example output:
```
{"status":"polling","sessionId":"abc123..."}
{"status":"waiting","sessionStatus":"collecting","providerCount":1,"attempt":1}
{"status":"ready","providerCount":1}
{"status":"decrypting"}
{"status":"wrote_file","file":"./health-data/unitypoint-health.json","provider":"UnityPoint Health","resources":277,"attachments":82}
{"status":"done","files":["./health-data/unitypoint-health.json"]}
```

Result:

```
health-data/
  unitypoint-health.json
  mayo-clinic.json
```
