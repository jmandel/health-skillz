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

# Install & Build
bun install
bun run setup  # Downloads brands, builds connector, packages skill

# Run
bun run start
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
      "redirectURL": "https://your-domain.com/ehr-connect/callback",
      "note": "Test credentials: fhircamila / epicepic1"
    }
  ]
}
```

## Registering a SMART on FHIR App

To use with real EHRs, register your app:

1. **Epic**: https://fhir.epic.com/Developer/Apps
2. Set redirect URI to: `https://your-domain.com/ehr-connect/ehretriever.html`
3. Request scopes: `patient/*.rs`
4. Add the client ID to your config.json

## Project Structure

```
health-skillz/
├── src/
│   └── server.ts         # Bun server
├── scripts/
│   ├── download-brands.ts    # Fetch Epic endpoint directory
│   ├── build-connector.ts    # Build EHR connector
│   └── package-skill.ts      # Package Claude skill
├── templates/
│   ├── index.html        # Homepage
│   └── connect.html      # Connection wrapper page
├── skill/
│   └── health-record-assistant/
│       ├── SKILL.md      # Claude skill definition
│       └── references/
│           └── FHIR-GUIDE.md
├── brands/               # Processed endpoint data
├── static/
│   └── ehr-connect/      # Built EHR connector
└── config.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create new session |
| `/api/poll/{id}` | GET | Poll for health data |
| `/api/data/{id}` | POST | Receive data from connector |
| `/connect/{id}` | GET | User-facing connection page |
| `/skill.zip` | GET | Download Claude skill |
| `/health-record-assistant.md` | GET | View skill markdown |

## How It Works

1. Claude creates a session via POST `/api/session`
2. User clicks the returned `userUrl`
3. User authenticates with their patient portal
4. EHR connector fetches FHIR data via SMART on FHIR
5. Data is sent back via postMessage to wrapper page
6. Wrapper page POSTs data to `/api/data/{id}`
7. Claude polls `/api/poll/{id}` until data is ready
8. Claude analyzes the FHIR data

## License

MIT
