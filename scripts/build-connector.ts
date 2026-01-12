#!/usr/bin/env bun
/**
 * Build the EHR connector from health-record-mcp source.
 * Injects configuration from config.json.
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

const PROJECT_DIR = dirname(dirname(import.meta.path));
const HEALTH_RECORD_MCP = join(dirname(PROJECT_DIR), "health-record-mcp");
const CONFIG_PATH = process.env.CONFIG_PATH || join(PROJECT_DIR, "config.json");

async function main() {
  // Clone health-record-mcp if needed
  if (!existsSync(HEALTH_RECORD_MCP)) {
    console.log("Cloning health-record-mcp...");
    await $`git clone --depth 1 https://github.com/jmandel/health-record-mcp.git ${HEALTH_RECORD_MCP}`;
  }

  // Install dependencies if needed
  if (!existsSync(join(HEALTH_RECORD_MCP, "node_modules"))) {
    console.log("Installing health-record-mcp dependencies...");
    await $`cd ${HEALTH_RECORD_MCP} && bun install`;
  }

  // Read our config
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

  // Generate build config for health-record-mcp
  // Single delivery endpoint - sessionId is read from sessionStorage on the server side
  const deliveryEndpoints = {
    "health-skillz": {
      postUrl: `${config.server.baseURL}/api/receive-ehr-with-session`
    }
  };
  
  const buildConfig = {
    retrieverConfig: {
      deliveryEndpoints,
      brandFiles: config.brands.map((b: any) => ({
        url: b.file,
        tags: b.tags,
        vendorConfig: {
          clientId: b.clientId,
          scopes: b.scopes,
          ...(b.redirectURL && { redirectUrl: b.redirectURL }),
          ...(b.note && { note: b.note }),
        },
      })),
    },
  };

  const buildConfigPath = join(HEALTH_RECORD_MCP, "config.health-skillz.json");
  writeFileSync(buildConfigPath, JSON.stringify(buildConfig, null, 2));
  console.log("Generated build config:", buildConfigPath);

  // Build the connector
  console.log("Building EHR connector...");
  await $`cd ${HEALTH_RECORD_MCP} && bun run build:ehretriever -- -c config.health-skillz.json`;

  // Copy built files to our static directory
  const staticDir = join(PROJECT_DIR, "static", "ehr-connect");
  mkdirSync(staticDir, { recursive: true });
  mkdirSync(join(staticDir, "brands"), { recursive: true });

  console.log("Copying built files...");
  cpSync(join(HEALTH_RECORD_MCP, "static"), staticDir, { recursive: true });

  // Copy our preprocessed brands files
  const brandsDir = join(PROJECT_DIR, "brands");
  if (existsSync(brandsDir)) {
    for (const file of ["epic-sandbox.json", "epic-prod.json"]) {
      const src = join(brandsDir, file);
      const dest = join(staticDir, "brands", file);
      if (existsSync(src)) {
        cpSync(src, dest);
        console.log(`Copied ${file} to static/ehr-connect/brands/`);
      }
    }
  }

  // Create OAuth callback handler
  const callbackHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Completing authorization...</title>
</head>
<body>
    <p>Completing authorization...</p>
    <script>
        // Restore the delivery hash from sessionStorage (survives OAuth redirect)
        // The ehretriever clears its delivery keys on load, so we need to re-inject the hash
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
        
        const params = window.location.search;
        const newUrl = window.location.origin + '/ehr-connect/ehretriever.html' + params + hash;
        window.location.replace(newUrl);
    </script>
</body>
</html>`;
  writeFileSync(join(staticDir, "callback.html"), callbackHtml);
  console.log("Created callback.html for OAuth redirect");

  console.log("\n✓ EHR connector build complete!");
  console.log(`Files in: ${staticDir}`);
}

main().catch(console.error);
