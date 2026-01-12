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
    status TEXT DEFAULT 'pending'
  )
`);

// Migration: add providers column if missing (for existing DBs)
try {
  db.run(`ALTER TABLE sessions ADD COLUMN providers TEXT DEFAULT '[]'`);
} catch (e) {
  // Column already exists
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
      db.run("INSERT INTO sessions (id) VALUES (?)", [sessionId]);
      
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
      const row = db.query("SELECT status, providers FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      
      const providers: ProviderData[] = JSON.parse(row.providers || '[]');
      
      // Only return ready when finalized (user clicked "Done")
      if (row.status === "finalized" && providers.length > 0) {
        // Merge all provider data into single structure
        const mergedData = mergeProviderData(providers);
        return new Response(
          JSON.stringify({ ready: true, data: mergedData, providerCount: providers.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Return status info for collecting state
      return Response.json({ 
        ready: false, 
        status: row.status,
        providerCount: providers.length,
        providers: providers.map(p => ({ name: p.name, connectedAt: p.connectedAt }))
      }, { headers: corsHeaders });
    }

    // API: Receive data (appends to providers list)
    if (path.startsWith("/api/data/") && req.method === "POST") {
      const sessionId = path.replace("/api/data/", "");
      const row = db.query("SELECT status, providers FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      if (row.status === "finalized") {
        return new Response("Session already finalized", { status: 400, headers: corsHeaders });
      }
      
      try {
        const data = await req.json() as { fhir?: Record<string, any[]>; attachments?: any[]; providerName?: string };
        const providers: ProviderData[] = JSON.parse(row.providers || '[]');
        
        // Extract provider name from Patient resource if available
        let providerName = "Unknown Provider";
        if (data.fhir?.Patient?.[0]?.managingOrganization?.display) {
          providerName = data.fhir.Patient[0].managingOrganization.display;
        } else if (data.providerName) {
          providerName = data.providerName;
        }
        
        // Add new provider data
        providers.push({
          name: providerName,
          connectedAt: new Date().toISOString(),
          fhir: data.fhir || {},
          attachments: data.attachments || []
        });
        
        db.run(
          "UPDATE sessions SET providers = ?, status = 'collecting' WHERE id = ?",
          [JSON.stringify(providers), sessionId]
        );
        console.log(`Received data for session ${sessionId} from provider: ${providerName} (total: ${providers.length})`);
        return Response.json({ 
          success: true, 
          providerCount: providers.length,
          providerName 
        }, { headers: corsHeaders });
      } catch (e) {
        return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
      }
    }

    // API: Finalize session (user is done adding providers)
    if (path.startsWith("/api/finalize/") && req.method === "POST") {
      const sessionId = path.replace("/api/finalize/", "");
      const row = db.query("SELECT status, providers FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      if (row.status === "finalized") {
        return Response.json({ success: true, alreadyFinalized: true }, { headers: corsHeaders });
      }
      
      const providers: ProviderData[] = JSON.parse(row.providers || '[]');
      if (providers.length === 0) {
        return new Response("No providers connected yet", { status: 400, headers: corsHeaders });
      }
      
      db.run("UPDATE sessions SET status = 'finalized' WHERE id = ?", [sessionId]);
      console.log(`Finalized session ${sessionId} with ${providers.length} provider(s)`);
      
      return Response.json({ 
        success: true, 
        providerCount: providers.length 
      }, { headers: corsHeaders });
    }

    // Page: Connect wrapper
    if (path.startsWith("/connect/")) {
      const sessionId = path.replace("/connect/", "");
      const row = db.query("SELECT status FROM sessions WHERE id = ?").get(sessionId);
      
      if (!row) {
        return new Response("Session not found or expired", { status: 404 });
      }
      
      const html = renderTemplate("connect.html", {
        SESSION_ID: sessionId,
        BASE_URL: baseURL,
      });
      
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Page: Home
    if (path === "/") {
      const html = renderTemplate("index.html", { BASE_URL: baseURL });
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
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

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health Skillz server running on http://localhost:${port}`);
console.log(`Base URL: ${baseURL}`);
