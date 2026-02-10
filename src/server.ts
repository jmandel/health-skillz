import { Database } from "bun:sqlite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

// Import HTML for Bun's fullstack server - serves the React SPA
import homepage from "./index.html";

// Import skill builder
import { buildAgentSkill, buildLocalSkill } from "../skill/build-skill";

// Load config
const configPath = process.env.CONFIG_PATH || "./config.json";
const config = JSON.parse(readFileSync(configPath, "utf-8"));

if (process.env.BASE_URL) {
  config.server.baseURL = process.env.BASE_URL;
}

const baseURL = config.server.baseURL.replace(/\/$/, "");
const port = Number(process.env.PORT) || config.server.port || 8000;

// Initialize SQLite database
const db = new Database("./data/health-skillz.db", { create: true });
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch()),
    providers TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    public_key TEXT,
    encrypted_data TEXT,
    finalize_token TEXT
  )
`);

// Migrations
const migrations = [
  "ALTER TABLE sessions ADD COLUMN providers TEXT DEFAULT '[]'",
  "ALTER TABLE sessions ADD COLUMN public_key TEXT",
  "ALTER TABLE sessions ADD COLUMN encrypted_data TEXT",
  "ALTER TABLE sessions ADD COLUMN finalize_token TEXT",
  "ALTER TABLE sessions ADD COLUMN simulate_error TEXT",
];
for (const sql of migrations) {
  try { db.run(sql); } catch (e) { /* Column already exists */ }
}

// Cleanup expired sessions (every 5 min)
const timeoutMs = (config.session?.timeoutMinutes || 60) * 60 * 1000;
setInterval(() => {
  const cutoff = Math.floor((Date.now() - timeoutMs) / 1000);
  db.run("DELETE FROM sessions WHERE created_at < ?", [cutoff]);
}, 5 * 60 * 1000);

// Vacuum hourly to reclaim space
setInterval(() => {
  db.run("VACUUM");
}, 60 * 60 * 1000);

// Generate session ID
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Build skill zip (agent version with scripts)
async function buildSkillZip(): Promise<Response> {
  const scriptsDir = "./skill/health-record-assistant/scripts";
  const refsDir = "./skill/health-record-assistant/references";

  const { $ } = await import("bun");
  const tempDir = `/tmp/skill-build-${Date.now()}`;

  try {
    await $`mkdir -p ${tempDir}/health-record-assistant/references ${tempDir}/health-record-assistant/scripts`;

    // Build SKILL.md from partials
    const skillMd = buildAgentSkill(baseURL);
    await Bun.write(`${tempDir}/health-record-assistant/SKILL.md`, skillMd);

    // Copy references
    if (existsSync(refsDir)) {
      for (const file of readdirSync(refsDir)) {
        let content = readFileSync(join(refsDir, file), "utf-8");
        content = content.replaceAll("{{BASE_URL}}", baseURL);
        await Bun.write(`${tempDir}/health-record-assistant/references/${file}`, content);
      }
    }

    // Copy scripts (agent-only)
    if (existsSync(scriptsDir)) {
      for (const file of readdirSync(scriptsDir)) {
        let content = readFileSync(join(scriptsDir, file), "utf-8");
        content = content.replaceAll("{{BASE_URL}}", baseURL);
        await Bun.write(`${tempDir}/health-record-assistant/scripts/${file}`, content);
      }
    }

    await $`cd ${tempDir} && zip -r skill.zip health-record-assistant/`;
    const zipData = await Bun.file(`${tempDir}/skill.zip`).arrayBuffer();
    await $`rm -rf ${tempDir}`;

    return new Response(zipData, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=health-record-assistant.zip",
      },
    });
  } catch (e) {
    console.error("Error building skill zip:", e);
    await $`rm -rf ${tempDir}`.catch(() => {});
    return new Response("Failed to build skill", { status: 500 });
  }
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Build vendor configs from config.brands
function getVendors() {
  const vendors: Record<string, any> = {};
  for (const brand of config.brands || []) {
    // Use brand name as vendor key to keep sandbox/prod separate
    const vendorName = brand.name;
    const brandFile = brand.file?.replace('./brands/', '/static/brands/') || `/static/brands/${brand.name}.json`;
    
    vendors[vendorName] = {
      clientId: brand.clientId,
      scopes: brand.scopes || 'patient/*.rs',
      brandFiles: [brandFile],
      tags: brand.tags || [],
      redirectUrl: brand.redirectURL || `${baseURL}/connect/callback`,
    };
  }
  
  // Add synthetic test data provider (various sizes)
  for (const size of [1, 10, 50, 100]) {
    vendors[`__test_${size}mb__`] = {
      clientId: 'test',
      scopes: 'patient/*.rs',
      brandFiles: [`/test/${size}mb/brand.json`],
      tags: ['test'],
      redirectUrl: `${baseURL}/connect/callback`,
      testProvider: true,
      testSizeMB: size,
    };
  }
  
  return vendors;
}

// Main server with Bun routes
const server = Bun.serve({
  port,
  development: process.env.NODE_ENV !== 'production',
  maxRequestBodySize: 1024 * 1024 * 1024, // 1GB (default is 128MB)

  routes: {
    // SPA routes - all handled by React Router
    "/": homepage,
    // Agent-initiated flow
    "/connect/:sessionId": homepage,
    "/connect/:sessionId/select": homepage,
    "/connect/:sessionId/callback": homepage,
    // OAuth callback - single URL, page detects local vs agent session
    "/connect/callback": homepage,
    // Self-service collection flow
    "/collect": homepage,
    "/collect/select": homepage,
  },

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API: Create session
    if (path === "/api/session" && req.method === "POST") {
      let publicKey: string | null = null;
      let simulateError: string | null = null;
      try {
        const body = await req.json() as { publicKey?: any; simulateError?: string };
        if (body.publicKey) {
          publicKey = JSON.stringify(body.publicKey);
        }
        // Optional: simulate errors for testing (500, timeout, badresp, disconnect)
        if (body.simulateError && ['500', 'timeout', 'badresp', 'disconnect'].includes(body.simulateError)) {
          simulateError = body.simulateError;
        }
      } catch (e) {}

      if (!publicKey) {
        return Response.json({
          error: "public_key_required",
          error_description: "E2E encryption required. Provide publicKey (ECDH P-256 JWK)."
        }, { status: 400, headers: corsHeaders });
      }

      const sessionId = generateSessionId();
      db.run("INSERT INTO sessions (id, public_key, simulate_error) VALUES (?, ?, ?)", [sessionId, publicKey, simulateError]);
      console.log(`Created session: ${sessionId}${simulateError ? ` (simulating ${simulateError} error)` : ''}`);

      return Response.json({
        sessionId,
        userUrl: `${baseURL}/connect/${sessionId}`,
        pollUrl: `${baseURL}/api/poll/${sessionId}`,
      }, { headers: corsHeaders });
    }

    // API: Poll for data
    if (path.startsWith("/api/poll/") && req.method === "GET") {
      const sessionId = path.replace("/api/poll/", "");
      const timeout = Math.min(parseInt(url.searchParams.get("timeout") || "30"), 60) * 1000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const row = db.query("SELECT status, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
        if (!row) {
          return new Response("Session not found", { status: 404, headers: corsHeaders });
        }

        const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        if (row.status === "finalized" && encryptedData.length > 0) {
          return Response.json({
            ready: true,
            encryptedProviders: encryptedData,
            providerCount: encryptedData.length
          }, { headers: corsHeaders });
        }

        await new Promise(r => setTimeout(r, 500));
      }

      const row = db.query("SELECT status, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) return new Response("Session not found", { status: 404, headers: corsHeaders });
      const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];

      return Response.json({
        ready: false,
        status: row.status,
        providerCount: encryptedData.length,
      }, { headers: corsHeaders });
    }

    // API: Receive encrypted EHR data (also sets finalizeToken on first call)
    if (path === "/api/receive-ehr" && req.method === "POST") {
      try {
        const data = await req.json() as any;
        
        // Validate common fields
        if (!data.sessionId) {
          return Response.json({ success: false, error: "missing_session_id" }, { status: 400, headers: corsHeaders });
        }
        if (!data.finalizeToken || typeof data.finalizeToken !== "string" || data.finalizeToken.length < 16) {
          return Response.json({ success: false, error: "missing_finalize_token" }, { status: 400, headers: corsHeaders });
        }
        
        // Validate version-specific fields
        const isV3 = data.version === 3;
        if (isV3) {
          if (!data.chunk || typeof data.chunk.index !== 'number' || !data.chunk.ephemeralPublicKey || !data.chunk.iv || !data.chunk.ciphertext) {
            return Response.json({ success: false, error: "missing_chunk_fields" }, { status: 400, headers: corsHeaders });
          }
          // totalChunks: -1 means "unknown, more coming", positive means final count
          if (typeof data.totalChunks !== 'number' || (data.totalChunks < 1 && data.totalChunks !== -1)) {
            return Response.json({ success: false, error: "invalid_total_chunks" }, { status: 400, headers: corsHeaders });
          }
        } else {
          if (!data.encrypted || !data.ephemeralPublicKey || !data.iv || !data.ciphertext) {
            return Response.json({ success: false, error: "missing_fields" }, { status: 400, headers: corsHeaders });
          }
        }

        const row = db.query("SELECT encrypted_data, status, finalize_token, simulate_error FROM sessions WHERE id = ?").get(data.sessionId) as any;
        if (!row) return Response.json({ success: false, error: "session_not_found" }, { status: 404, headers: corsHeaders });
        if (row.status === "finalized") return Response.json({ success: false, error: "session_finalized" }, { status: 400, headers: corsHeaders });

        // Test error simulation (set via simulateError when creating session)
        if (row.simulate_error) {
          const simErr = row.simulate_error;
          const errorId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          console.log(`[TEST] Simulating ${simErr} error for session ${data.sessionId}, errorId: ${errorId}`);
          
          if (simErr === '500') {
            return Response.json({ success: false, error: "simulated_server_error", errorId }, { status: 500, headers: corsHeaders });
          }
          if (simErr === 'timeout') {
            await new Promise(r => setTimeout(r, 35000));
            return Response.json({ success: false, error: "simulated_timeout", errorId }, { status: 504, headers: corsHeaders });
          }
          if (simErr === 'badresp') {
            return new Response("not valid json {{{", { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (simErr === 'disconnect') {
            throw new Error("Simulated connection reset");
          }
        }

        // Verify or set the finalize token
        if (row.finalize_token && row.finalize_token !== data.finalizeToken) {
          return Response.json({ success: false, error: "token_mismatch" }, { status: 403, headers: corsHeaders });
        }

        const existing = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        
        if (isV3) {
          // v3 chunked upload - find or create provider entry
          // Each provider gets an entry with version:3 and chunks array
          // We use a temporary ID based on finalizeToken to group chunks
          const chunkGroupId = `chunked_${data.finalizeToken.slice(0, 8)}`;
          let providerEntry = existing.find((e: any) => e._chunkGroupId === chunkGroupId);
          
          if (!providerEntry) {
            providerEntry = {
              _chunkGroupId: chunkGroupId,
              version: 3,
              totalChunks: data.totalChunks, // -1 if unknown
              chunks: [],
            };
            existing.push(providerEntry);
          } else if (data.totalChunks > 0) {
            // Update totalChunks when we finally know it
            providerEntry.totalChunks = data.totalChunks;
          }
          
          // Add chunk (avoid duplicates)
          const chunkIndex = data.chunk.index;
          if (!providerEntry.chunks.find((c: any) => c.index === chunkIndex)) {
            providerEntry.chunks.push({
              index: chunkIndex,
              ephemeralPublicKey: data.chunk.ephemeralPublicKey,
              iv: data.chunk.iv,
              ciphertext: data.chunk.ciphertext,
            });
          }
          
          // Sort chunks by index
          providerEntry.chunks.sort((a: any, b: any) => a.index - b.index);
          
          const receivedChunks = providerEntry.chunks.length;
          const knownTotal = providerEntry.totalChunks > 0 ? providerEntry.totalChunks : '?';
          const isComplete = providerEntry.totalChunks > 0 && receivedChunks === providerEntry.totalChunks;
          
          // Remove temp groupId when complete
          if (isComplete) {
            delete providerEntry._chunkGroupId;
          }
          
          console.log(`Received chunk ${chunkIndex + 1}/${knownTotal} for ${data.sessionId} (${receivedChunks}/${knownTotal} complete)`);
        } else {
          // v1/v2 single payload
          // Convert base64 to number arrays if needed (browser sends base64 for smaller payload)
          const iv = typeof data.iv === 'string' 
            ? Array.from(Uint8Array.from(atob(data.iv), c => c.charCodeAt(0)))
            : data.iv;
          const ciphertext = typeof data.ciphertext === 'string'
            ? Array.from(Uint8Array.from(atob(data.ciphertext), c => c.charCodeAt(0)))
            : data.ciphertext;

          existing.push({
            ephemeralPublicKey: data.ephemeralPublicKey,
            iv,
            ciphertext,
            version: data.version || 1,  // v1 = uncompressed, v2 = gzip compressed
          });
          
          console.log(`Received EHR data for ${data.sessionId} (${existing.length} providers)`);
        }

        db.run("UPDATE sessions SET encrypted_data = ?, status = 'collecting', finalize_token = ? WHERE id = ?",
          [JSON.stringify(existing), data.finalizeToken, data.sessionId]);

        return Response.json({
          success: true,
          providerCount: existing.length,
          redirectTo: `${baseURL}/connect/${data.sessionId}?provider_added=true`
        }, { headers: corsHeaders });
      } catch (e) {
        const errorId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        console.error(`[SERVER ERROR] ${errorId}:`, e);
        return Response.json({ success: false, error: "processing_error", errorId }, { status: 500, headers: corsHeaders });
      }
    }

    // API: Finalize session (requires finalize token that only the browser knows)
    if (path.startsWith("/api/finalize/") && req.method === "POST") {
      const sessionId = path.replace("/api/finalize/", "");
      let body: any = {};
      try { body = await req.json(); } catch (e) {}

      const row = db.query("SELECT status, encrypted_data, finalize_token FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) return new Response("Session not found", { status: 404, headers: corsHeaders });
      if (!row.finalize_token) {
        return Response.json({ error: "not_claimed", error_description: "Session must be claimed by a browser first" }, { status: 400, headers: corsHeaders });
      }
      if (body.finalizeToken !== row.finalize_token) {
        return Response.json({ error: "invalid_token", error_description: "Valid finalizeToken required" }, { status: 403, headers: corsHeaders });
      }
      if (row.status === "finalized") return Response.json({ success: true, alreadyFinalized: true }, { headers: corsHeaders });

      const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
      if (encryptedData.length === 0) return new Response("No providers connected", { status: 400, headers: corsHeaders });

      db.run("UPDATE sessions SET status = 'finalized' WHERE id = ?", [sessionId]);
      console.log(`Finalized session ${sessionId}`);
      return Response.json({ success: true, providerCount: encryptedData.length }, { headers: corsHeaders });
    }

    // API: Get session info
    if (path.startsWith("/api/session/") && req.method === "GET") {
      const sessionId = path.replace("/api/session/", "");
      const row = db.query("SELECT status, public_key, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) return new Response("Session not found", { status: 404, headers: corsHeaders });

      const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
      
      // Include chunk upload progress for v3 uploads
      let pendingChunks: { receivedChunks: number[]; totalChunks: number } | null = null;
      const pendingProvider = encryptedData.find((e: any) => e._chunkGroupId);
      if (pendingProvider) {
        pendingChunks = {
          receivedChunks: pendingProvider.chunks?.map((c: any) => c.index) || [],
          totalChunks: pendingProvider.totalChunks || -1,
        };
      }
      
      return Response.json({
        sessionId,
        publicKey: row.public_key ? JSON.parse(row.public_key) : null,
        status: row.status,
        providerCount: encryptedData.length,
        pendingChunks,
      }, { headers: corsHeaders });
    }

    // API: Get vendor configs (for local collection without a session)
    if (path === "/api/vendors" && req.method === "GET") {
      return Response.json(getVendors(), { headers: corsHeaders });
    }

    // Skill markdown (agent version)
    if (path === "/health-record-assistant.md") {
      const content = buildAgentSkill(baseURL);
      return new Response(content, { headers: { "Content-Type": "text/markdown" } });
    }

    // Local skill template (for browser-side zip creation)
    if (path === "/api/skill-template") {
      const skillMd = buildLocalSkill();
      const refsDir = "./skill/health-record-assistant/references";
      const references: Record<string, string> = {};
      
      if (existsSync(refsDir)) {
        for (const file of readdirSync(refsDir)) {
          references[file] = readFileSync(join(refsDir, file), "utf-8");
        }
      }
      
      return Response.json({
        skillMd,
        references,
      }, { headers: corsHeaders });
    }

    // Skill zip (agent version)
    if (path === "/skill.zip") {
      return await buildSkillZip();
    }

    // API: Log client-side error (non-sensitive diagnostic info only)
    if (path === "/api/log-error" && req.method === "POST") {
      try {
        const body = await req.json() as {
          sessionId?: string;
          errorCode?: string;
          httpStatus?: number;
          context?: string;
          userAgent?: string;
        };
        
        // Sanitize and log - no sensitive data
        const logEntry = {
          time: new Date().toISOString(),
          sessionId: body.sessionId?.slice(0, 32) || 'unknown',
          errorCode: String(body.errorCode || 'unknown').slice(0, 100),
          httpStatus: typeof body.httpStatus === 'number' ? body.httpStatus : null,
          context: String(body.context || '').slice(0, 200),
          userAgent: String(body.userAgent || '').slice(0, 200),
        };
        
        console.log(`[CLIENT ERROR]`, JSON.stringify(logEntry));
        
        return Response.json({ logged: true, errorId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ logged: false }, { status: 400, headers: corsHeaders });
      }
    }

    // Test provider: all routes under /test/{size}mb/
    const testMatch = path.match(/^\/test\/(\d+)mb\/(.*)$/);
    if (testMatch) {
      const sizeMB = parseInt(testMatch[1]);
      const subPath = testMatch[2];
      
      // Brand file
      if (subPath === 'brand.json') {
        return Response.json({
          items: [{
            id: `test-synthetic-${sizeMB}mb`,
            displayName: `🧪 Test Data Generator (${sizeMB} MB)`,
            brandName: `Test Data ${sizeMB}MB`,
            itemType: 'brand',
            brandId: `test-${sizeMB}mb`,
            endpoints: [{
              url: `${baseURL}/test/${sizeMB}mb/fhir`,
              name: 'FHIR R4',
              connectionType: 'hl7-fhir-rest',
            }],
            searchName: `test data generator ${sizeMB}mb synthetic`,
          }],
          processedTimestamp: new Date().toISOString(),
        }, { headers: corsHeaders });
      }
      
      // SMART configuration
      if (subPath === 'fhir/.well-known/smart-configuration') {
        return Response.json({
          authorization_endpoint: `${baseURL}/test/${sizeMB}mb/authorize`,
          token_endpoint: `${baseURL}/test/${sizeMB}mb/token`,
          capabilities: ['launch-standalone', 'client-public', 'permission-patient'],
        }, { headers: corsHeaders });
      }
      
      // FHIR metadata
      if (subPath === 'fhir/metadata') {
        return Response.json({
          resourceType: 'CapabilityStatement',
          status: 'active',
          kind: 'instance',
          fhirVersion: '4.0.1',
          format: ['json'],
          rest: [{
            mode: 'server',
            security: {
              extension: [{
                url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
                extension: [
                  { url: 'authorize', valueUri: `${baseURL}/test/${sizeMB}mb/authorize` },
                  { url: 'token', valueUri: `${baseURL}/test/${sizeMB}mb/token` },
                ]
              }]
            }
          }]
        }, { headers: corsHeaders });
      }
      
      // OAuth authorize
      if (subPath === 'authorize') {
        const state = url.searchParams.get('state');
        const redirectUri = url.searchParams.get('redirect_uri');
        
        if (!state || !redirectUri) {
          return new Response('Missing state or redirect_uri', { status: 400 });
        }
        
        const code = `test_${sizeMB}mb_${Date.now()}`;
        return Response.redirect(`${redirectUri}?code=${code}&state=${state}`, 302);
      }
      
      // OAuth token
      if (subPath === 'token' && req.method === 'POST') {
        return Response.json({
          access_token: `test_token_${sizeMB}mb`,
          token_type: 'Bearer',
          expires_in: 3600,
          patient: `test-patient-${sizeMB}mb`,
          scope: 'patient/*.rs',
        }, { headers: corsHeaders });
      }
      
      // FHIR resources
      if (subPath.startsWith('fhir/')) {
        const resourcePath = subPath.replace('fhir/', '');
        
        // Patient resource
        if (resourcePath.startsWith('Patient/')) {
          return Response.json({
            resourceType: 'Patient',
            id: 'test-patient',
            name: [{ given: ['Test'], family: 'Patient' }],
            birthDate: '1990-01-01',
          }, { headers: corsHeaders });
        }
        
        // Only generate big data for DocumentReference (single resource type)
        // Other resource types return empty to avoid multiplying the data
        if (!resourcePath.startsWith('DocumentReference')) {
          return Response.json({
            resourceType: 'Bundle',
            type: 'searchset',
            total: 0,
            entry: [],
          }, { headers: corsHeaders });
        }
        
        // Generate synthetic bundle of requested size as DocumentReferences with inline data
        // Account for base64 expansion (4/3) and JSON overhead (~1.5x)
        // So for 100MB final, we need ~50MB of raw random data
        const targetBytes = Math.round(sizeMB * 1024 * 1024 / 3);
        const entries: any[] = [];
        let currentSize = 100;
        let resourceId = 0;
        
        while (currentSize < targetBytes) {
          const paddingSize = Math.min(50000, targetBytes - currentSize); // 50KB chunks
          const docRef = {
            resourceType: 'DocumentReference',
            id: `test-doc-${resourceId++}`,
            status: 'current',
            type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summary of episode note' }] },
            content: [{
              attachment: {
                contentType: 'text/plain',
                // Use random bytes so data doesn't compress
                data: Buffer.from(crypto.getRandomValues(new Uint8Array(paddingSize))).toString('base64'),
              }
            }],
          };
          entries.push({ resource: docRef });
          currentSize += JSON.stringify(docRef).length + 50;
        }
        
        console.log(`[TEST] Generated ${sizeMB}MB synthetic data: ${entries.length} DocumentReferences, ~${Math.round(currentSize/1024/1024)}MB`);
        
        return Response.json({
          resourceType: 'Bundle',
          type: 'searchset',
          total: entries.length,
          entry: entries,
        }, { headers: corsHeaders });
      }
    }

    // Health check
    if (path === "/health") {
      return new Response("ok");
    }

    // Static files with cache headers and gzip compression
    if (path.startsWith("/static/")) {
      const filePath = "." + path;
      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        const acceptEncoding = req.headers.get("Accept-Encoding") || "";
        
        // Compress JSON files if client supports gzip
        if (acceptEncoding.includes("gzip") && filePath.endsWith(".json")) {
          const content = await file.arrayBuffer();
          const compressed = Bun.gzipSync(new Uint8Array(content));
          return new Response(compressed, {
            headers: {
              "Cache-Control": "public, max-age=86400",
              "Content-Encoding": "gzip",
              "Content-Type": "application/json",
            },
          });
        }
        
        return new Response(file, {
          headers: {
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    // Legacy callback URL redirect (if any old links use /ehr-connect/callback)
    if (path === "/ehr-connect/callback") {
      return Response.redirect(`${baseURL}/connect/callback${url.search}`, 302);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health Skillz server running on http://localhost:${port}`);
console.log(`Base URL: ${baseURL}`);
