import { Database } from "bun:sqlite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

// Import HTML for Bun's fullstack server - serves the React SPA
import homepage from "./index.html";

// Load config
const configPath = process.env.CONFIG_PATH || "./config.json";
const config = JSON.parse(readFileSync(configPath, "utf-8"));

if (process.env.BASE_URL) {
  config.server.baseURL = process.env.BASE_URL;
}

const baseURL = config.server.baseURL.replace(/\/$/, "");
const port = config.server.port || 8000;

// Initialize SQLite database
const db = new Database("./data/health-skillz.db", { create: true });
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at INTEGER DEFAULT (unixepoch()),
    providers TEXT DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    public_key TEXT,
    encrypted_data TEXT
  )
`);

// Migrations
const migrations = [
  "ALTER TABLE sessions ADD COLUMN providers TEXT DEFAULT '[]'",
  "ALTER TABLE sessions ADD COLUMN public_key TEXT",
  "ALTER TABLE sessions ADD COLUMN encrypted_data TEXT",
];
for (const sql of migrations) {
  try { db.run(sql); } catch (e) { /* Column already exists */ }
}

// Cleanup expired sessions
const timeoutMs = (config.session?.timeoutMinutes || 60) * 60 * 1000;
setInterval(() => {
  const cutoff = Math.floor((Date.now() - timeoutMs) / 1000);
  db.run("DELETE FROM sessions WHERE created_at < ?", [cutoff]);
}, 5 * 60 * 1000);

// Generate session ID
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Build skill zip
async function buildSkillZip(): Promise<Response> {
  const skillDir = "./skill/health-record-assistant";
  if (!existsSync(skillDir)) {
    return new Response("Skill not found", { status: 404 });
  }

  const { $ } = await import("bun");
  const tempDir = `/tmp/skill-build-${Date.now()}`;

  try {
    await $`mkdir -p ${tempDir}/health-record-assistant/references ${tempDir}/health-record-assistant/scripts`;

    let skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    skillMd = skillMd.replaceAll("{{BASE_URL}}", baseURL);
    await Bun.write(`${tempDir}/health-record-assistant/SKILL.md`, skillMd);

    const refsDir = join(skillDir, "references");
    if (existsSync(refsDir)) {
      for (const file of readdirSync(refsDir)) {
        let content = readFileSync(join(refsDir, file), "utf-8");
        content = content.replaceAll("{{BASE_URL}}", baseURL);
        await Bun.write(`${tempDir}/health-record-assistant/references/${file}`, content);
      }
    }

    const scriptsDir = join(skillDir, "scripts");
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

  routes: {
    // SPA routes - all handled by React Router
    "/": homepage,
    "/connect/:sessionId": homepage,
    "/connect/:sessionId/select": homepage,
    "/connect/:sessionId/callback": homepage,
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

    // API: Receive encrypted EHR data
    if (path === "/api/receive-ehr" && req.method === "POST") {
      try {
        const data = await req.json() as any;
        if (!data.sessionId || !data.encrypted || !data.ephemeralPublicKey || !data.iv || !data.ciphertext) {
          return Response.json({ success: false, error: "missing_fields" }, { status: 400, headers: corsHeaders });
        }

        const row = db.query("SELECT encrypted_data, status FROM sessions WHERE id = ?").get(data.sessionId) as any;
        if (!row) return Response.json({ success: false, error: "session_not_found" }, { status: 404, headers: corsHeaders });
        if (row.status === "finalized") return Response.json({ success: false, error: "session_finalized" }, { status: 400, headers: corsHeaders });

        const existing = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        existing.push({
          ephemeralPublicKey: data.ephemeralPublicKey,
          iv: data.iv,
          ciphertext: data.ciphertext,
        });

        db.run("UPDATE sessions SET encrypted_data = ?, status = 'collecting' WHERE id = ?",
          [JSON.stringify(existing), data.sessionId]);
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

    // API: Finalize session
    if (path.startsWith("/api/finalize/") && req.method === "POST") {
      const sessionId = path.replace("/api/finalize/", "");
      const row = db.query("SELECT status, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) return new Response("Session not found", { status: 404, headers: corsHeaders });
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
        vendors: getVendors(),
      }, { headers: corsHeaders });
    }

    // Skill markdown
    if (path === "/health-record-assistant.md") {
      const mdPath = "./skill/health-record-assistant/SKILL.md";
      if (!existsSync(mdPath)) return new Response("Not found", { status: 404 });
      let content = readFileSync(mdPath, "utf-8");
      content = content.replaceAll("{{BASE_URL}}", baseURL);
      return new Response(content, { headers: { "Content-Type": "text/markdown" } });
    }

    // Skill zip
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

    // OAuth callback redirect (for registered redirect URLs without session ID)
    if (path === "/connect/callback" || path === "/ehr-connect/callback") {
      const params = url.search;
      // Try to extract sessionId from state parameter (format: sessionId.nonce)
      const stateParam = url.searchParams.get('state') || '';
      const dotIndex = stateParam.indexOf('.');
      const sessionIdFromState = dotIndex > 0 ? stateParam.substring(0, dotIndex) : null;
      
      if (sessionIdFromState) {
        // Redirect to :8000 to preserve sessionStorage (same origin as where OAuth started)
        return Response.redirect(`${baseURL}:${port}/connect/${sessionIdFromState}/callback${params}`, 302);
      }
      
      // Fallback: try sessionStorage (same-origin only)
      return new Response(`<!DOCTYPE html>
<html><head><title>Redirecting...</title></head>
<body><script>
const s = sessionStorage.getItem('health_skillz_session');
if (s) {
  try {
    const { sessionId } = JSON.parse(s);
    if (sessionId) window.location.replace('/connect/' + sessionId + '/callback${params}');
  } catch(e) { document.body.textContent = 'Error: ' + e.message; }
} else { document.body.textContent = 'No session found. State: ${stateParam}'; }
</script></body></html>`, { headers: { "Content-Type": "text/html" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health Skillz server running on http://localhost:${port}`);
console.log(`Base URL: ${baseURL}`);
