import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as esbuild from 'esbuild';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';

// Regression guard for "The connector knows its limits — Phase 1: yarpost can
// send without being able to read". yarpost's entire security claim is that it
// holds a send credential and nothing else; if `imap-mcp-server/smtp` ever
// pulls ImapService (or anything that can read mail, touch the local
// credential store, or the MCP tool layer) into its import graph, that claim
// becomes false. This test is the mechanism that makes that structural,
// not a matter of someone remembering not to add the wrong import.
//
// A naive "grep dist/smtp.js for imapflow" test asserts nothing: build.mjs
// marks every dependency external, so the bundle never contains third-party
// source in the first place — it would pass unconditionally.
//
// A naive "check esbuild's metafile for the built bundle" test has a subtler
// hole: esbuild elides an import whose named bindings are never used as a
// value in the importing file (the same heuristic TypeScript itself uses to
// drop type-only imports). A leaked-but-unused
// `import { ImapService } from './services/imap-service.js'` therefore never
// shows up in the bundle or its metafile at all — the bundle is byte-for-byte
// as if the import were never written. So this file also walks the *source*
// import graph (via a regex scan of the raw .ts text, not a bundler or a
// type-checker) from src/smtp.ts, which is immune to dead-code elision: it
// flags the import statement itself, regardless of whether anything
// downstream ever uses the binding. (The TypeScript package itself can't
// help here either — this repo is on TypeScript 7, whose npm package no
// longer ships the JS Compiler API (`createSourceFile` etc.) at all.)

const ROOT = resolve(__dirname, '..');
const ENTRY = join(ROOT, 'src', 'smtp.ts');
const OUT_DIR = join(ROOT, 'dist', '.smtp-isolation-test');
const OUT_FILE = join(OUT_DIR, 'smtp.js');

// Source files this entry point must never reach: mail-reading, the local
// credential store, and the MCP tool/web layers.
const FORBIDDEN_PATH_PATTERNS: [string, RegExp][] = [
  ['imap-service', /[\\/]services[\\/]imap-service\.ts$/],
  ['account-manager', /[\\/]services[\\/]account-manager\.ts$/],
  ['spam-service', /[\\/]services[\\/]spam-service\.ts$/],
  ['html-to-markdown', /[\\/]services[\\/]html-to-markdown\.ts$/],
  ['src/tools', /[\\/]tools[\\/]/],
  ['src/web', /[\\/]web[\\/]/],
  ['src/setup', /[\\/]setup\.ts$/],
];

// Everything this entry point is allowed to import from outside its own
// source. New entries must be added deliberately — this is an allowlist, not
// a denylist, so a brand-new dependency someone adds tomorrow fails closed
// instead of silently passing because it isn't on a list of "known-bad" names
// written today.
const ALLOWED_EXTERNAL_IMPORTS = new Set(['nodemailer', 'nodemailer/lib/mail-composer/index.js']);

// Packages that must never be reachable, named explicitly so a failure here
// is unambiguous even if ALLOWED_EXTERNAL_IMPORTS is ever loosened by mistake.
const EXPLICITLY_BANNED_IMPORTS = [
  'imapflow',
  '@modelcontextprotocol/sdk',
  'express',
  'mailparser',
  'pdf-parse',
  'turndown',
];

function assertNotForbidden(paths: Iterable<string>, source: string) {
  const list = Array.from(paths);
  for (const [name, pattern] of FORBIDDEN_PATH_PATTERNS) {
    const offenders = list.filter((f) => pattern.test(f));
    expect(offenders, `${source}: forbidden source "${name}" reachable from src/smtp.ts: ${offenders.join(', ')}`).toEqual([]);
  }
}

// --- Elision-proof static source-graph walk (regex over raw .ts text, no bundler) ---
//
// Deliberately not using the `typescript` package's Compiler API: this repo
// is on TypeScript 7, whose npm package ships only a native binary plus a
// `version` field — `createSourceFile` and friends aren't exported anymore.
// A regex scan doesn't need a compiler; it needs to find every module
// specifier textually present in the file, which is exactly what survives
// dead-code elision (the elision happens during compilation, after this scan
// would already have seen the specifier).

const MODULE_SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g, // import ... from '...'; export ... from '...'
  /\bimport\s+['"]([^'"]+)['"]/g, // side-effect-only: import '...'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('...')
];

function extractModuleSpecifiers(filePath: string): string[] {
  const text = readFileSync(filePath, 'utf8');
  const specifiers: string[] = [];
  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveRelativeSpecifier(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')];
  return candidates.find(existsSync) ?? null;
}

function walkSourceGraph(entryFile: string): { files: Set<string>; externals: Set<string> } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue = [resolve(entryFile)];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const spec of extractModuleSpecifiers(file)) {
      if (spec.startsWith('.')) {
        const resolved = resolveRelativeSpecifier(file, spec);
        if (resolved && !files.has(resolved)) queue.push(resolved);
      } else {
        externals.add(spec);
      }
    }
  }

  return { files, externals };
}

// --- Bundle-level check (esbuild metafile) ---
// Complements the source walk: it reflects what actually ships at runtime,
// which matters for genuinely-used imports (the source walk alone can't tell
// you whether an import is load-bearing — only that it's textually present).

async function buildSmtpBundle() {
  mkdirSync(OUT_DIR, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const external = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: OUT_FILE,
    external,
    metafile: true,
    write: true,
  });
  return result.metafile!;
}

describe('imap-mcp-server/smtp export isolation', () => {
  let metafile: Awaited<ReturnType<typeof buildSmtpBundle>>;
  let sourceGraph: ReturnType<typeof walkSourceGraph>;

  beforeAll(async () => {
    metafile = await buildSmtpBundle();
    sourceGraph = walkSourceGraph(ENTRY);
  });

  afterAll(() => {
    rmSync(OUT_DIR, { recursive: true, force: true });
  });

  it('source graph (elision-proof): reaches no forbidden internal source file', () => {
    assertNotForbidden(sourceGraph.files, 'source graph');
    // sanity: the walk actually traversed something beyond the entry file
    expect(sourceGraph.files.size).toBeGreaterThanOrEqual(2);
  });

  it('source graph (elision-proof): every non-relative import is within the allowlist', () => {
    for (const spec of sourceGraph.externals) {
      expect(
        ALLOWED_EXTERNAL_IMPORTS.has(spec),
        `source graph: import "${spec}" is not in ALLOWED_EXTERNAL_IMPORTS — add it deliberately only after confirming it cannot read mail or credentials`,
      ).toBe(true);
    }
    for (const banned of EXPLICITLY_BANNED_IMPORTS) {
      expect(sourceGraph.externals.has(banned), `source graph: "${banned}" must never be imported by src/smtp.ts or its dependencies`).toBe(false);
    }
  });

  it('built bundle: metafile.inputs contains no forbidden source file', () => {
    assertNotForbidden(Object.keys(metafile.inputs), 'bundle metafile');
  });

  it('built bundle: external imports are within the allowlist', () => {
    const bundleExternals = new Set<string>();
    for (const input of Object.values(metafile.inputs)) {
      for (const imp of input.imports) {
        // Only bare package specifiers reflect a genuine external dependency.
        // Relative specifiers can appear here marked `external` too — that's
        // esbuild's per-file TS transform recording an import it elided as
        // type-only (see file header); it never reaches the compiled output,
        // so it isn't a runtime import at all and must not be treated as one.
        if (imp.external && !imp.path.startsWith('.')) {
          bundleExternals.add(imp.path);
        }
      }
    }

    expect(bundleExternals.size).toBeGreaterThan(0); // sanity: nodemailer really is imported
    for (const spec of bundleExternals) {
      expect(ALLOWED_EXTERNAL_IMPORTS.has(spec), `bundle: external import "${spec}" is not in ALLOWED_EXTERNAL_IMPORTS`).toBe(true);
    }
    for (const banned of EXPLICITLY_BANNED_IMPORTS) {
      expect(bundleExternals.has(banned), `bundle: "${banned}" must never ship in dist/smtp.js`).toBe(false);
    }
  });

  it('positive check: SmtpService is actually reachable and functional from the built entry', async () => {
    const mod: any = await import(pathToFileURL(OUT_FILE).href);
    expect(typeof mod.SmtpService).toBe('function');

    const instance = new mod.SmtpService();
    expect(typeof instance.sendEmail).toBe('function');
    expect(typeof instance.createTransporter).toBe('function');
    expect(typeof instance.verifySmtpConnection).toBe('function');
  });
});
