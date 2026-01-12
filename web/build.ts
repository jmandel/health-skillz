#!/usr/bin/env bun
/**
 * Build the React app using Bun's native HTML bundling
 */

await Bun.build({
  entrypoints: ['./index.html'],
  outdir: '../dist',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: 'linked',
});

console.log('✓ Built to ../dist');
