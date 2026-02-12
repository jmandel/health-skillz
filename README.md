# Health Skillz

A Claude Skill for analyzing personal health records via SMART on FHIR.

## Try It Now

A live instance is running at **[health-skillz.joshuamandel.com](https://health-skillz.joshuamandel.com)**. To use it:

1. **Download the skill:** [health-record-assistant.zip](https://health-skillz.joshuamandel.com/skill.zip)
2. **Install in Claude:** Settings → Skills → Upload the zip file
3. **Ask Claude:** "Can you look at my health records?"

Claude will create a secure session and give you a link to connect your patient portal. Currently supports **Epic** health systems (most major US hospitals).

**For testing**, use Epic's sandbox:
- Username: `fhircamila`
- Password: `epicepic1`

## What It Does

- **Full data sync**: Pulls all your FHIR resources—labs, meds, conditions, procedures, immunizations, encounters
- **Clinical notes**: Extracts full text from visit notes, discharge summaries, and other documents
- **Multi-provider**: Connect multiple health systems in one session for comprehensive analysis
- **End-to-end encrypted**: Data is encrypted in your browser before transmission; only Claude can decrypt it
- **Download your data**: Get a complete JSON export of your records

## How It Works

```
1. You: "Can you look at my health records?"

2. Claude: Creates encrypted session, shows you a link

3. You: Click link → sign into patient portal → authorize → choose records → click "Send ... to AI"

4. Claude: Decrypts data, explores it, answers your questions
```

Claude analyzes your data iteratively—reading notes, querying structured data, applying clinical reasoning—rather than running blind analysis in a sandbox.

---

## For Developers

Want to deploy your own instance? Read on.

### Quick Start

```bash
git clone https://github.com/jmandel/health-skillz
cd health-skillz

# Configure
cp config.json.example config.json
# Edit config.json with your SMART on FHIR client IDs

# Install & Setup
bun install
bun run setup          # Downloads Epic endpoint directory + builds skill zip
mkdir -p static data
ln -sf "$(pwd)/brands" static/brands

# Run
bun run dev            # Development with hot reload
bun run start          # Production

# Override port/base URL with environment variables:
# PORT=3005 BASE_URL=http://localhost:3005 bun run dev
```

### Configuration

Edit `config.json` (production) or create `config.local.json` (local dev):

```json
{
  "server": {
    "port": 8000,
    "baseURL": "https://your-domain.com"
  },
  "brands": [
    {
      "name": "epic-sandbox",
      "file": "./brands/epic-sandbox.json",
      "clientId": "YOUR_SANDBOX_CLIENT_ID",
      "scopes": "patient/*.rs",
      "redirectURL": "https://your-domain.com/connect/callback"
    },
    {
      "name": "epic-prod",
      "file": "./brands/epic-prod.json",
      "clientId": "YOUR_PROD_CLIENT_ID",
      "scopes": "patient/*.rs",
      "redirectURL": "https://your-domain.com/connect/callback"
    }
  ]
}
```

**Key fields:**
- `server.port` — HTTP port (also overridable via `PORT` env var)
- `server.baseURL` — Public URL (also overridable via `BASE_URL` env var)
- `brands[].redirectURL` — OAuth callback URL registered with the EHR vendor. Defaults to `${baseURL}/connect/callback` if omitted. Must exactly match what's registered in your SMART on FHIR app.

To use a local config: `CONFIG_PATH=./config.local.json bun run dev`

### Registering a SMART on FHIR App

To use with real EHRs, register your app with each vendor:

1. **Epic**: https://fhir.epic.com/Developer/Apps
2. Set redirect URI to: `https://your-domain.com/connect/callback`
3. Request scopes: `patient/*.rs`
4. Add the client ID to your config.json

Epic sandbox apps are approved instantly. Production apps require a brief review.

### Project Structure

```
health-skillz/
├── src/
│   ├── server.ts           # Bun server with API routes
│   ├── index.html          # HTML entry point
│   └── client/             # React frontend
│       ├── App.tsx         # React Router setup
│       ├── pages/          # HomePage, ConnectPage, ProviderSelectPage, OAuthCallbackPage
│       ├── components/     # ProviderSearch, ProviderCard, StatusMessage
│       ├── lib/            # SMART OAuth, FHIR client, crypto, storage
│       └── store/          # Zustand state management
├── scripts/
│   ├── download-brands.ts  # Fetch Epic endpoint directory
│   └── package-skill.ts    # Package Claude skill zip
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md            # Claude skill instructions
│       ├── scripts/            # create-session.mjs, finalize-session.mjs
│       └── references/         # FHIR-GUIDE.md
├── static/brands/          # Epic endpoint directory JSON
└── config.json             # Server + SMART client configuration
```

### API Endpoints

**Called by Claude (skill scripts):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create session (sends ECDH public key) |
| `/api/poll/{id}` | GET | Long-poll for encrypted health data |

**Called by Browser (React app):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session/{id}` | GET | Get session info + public key + pending chunk state + active attempt metadata |
| `/api/upload/start/{id}` | POST | Start or restart an upload attempt (locks selected providers) |
| `/api/upload/reset/{id}` | POST | Discard partial upload state for current session |
| `/api/receive-ehr` | POST | Send encrypted chunk data (requires `attemptId`) |
| `/api/finalize/{id}` | POST | Finalize active attempt after upload (requires `attemptId`) |

**Other:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/skill.zip` | GET | Download packaged Claude skill |

### Architecture

- **Bun fullstack**: Server + React bundled together
- **E2E encryption**: ECDH key exchange, AES-256-GCM; server never sees plaintext
- **SMART on FHIR**: OAuth + FHIR fetching happens entirely client-side
- **No intermediaries**: Direct connection from browser to EHR FHIR server

## License

MIT
