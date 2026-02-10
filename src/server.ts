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
      try {
        const body = await req.json() as { publicKey?: any };
        if (body.publicKey) {
          publicKey = JSON.stringify(body.publicKey);
        }
      } catch (e) {}

      if (!publicKey) {
        return Response.json({
          error: "public_key_required",
          error_description: "E2E encryption required. Provide publicKey (ECDH P-256 JWK)."
        }, { status: 400, headers: corsHeaders });
      }

      const sessionId = generateSessionId();
      db.run("INSERT INTO sessions (id, public_key) VALUES (?, ?)", [sessionId, publicKey]);
      console.log(`Created session: ${sessionId}`);

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
        // Test error injection: session IDs ending in special suffixes trigger errors
        const testBody = await req.clone().json() as any;
        const testSessionId = testBody?.sessionId || '';
        
        // -err-500: Immediate 500 error
        if (testSessionId.endsWith('-err-500')) {
          console.log(`[TEST] Simulating 500 error for session ${testSessionId}`);
          return Response.json({ success: false, error: "simulated_server_error" }, { status: 500, headers: corsHeaders });
        }
        
        // -err-timeout: Delay then timeout
        if (testSessionId.endsWith('-err-timeout')) {
          console.log(`[TEST] Simulating timeout for session ${testSessionId}`);
          await new Promise(r => setTimeout(r, 35000));
          return Response.json({ success: false, error: "simulated_timeout" }, { status: 504, headers: corsHeaders });
        }
        
        // -err-badresp: Malformed JSON response
        if (testSessionId.endsWith('-err-badresp')) {
          console.log(`[TEST] Simulating bad response for session ${testSessionId}`);
          return new Response("not valid json {{{", { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        // -err-disconnect: Close connection abruptly
        if (testSessionId.endsWith('-err-disconnect')) {
          console.log(`[TEST] Simulating disconnect for session ${testSessionId}`);
          throw new Error("Simulated connection reset");
        }
        const data = await req.json() as any;
        if (!data.sessionId || !data.encrypted || !data.ephemeralPublicKey || !data.iv || !data.ciphertext) {
          return Response.json({ success: false, error: "missing_fields" }, { status: 400, headers: corsHeaders });
        }
        if (!data.finalizeToken || typeof data.finalizeToken !== "string" || data.finalizeToken.length < 16) {
          return Response.json({ success: false, error: "missing_finalize_token" }, { status: 400, headers: corsHeaders });
        }

        const row = db.query("SELECT encrypted_data, status, finalize_token FROM sessions WHERE id = ?").get(data.sessionId) as any;
        if (!row) return Response.json({ success: false, error: "session_not_found" }, { status: 404, headers: corsHeaders });
        if (row.status === "finalized") return Response.json({ success: false, error: "session_finalized" }, { status: 400, headers: corsHeaders });

        // Verify or set the finalize token
        if (row.finalize_token && row.finalize_token !== data.finalizeToken) {
          return Response.json({ success: false, error: "token_mismatch" }, { status: 403, headers: corsHeaders });
        }

        // Convert base64 to number arrays if needed (browser sends base64 for smaller payload)
        const iv = typeof data.iv === 'string' 
          ? Array.from(Uint8Array.from(atob(data.iv), c => c.charCodeAt(0)))
          : data.iv;
        const ciphertext = typeof data.ciphertext === 'string'
          ? Array.from(Uint8Array.from(atob(data.ciphertext), c => c.charCodeAt(0)))
          : data.ciphertext;

        const existing = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        existing.push({
          ephemeralPublicKey: data.ephemeralPublicKey,
          iv,
          ciphertext,
          version: data.version || 1,  // v1 = uncompressed, v2 = gzip compressed
        });

        db.run("UPDATE sessions SET encrypted_data = ?, status = 'collecting', finalize_token = ? WHERE id = ?",
          [JSON.stringify(existing), data.finalizeToken, data.sessionId]);
        console.log(`Received EHR data for ${data.sessionId} (${existing.length} providers)`);

        return Response.json({
          success: true,
          providerCount: existing.length,
          redirectTo: `${baseURL}/connect/${data.sessionId}?provider_added=true`
        }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: "processing_error" }, { status: 500, headers: corsHeaders });
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
      return Response.json({
        sessionId,
        publicKey: row.public_key ? JSON.parse(row.public_key) : null,
        status: row.status,
        providerCount: encryptedData.length,
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
