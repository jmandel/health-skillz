#!/usr/bin/env bun
/**
 * Package the Claude skill as a .zip file.
 */

import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

const PROJECT_DIR = dirname(dirname(import.meta.path));
const SKILL_DIR = join(PROJECT_DIR, "skill", "health-record-assistant");
const OUTPUT_ZIP = join(PROJECT_DIR, "skill", "health-record-assistant.zip");

async function main() {
  if (!existsSync(join(SKILL_DIR, "SKILL.md"))) {
    throw new Error("SKILL.md not found in " + SKILL_DIR);
  }

  // Remove old zip if exists
  if (existsSync(OUTPUT_ZIP)) {
    await $`rm ${OUTPUT_ZIP}`;
  }

  // Create zip
  console.log("Packaging skill...");
  await $`cd ${SKILL_DIR} && zip -r ${OUTPUT_ZIP} SKILL.md references/`;

  console.log(`\n✓ Created ${OUTPUT_ZIP}`);
}

main().catch(console.error);
