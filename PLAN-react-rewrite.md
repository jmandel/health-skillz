# Plan: React + Zustand Rewrite

## Goal
Rewrite the web frontend (landing page, connect wrapper) as a React SPA with Zustand state management.

## Current State
- `templates/index.html` - Static landing page
- `templates/connect.html` - Session wrapper with vanilla JS (encryption, postMessage handling)
- `static/ehr-connect/*` - EHR connector (keep as-is, from health-record-mcp)

## Proposed Structure

```
web/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Router setup
│   ├── store/
│   │   └── sessionStore.ts      # Zustand store for session state
│   ├── lib/
│   │   └── crypto.ts            # E2E encryption helpers
│   ├── pages/
│   │   ├── HomePage.tsx         # Landing page (/ route)
│   │   └── ConnectPage.tsx      # Connect wrapper (/connect/:sessionId)
│   ├── components/
│   │   ├── ProviderList.tsx     # Connected providers display
│   │   ├── StatusMessage.tsx    # Loading/error/success states
│   │   └── Button.tsx           # Styled button component
│   └── styles/
│       └── globals.css          # Tailwind or vanilla CSS
├── index.html                   # Vite entry HTML
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Zustand Store Shape

```typescript
interface SessionStore {
  // State
  sessionId: string | null;
  publicKey: JsonWebKey | null;
  connectedProviders: { name: string; connectedAt: string }[];
  status: 'idle' | 'connecting' | 'encrypting' | 'sending' | 'done' | 'error';
  error: string | null;
  
  // Actions
  setSession: (id: string, publicKey: JsonWebKey) => void;
  addProvider: (name: string) => void;
  setStatus: (status: Status) => void;
  setError: (error: string) => void;
  reset: () => void;
}
```

## Key Components

### HomePage
- Marketing copy
- Download skill button
- Architecture diagram
- Developer docs

### ConnectPage
- Reads sessionId from URL params
- Fetches public key from server (or receives via template)
- Opens ehretriever popup
- Listens for postMessage
- Encrypts data using crypto.ts
- POSTs to /api/data/:id
- Shows provider list, add more / done buttons

### crypto.ts
```typescript
export async function encryptData(
  data: any, 
  publicKeyJwk: JsonWebKey
): Promise<EncryptedPayload>;
```

## Server Changes

1. Build React app to `dist/` 
2. Serve `dist/` for `/` and `/connect/*` routes
3. Keep `/ehr-connect/*` serving from `static/ehr-connect/`
4. Keep API routes unchanged

## Build Process

```bash
# Development
cd web && bun run dev

# Production build
cd web && bun run build
# Output to ../dist/

# Server serves dist/ for web routes
```

## Migration Steps

1. Create `web/` directory with Vite + React + TypeScript setup
2. Install dependencies: `react`, `react-dom`, `react-router-dom`, `zustand`
3. Extract crypto logic from connect.html → `lib/crypto.ts`
4. Create Zustand store
5. Build HomePage (port from index.html)
6. Build ConnectPage (port logic from connect.html)
7. Update server.ts to serve built React app
8. Remove old templates/ files
9. Update build scripts in package.json

## Testing

- Verify landing page renders
- Verify /connect/:id loads with session
- Verify popup opens ehretriever
- Verify postMessage received and encrypted
- Verify data POSTed successfully
- Verify provider list updates
- Verify finalize flow works
- E2E test with Epic sandbox

## Not Changing

- `/ehr-connect/*` static files (health-record-mcp build output)
- API endpoints
- Server-side session/encryption logic
- SKILL.md, DESIGN.md content
