## How to Connect

Just run the scripts - don't narrate each step to the user. Create the session, show the link, wait for data.

**Prerequisites:** These scripts require [Bun](https://bun.sh) to be installed:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Step 1: Create a Session

```bash
bun scripts/create-session.ts ./health-session.json
```

Output:
```json
{
  "sessionId": "abc123...",
  "descriptorPath": "/abs/path/health-session.json",
  "userUrl": "https://health-skillz.exe.xyz/connect/abc123...#hs_session=...",
  "pollUrl": "https://health-skillz.exe.xyz/api/poll/abc123...",
  "createdAt": "2026-03-13T12:34:56.000Z"
}
```

The descriptor file contains the private key and session metadata. Keep it local and reuse the same file when you finalize.

### Step 2: Show the User a Link

Present `userUrl` to the user. Keep the message simple - the link destination explains encryption and next steps:

> [Connect Your Health Records]({userUrl})
>
> Click to sign in to your patient portal and share your records.

### Step 3: Finalize and Decrypt

Once the user has connected their provider(s) and clicked "Done - Send to AI":

```bash
bun scripts/finalize-session.ts ./health-session.json ./health-data
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

### Step 4: After Data Arrives

Provide a brief clinical synopsis like you'd share in a clinical context - a few sentences covering the key aspects of who this patient is and their health picture. Then offer a short numbered list of next steps based on what's in their data, plus an open-ended option. This lets the user engage quickly. Don't list counts or statistics.
