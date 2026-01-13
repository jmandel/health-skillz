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
- **End-to-end encrypted**: Data is encrypted in your browser before transmission; only Claude can decrypt it
- **Download your data**: Get a complete JSON export of your records

## How It Works

```
1. You: "Can you look at my health records?"

2. Claude: Creates encrypted session, shows you a link

3. You: Click link → sign into patient portal → authorize → click "Done"

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
bun run setup  # Downloads Epic endpoint directory

# Run
bun run dev    # Development with hot reload
bun run start  # Production
```

### Configuration

Edit `config.json`:

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
      "scopes": "patient/*.rs"
    },
    {
      "name": "epic-prod",
      "file": "./brands/epic-prod.json",
      "clientId": "YOUR_PROD_CLIENT_ID",
      "scopes": "patient/*.rs"
    }
  ]
}
```

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
│   ├── server.ts         # Bun server with API routes
│   └── client/           # React frontend
│       ├── pages/        # Route components  
│       ├── lib/          # SMART OAuth, FHIR client, crypto
│       └── store/        # Zustand state
├── scripts/
│   ├── download-brands.ts    # Fetch Epic endpoint directory
│   └── package-skill.ts      # Package Claude skill
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md          # Claude skill instructions
│       ├── scripts/          # create-session.ts, finalize-session.ts
│       └── references/       # FHIR-GUIDE.md
└── config.json
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create session (requires ECDH publicKey) |
| `/api/session/{id}` | GET | Get session info + vendor config |
| `/api/poll/{id}` | GET | Long-poll for encrypted health data |
| `/api/receive-ehr` | POST | Receive encrypted EHR data from browser |
| `/api/finalize/{id}` | POST | Mark session complete |
| `/skill.zip` | GET | Download packaged Claude skill |

### Architecture

- **Bun fullstack**: Server + React bundled together
- **E2E encryption**: ECDH key exchange, AES-256-GCM; server never sees plaintext
- **SMART on FHIR**: OAuth + FHIR fetching happens entirely client-side
- **No intermediaries**: Direct connection from browser to EHR FHIR server

## License

MIT
