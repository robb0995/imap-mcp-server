import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Get all dependencies to mark as external
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];

// Shebang banner so the bin entrypoints are directly executable via npx
const shebang = { js: '#!/usr/bin/env node' };

// Build main entry point
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  external,
  banner: shebang,
});

// Build setup entry point
await esbuild.build({
  entryPoints: ['src/setup.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/setup.js',
  external,
  banner: shebang,
});

// Build web server entry point
await esbuild.build({
  entryPoints: ['src/web/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/web/server.js',
  external,
});

// Build smtp entry point — the send-only `imap-mcp-server/smtp` subpath.
// A library entry, not a bin: no shebang banner. metafile is written out so
// tests/smtp-export-isolation.test.ts can assert on the actual import graph
// (all deps are external here, so grepping the bundle proves nothing).
const smtpResult = await esbuild.build({
  entryPoints: ['src/smtp.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/smtp.js',
  external,
  metafile: true,
});
writeFileSync('dist/smtp.meta.json', JSON.stringify(smtpResult.metafile, null, 2));

// Type declarations — esbuild emits no .d.ts, so a strict-TypeScript consumer
// of `imap-mcp-server/smtp` needs this to typecheck. Declaration-only so it
// never overwrites the bundled JS esbuild just produced above.
execSync('tsc --emitDeclarationOnly', { stdio: 'inherit' });

console.log('Build complete!');
