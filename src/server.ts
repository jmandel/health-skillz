import { Database } from "bun:sqlite";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, relative } from "path";
import { Glob } from "bun";

// Load config
const configPath = process.env.CONFIG_PATH || "./config.json";
const config = JSON.parse(readFileSync(configPath, "utf-8"));

// Override baseURL from env if set
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

// Migration: add columns if missing (for existing DBs)
const migrations = [
  "ALTER TABLE sessions ADD COLUMN providers TEXT DEFAULT '[]'",
  "ALTER TABLE sessions ADD COLUMN public_key TEXT",
  "ALTER TABLE sessions ADD COLUMN encrypted_data TEXT",
  "ALTER TABLE sessions ADD COLUMN temp_ehr_data TEXT",
];
for (const sql of migrations) {
  try { db.run(sql); } catch (e) { /* Column already exists */ }
}

// Types for provider data
interface ProviderData {
  name: string;
  connectedAt: string;
  fhir: Record<string, any[]>;
  attachments: any[];
}

// Cleanup expired sessions periodically
const timeoutMs = (config.session?.timeoutMinutes || 60) * 60 * 1000;
setInterval(() => {
  const cutoff = Math.floor((Date.now() - timeoutMs) / 1000);
  db.run("DELETE FROM sessions WHERE created_at < ?", [cutoff]);
}, 5 * 60 * 1000);

// Build skill zip with placeholders filled in
async function buildSkillZipWithConfig(): Promise<Response> {
  const skillDir = "./skill/health-record-assistant";
  
  if (!existsSync(skillDir)) {
    return new Response("Skill source not found", { status: 404 });
  }

  // Build zip using shell
  const { $ } = await import("bun");
  const tempDir = `/tmp/skill-build-${Date.now()}`;
  
  try {
    // Create temp directory with filled-in files
    await $`mkdir -p ${tempDir}/health-record-assistant/references`;
    
    // Process SKILL.md
    let skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    skillMd = skillMd.replaceAll("{{BASE_URL}}", baseURL);
    await Bun.write(`${tempDir}/health-record-assistant/SKILL.md`, skillMd);
    
    // Process references
    const refsDir = join(skillDir, "references");
    if (existsSync(refsDir)) {
      for (const file of readdirSync(refsDir)) {
        let content = readFileSync(join(refsDir, file), "utf-8");
        content = content.replaceAll("{{BASE_URL}}", baseURL);
        await Bun.write(`${tempDir}/health-record-assistant/references/${file}`, content);
      }
    }
    
    // Create zip
    await $`cd ${tempDir} && zip -r skill.zip health-record-assistant/`;
    
    const zipData = await Bun.file(`${tempDir}/skill.zip`).arrayBuffer();
    
    // Cleanup
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
    return new Response("Failed to build skill package", { status: 500 });
  }
}

// Generate random session ID
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Read template file and substitute variables
function renderTemplate(name: string, vars: Record<string, string>): string {
  let html = readFileSync(join("templates", name), "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  return html;
}

// Merge data from multiple providers into single structure
function mergeProviderData(providers: ProviderData[]): { fhir: Record<string, any[]>; attachments: any[]; providers: { name: string; connectedAt: string }[] } {
  const merged: Record<string, any[]> = {};
  const attachments: any[] = [];
  
  for (const provider of providers) {
    // Merge FHIR resources by type
    for (const [resourceType, resources] of Object.entries(provider.fhir)) {
      if (!merged[resourceType]) {
        merged[resourceType] = [];
      }
      // Tag each resource with provider source
      for (const resource of resources as any[]) {
        merged[resourceType].push({
          ...resource,
          _sourceProvider: provider.name
        });
      }
    }
    
    // Merge attachments with provider tag
    for (const att of provider.attachments) {
      attachments.push({
        ...att,
        _sourceProvider: provider.name
      });
    }
  }
  
  return { 
    fhir: merged, 
    attachments,
    providers: providers.map(p => ({ name: p.name, connectedAt: p.connectedAt }))
  };
}

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Main server
const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API: Create session
    if (path === "/api/session" && req.method === "POST") {
      const sessionId = generateSessionId();
      
      // Require public key for E2E encryption
      let publicKey: string | null = null;
      try {
        const body = await req.json() as { publicKey?: any };
        if (body.publicKey) {
          // Store JWK as JSON string
          publicKey = JSON.stringify(body.publicKey);
        }
      } catch (e) {
        // No body or invalid JSON
      }
      
      if (!publicKey) {
        return Response.json({
          error: "public_key_required",
          error_description: "E2E encryption is required. Please provide a publicKey (ECDH P-256 JWK) in the request body."
        }, { status: 400, headers: corsHeaders });
      }
      
      db.run("INSERT INTO sessions (id, public_key) VALUES (?, ?)", [sessionId, publicKey]);
      
      console.log(`Created session: ${sessionId} (E2E encrypted)`);
      
      return Response.json({
        sessionId,
        userUrl: `${baseURL}/connect/${sessionId}`,
        pollUrl: `${baseURL}/api/poll/${sessionId}`,
      }, { headers: corsHeaders });
    }

    // API: Poll for data (with long-polling support)
    if (path.startsWith("/api/poll/") && req.method === "GET") {
      const sessionId = path.replace("/api/poll/", "");
      const url = new URL(req.url);
      const timeout = Math.min(parseInt(url.searchParams.get("timeout") || "30"), 60) * 1000;
      const pollInterval = 500; // Check every 500ms
      const startTime = Date.now();
      
      // Long-poll: keep checking until ready or timeout
      while (Date.now() - startTime < timeout) {
        const row = db.query("SELECT status, providers, public_key, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
        
        if (!row) {
          return new Response("Session not found", { status: 404, headers: corsHeaders });
        }
        
        const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        const providerCount = encryptedData.length;
        
        // Return immediately if finalized
        if (row.status === "finalized" && providerCount > 0) {
          return Response.json({
            ready: true,
            encryptedProviders: encryptedData,
            providerCount
          }, { headers: corsHeaders });
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      // Timeout reached - return current state
      const row = db.query("SELECT status, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
      const providerCount = encryptedData.length;
      const providerInfo = encryptedData.map((p: any) => ({ name: p.providerName, connectedAt: p.connectedAt }));
      
      return Response.json({ 
        ready: false, 
        status: row.status,
        providerCount,
        providers: providerInfo,
        message: "Still waiting for user to connect and finalize. Keep polling."
      }, { headers: corsHeaders });
    }

    // API: Receive data (appends to providers list, or stores encrypted blob)
    if (path.startsWith("/api/data/") && req.method === "POST") {
      const sessionId = path.replace("/api/data/", "");
      const row = db.query("SELECT status, providers, public_key, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      if (row.status === "finalized") {
        return new Response("Session already finalized", { status: 400, headers: corsHeaders });
      }
      
      try {
        const data = await req.json() as any;
        
        // Require encrypted data format
        if (!data.encrypted || !data.ephemeralPublicKey || !data.iv || !data.ciphertext) {
          return Response.json({
            error: "encryption_required",
            error_description: "Data must be encrypted. Required fields: encrypted, ephemeralPublicKey, iv, ciphertext"
          }, { status: 400, headers: corsHeaders });
        }
        
        // Store encrypted blob - we can't read it, just pass it through
        const existingEncrypted = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
        existingEncrypted.push({
          ephemeralPublicKey: data.ephemeralPublicKey,
          iv: data.iv,
          ciphertext: data.ciphertext,
          providerName: data.providerName || 'Unknown Provider',
          connectedAt: new Date().toISOString()
        });
        
        db.run(
          "UPDATE sessions SET encrypted_data = ?, status = 'collecting' WHERE id = ?",
          [JSON.stringify(existingEncrypted), sessionId]
        );
        console.log(`Received encrypted data for session ${sessionId} (total: ${existingEncrypted.length} providers)`);
        return Response.json({ 
          success: true, 
          providerCount: existingEncrypted.length
        }, { headers: corsHeaders });
      } catch (e) {
        return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
      }
    }

    // API: Receive unencrypted EHR data from ehretriever (temporary storage)
    // This data will be encrypted client-side and re-POSTed to /api/data/:id
    if (path.startsWith("/api/receive-ehr/") && req.method === "POST") {
      const sessionId = path.replace("/api/receive-ehr/", "");
      const row = db.query("SELECT id FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return Response.json({ success: false, error: "session_not_found" }, { status: 404, headers: corsHeaders });
      }
      
      try {
        const data = await req.json();
        // Store temporarily - will be cleared after client encrypts and re-sends
        db.run(
          "UPDATE sessions SET temp_ehr_data = ? WHERE id = ?",
          [JSON.stringify(data), sessionId]
        );
        console.log(`Received unencrypted EHR data for session ${sessionId} (temporary)`);
        
        // Return redirect URL for ehretriever
        return Response.json({
          success: true,
          redirectTo: `${baseURL}/connect/${sessionId}?ehr_delivered=true`
        }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: "invalid_json" }, { status: 400, headers: corsHeaders });
      }
    }

    // API: Receive unencrypted EHR data with session from sessionStorage marker
    // ehretriever POSTs here, we look up sessionId from the health_skillz_session in sessionStorage
    // Since we can't read sessionStorage server-side, we use a cookie set by the connect page
    if (path === "/api/receive-ehr-with-session" && req.method === "POST") {
      // Get sessionId from cookie
      const cookies = req.headers.get('cookie') || '';
      const sessionMatch = cookies.match(/health_skillz_session_id=([^;]+)/);
      const sessionId = sessionMatch ? sessionMatch[1] : null;
      
      if (!sessionId) {
        return Response.json({ 
          success: false, 
          error: "session_not_found",
          error_description: "No session cookie found. Please start from the connect page."
        }, { status: 400, headers: corsHeaders });
      }
      
      const row = db.query("SELECT id FROM sessions WHERE id = ?").get(sessionId) as any;
      if (!row) {
        return Response.json({ success: false, error: "session_not_found" }, { status: 404, headers: corsHeaders });
      }
      
      try {
        const data = await req.json();
        db.run(
          "UPDATE sessions SET temp_ehr_data = ? WHERE id = ?",
          [JSON.stringify(data), sessionId]
        );
        console.log(`Received unencrypted EHR data for session ${sessionId} (via cookie)`);
        
        return Response.json({
          success: true,
          redirectTo: `${baseURL}/connect/${sessionId}?ehr_delivered=true`
        }, { headers: corsHeaders });
      } catch (e) {
        return Response.json({ success: false, error: "invalid_json" }, { status: 400, headers: corsHeaders });
      }
    }

    // API: Get unencrypted EHR data (for client-side encryption)
    if (path.startsWith("/api/receive-ehr/") && req.method === "GET") {
      const sessionId = path.replace("/api/receive-ehr/", "");
      const row = db.query("SELECT temp_ehr_data FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row || !row.temp_ehr_data) {
        return new Response("No data", { status: 404, headers: corsHeaders });
      }
      
      return Response.json(JSON.parse(row.temp_ehr_data), { headers: corsHeaders });
    }

    // API: Clear unencrypted EHR data
    if (path.startsWith("/api/receive-ehr/") && req.method === "DELETE") {
      const sessionId = path.replace("/api/receive-ehr/", "");
      db.run("UPDATE sessions SET temp_ehr_data = NULL WHERE id = ?", [sessionId]);
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // API: Finalize session (user is done adding providers)
    if (path.startsWith("/api/finalize/") && req.method === "POST") {
      const sessionId = path.replace("/api/finalize/", "");
      const row = db.query("SELECT status, providers, public_key, encrypted_data FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      if (row.status === "finalized") {
        return Response.json({ success: true, alreadyFinalized: true }, { headers: corsHeaders });
      }
      
      const encryptedData = row.encrypted_data ? JSON.parse(row.encrypted_data) : [];
      const providerCount = encryptedData.length;
      
      if (providerCount === 0) {
        return new Response("No providers connected yet", { status: 400, headers: corsHeaders });
      }
      
      db.run("UPDATE sessions SET status = 'finalized' WHERE id = ?", [sessionId]);
      console.log(`Finalized session ${sessionId} with ${providerCount} provider(s)`);
      
      return Response.json({ 
        success: true, 
        providerCount
      }, { headers: corsHeaders });
    }

    // API: Get session info (for React SPA)
    if (path.startsWith("/api/session/") && req.method === "GET") {
      const sessionId = path.replace("/api/session/", "");
      const row = db.query("SELECT status, public_key FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found or expired", { status: 404, headers: corsHeaders });
      }
      
      return Response.json({
        sessionId,
        publicKey: row.public_key ? JSON.parse(row.public_key) : null,
        status: row.status,
      }, { headers: corsHeaders });
    }

    // SPA: Serve React app for / and /connect/*
    if (path === "/" || path.startsWith("/connect/")) {
      const spaPath = "./dist/index.html";
      if (existsSync(spaPath)) {
        return new Response(Bun.file(spaPath), {
          headers: { "Content-Type": "text/html" },
        });
      }
      // Fallback to templates if SPA not built
      if (path.startsWith("/connect/")) {
        const sessionId = path.replace("/connect/", "");
        const row = db.query("SELECT status, public_key FROM sessions WHERE id = ?").get(sessionId) as any;
        if (!row) {
          return new Response("Session not found or expired", { status: 404 });
        }
        const html = renderTemplate("connect.html", {
          SESSION_ID: sessionId,
          BASE_URL: baseURL,
          PUBLIC_KEY: row.public_key || '',
        });
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }
      const html = renderTemplate("index.html", { BASE_URL: baseURL });
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // Skill markdown (with placeholders filled in)
    if (path === "/health-record-assistant.md") {
      const mdPath = "./skill/health-record-assistant/SKILL.md";
      if (!existsSync(mdPath)) {
        return new Response("Skill not found", { status: 404 });
      }
      let content = readFileSync(mdPath, "utf-8");
      content = content.replaceAll("{{BASE_URL}}", baseURL);
      return new Response(content, {
        headers: { "Content-Type": "text/markdown" },
      });
    }

    // Skill zip download (with placeholders filled in)
    if (path === "/skill.zip") {
      return await buildSkillZipWithConfig();
    }

    // Health check
    if (path === "/health") {
      return new Response("ok");
    }

    // Static files: /static/*
    if (path.startsWith("/static/")) {
      const filePath = "." + path;
      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath));
      }
    }

    // SPA assets (JS, CSS, etc. from dist/)
    if (path.startsWith("/assets/")) {
      const filePath = "./dist" + path;
      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath));
      }
    }

    // EHR connector files: /ehr-connect/*
    if (path.startsWith("/ehr-connect/")) {
      // Handle /ehr-connect/callback -> callback.html (OAuth redirect)
      let filePath = "./static" + path;
      if (path === "/ehr-connect/callback") {
        filePath = "./static/ehr-connect/callback.html";
      }
      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath));
      }
    }

    // OAuth callback handler for localhost:3001/ehr-callback (Epic sandbox)
    if (path === "/ehr-callback") {
      // Redirect to the ehretriever with OAuth params preserved
      const params = url.search;
      const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Completing authorization...</title>
</head>
<body>
    <p>Completing authorization...</p>
    <script>
        // Restore the delivery hash from sessionStorage
        let hash = '';
        try {
            const sessionInfo = sessionStorage.getItem('health_skillz_session');
            if (sessionInfo) {
                const { origin } = JSON.parse(sessionInfo);
                if (origin) {
                    hash = '#deliver-to-opener:' + encodeURIComponent(origin);
                }
            }
        } catch (e) {
            console.warn('Could not restore session info:', e);
        }
        const newUrl = window.location.origin + '/ehr-connect/ehretriever.html' + '${params}' + hash;
        window.location.replace(newUrl);
    </script>
</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health Skillz server running on http://localhost:${port}`);
console.log(`Base URL: ${baseURL}`);
