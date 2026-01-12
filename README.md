# Health Skillz

A Claude Skill for analyzing personal health records via SMART on FHIR.

## What is this?

Health Record Assistant is a Claude Skill that enables Claude to securely fetch and analyze your electronic health records directly from your healthcare provider's patient portal (like Epic MyChart).

## Quick Start

```bash
# Clone
git clone https://github.com/jmandel/health-skillz
cd health-skillz

# Configure
cp config.json.example config.json
# Edit config.json with your SMART on FHIR client IDs

# Install & Setup
bun install
bun run setup  # Downloads brands, packages skill

# Run
bun run dev    # Development with hot reload
bun run start  # Production
```

## Configuration

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
      "tags": ["epic", "sandbox"],
      "clientId": "YOUR_CLIENT_ID",
      "scopes": "patient/*.rs",
      "redirectURL": "https://your-domain.com/connect/callback"
    }
  ]
}
```

## Registering a SMART on FHIR App

To use with real EHRs, register your app:

1. **Epic**: https://fhir.epic.com/Developer/Apps
2. Set redirect URI to: `https://your-domain.com/connect/callback`
3. Request scopes: `patient/*.rs`
4. Add the client ID to your config.json

## Project Structure

```
health-skillz/
├── src/
│   ├── server.ts         # Bun server with API routes
│   ├── index.html        # HTML entry (auto-bundled by Bun)
│   └── client/           # React frontend
│       ├── main.tsx
│       ├── App.tsx
│       ├── pages/        # Route components
│       ├── components/   # UI components
│       ├── lib/          # SMART OAuth, FHIR client, crypto
│       └── store/        # Zustand state
├── scripts/
│   ├── download-brands.ts    # Fetch Epic endpoint directory
│   └── package-skill.ts      # Package Claude skill
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md          # Claude skill definition
│       └── references/
├── brands/                   # Processed endpoint data
├── static/brands/            # Brand files served to frontend
└── config.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create new session (requires publicKey) |
| `/api/session/{id}` | GET | Get session info + vendor config |
| `/api/poll/{id}` | GET | Long-poll for health data |
| `/api/receive-ehr` | POST | Receive encrypted EHR data |
| `/api/finalize/{id}` | POST | Mark session complete |
| `/connect/{id}` | GET | User connection page |
| `/connect/{id}/select` | GET | Provider search page |
| `/connect/{id}/callback` | GET | OAuth callback |
| `/skill.zip` | GET | Download Claude skill |

## How It Works

1. Claude creates a session via POST `/api/session` with ECDH public key
2. User clicks the returned `userUrl` → React app loads
3. User searches for their healthcare provider
4. User authenticates via SMART on FHIR OAuth
5. React app fetches FHIR data directly from EHR
6. Data is encrypted client-side with session public key
7. Encrypted data POSTed to `/api/receive-ehr`
8. Claude polls `/api/poll/{id}` until data ready
9. Claude decrypts and analyzes the FHIR data

## Architecture

- **Bun fullstack**: Server imports HTML, Bun auto-bundles React/CSS
- **E2E encryption**: Data encrypted in browser, server never sees plaintext
- **SMART on FHIR**: OAuth + FHIR fetching happens client-side
- **No external dependencies**: Native EHR retrieval, no health-record-mcp

## License

MIT
