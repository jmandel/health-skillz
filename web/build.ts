#!/usr/bin/env bun
/**
 * Build the React app using Bun's bundler
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join } from 'path';

const outDir = '../dist';

async function build() {
  console.log('Building React app with Bun...');

  // Ensure output directory exists
  mkdirSync(outDir, { recursive: true });

  // Bundle the React app
  const result = await Bun.build({
    entrypoints: ['./src/main.tsx'],
    outdir: outDir,
    naming: {
      entry: 'assets/[name]-[hash].[ext]',
      chunk: 'assets/[name]-[hash].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    splitting: true,
    minify: process.env.NODE_ENV === 'production',
    sourcemap: 'external',
    target: 'browser',
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
  });

  if (!result.success) {
    console.error('Build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Find the output JS file
  const jsFile = result.outputs.find(o => o.path.endsWith('.js'));
  if (!jsFile) {
    console.error('No JS output found');
    process.exit(1);
  }

  const jsFileName = jsFile.path.split('/').pop();

  // Copy and process CSS
  const cssContent = readFileSync('./src/index.css', 'utf-8');
  const cssFileName = `assets/index-${Date.now().toString(36)}.css`;
  writeFileSync(join(outDir, cssFileName), cssContent);

  // Generate index.html
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Health Record Skill</title>
  <link rel="stylesheet" href="/${cssFileName}">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/${jsFileName}"></script>
</body>
</html>`;

  writeFileSync(join(outDir, 'index.html'), html);

  console.log(`✓ Built to ${outDir}/`);
  console.log(`  - index.html`);
  console.log(`  - ${cssFileName}`);
  console.log(`  - assets/${jsFileName}`);
}

build().catch(console.error);
