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
    data TEXT,
    status TEXT DEFAULT 'pending'
  )
`);

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
      const row = db.query("SELECT status, data FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      
      if (row.status === "complete" && row.data) {
        return new Response(
          JSON.stringify({ ready: true, data: JSON.parse(row.data) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      return Response.json({ ready: false }, { headers: corsHeaders });
    }

    // API: Receive data
    if (path.startsWith("/api/data/") && req.method === "POST") {
      const sessionId = path.replace("/api/data/", "");
      const row = db.query("SELECT status FROM sessions WHERE id = ?").get(sessionId) as any;
      
      if (!row) {
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      if (row.status !== "pending") {
        return new Response("Session already completed", { status: 400, headers: corsHeaders });
      }
      
      try {
        const data = await req.json();
        db.run(
          "UPDATE sessions SET data = ?, status = 'complete' WHERE id = ?",
          [JSON.stringify(data), sessionId]
        );
        console.log(`Received data for session: ${sessionId}`);
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (e) {
        return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
      }
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
      const filePath = "./static" + path;
      if (existsSync(filePath)) {
        return new Response(Bun.file(filePath));
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Health Skillz server running on http://localhost:${port}`);
console.log(`Base URL: ${baseURL}`);
