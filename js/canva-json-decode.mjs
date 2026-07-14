#!/usr/bin/env node
/**
 * Deserialize Canva wire JSON using generated web TypeScript protos from a local checkout.
 *
 * Run from a Canva checkout, or set CANVA_ROOT. Uses that checkout's esbuild-wasm + *_proto.ts.
 *
 * Usage:
 *   canva-json-decode --proto FooResponse < body.json
 *   canva-json-decode --proto FooResponse --input body.json
 *   canva-json-decode --proto path/to/foo_proto.ts:FooResponse --input body.json
 *   canva-json-decode --proto FooResponse --pick 1 --input body.json
 */

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);

const REPO_ROOT = findCanvaRoot();
const PATHS_JSON = path.join(REPO_ROOT, 'web/tsconfig.paths.json');

/** @type {typeof import('esbuild-wasm') | null} */
let esbuild = null;

main().catch(err => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

async function main() {
  const { values } = parseArgs({
    options: {
      proto: { type: 'string', short: 'p' },
      input: { type: 'string', short: 'i' },
      pick: { type: 'string' },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help || !values.proto) {
    printHelp();
    process.exit(values.help ? 0 : 2);
  }

  console.error(`Canva root: ${REPO_ROOT}`);

  const protoArg = values.proto;
  const { candidates, matchKind } = resolveCandidates(protoArg);

  if (candidates.length === 0) {
    console.error(`No proto export found for ${JSON.stringify(protoArg)}.`);
    console.error('Tried exact `export const <Name>`, then substring `export const *<Name>*` in *_proto.ts.');
    process.exit(1);
  }

  logSearchResult(protoArg, matchKind, candidates);

  if (values.list) {
    process.exit(0);
  }

  const { selected, how } = await selectCandidate(candidates, values.pick);
  console.error(`Using [${how}] ${selected.display}`);
  console.error(`  export: ${selected.name}`);
  console.error(`  file:   ${path.relative(REPO_ROOT, selected.file)}`);

  const rawInput = await readInput(values.input);
  const parsed = parseInput(rawInput);

  console.error('Deserializing…');
  const decoded = await deserializeWithProto(selected, parsed);
  const pretty = JSON.stringify(decoded, jsonReplacer, 2);
  console.error('Done.');

  openDecodedInViewer(pretty, selected.name);
}

function printHelp() {
  console.log(`Deserialize Canva wire JSON using a generated web TypeScript proto.

Usage (from a Canva checkout, or with CANVA_ROOT set):
  canva-json-decode --proto <Name|file.ts:Name> [--input file.json] [--pick N]
  canva-json-decode --proto <Name> --list

Options:
  -p, --proto   Short message name, or path/to/*_proto.ts:ExportName
  -i, --input   JSON file (default: stdin)
      --pick    1-based index when multiple search hits (non-interactive)
      --list    Print search hits and exit
  -h, --help    Show help

Environment:
  CANVA_ROOT              Canva monorepo root (default: walk cwd / git toplevel)
  CANVA_JSON_DECODE_RG    ripgrep binary (default: $CANVA_ROOT/bin/rg or rg on PATH)

After a successful decode, writes a temp .json and opens it in Cursor
(or VS Code / macOS open as fallback).

Examples:
  canva-json-decode --proto FooResponse < body.json
  canva-json-decode --proto FooResponse --input body.json
  canva-json-decode --proto web/src/services/foo/foo_proto.ts:FooResponse --input body.json
`);
}

function findCanvaRoot() {
  if (process.env.CANVA_ROOT) {
    const root = path.resolve(process.env.CANVA_ROOT);
    assertCanvaRoot(root, 'CANVA_ROOT');
    return root;
  }

  let dir = process.cwd();
  for (;;) {
    if (isCanvaRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  if (git.status === 0) {
    const root = git.stdout.trim();
    if (isCanvaRoot(root)) {
      return root;
    }
  }

  throw new Error(
    'Could not find a Canva checkout (missing web/tsconfig.paths.json). cd into canva or set CANVA_ROOT.',
  );
}

function isCanvaRoot(dir) {
  return fs.existsSync(path.join(dir, 'web/tsconfig.paths.json'));
}

function assertCanvaRoot(root, via) {
  if (!isCanvaRoot(root)) {
    throw new Error(`${via}=${root} does not look like a Canva checkout (missing web/tsconfig.paths.json)`);
  }
}

function resolveRg() {
  if (process.env.CANVA_JSON_DECODE_RG) {
    return process.env.CANVA_JSON_DECODE_RG;
  }
  const canvaRg = path.join(REPO_ROOT, 'bin/rg');
  try {
    fs.accessSync(canvaRg, fs.constants.X_OK);
    return canvaRg;
  } catch {
    return 'rg';
  }
}

/**
 * @param {string} protoArg
 * @returns {{ candidates: { file: string, name: string, display: string }[], matchKind: 'exact' | 'fuzzy' | 'explicit' }}
 */
function resolveCandidates(protoArg) {
  const explicit = parseExplicitProto(protoArg);
  if (explicit) {
    return { candidates: [explicit], matchKind: 'explicit' };
  }

  const name = protoArg.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid --proto ${JSON.stringify(protoArg)}. Use a short name or path/to/file_proto.ts:ExportName.`,
    );
  }

  return searchProtoExports(name);
}

/**
 * @param {string} protoArg
 * @returns {{ file: string, name: string, display: string } | null}
 */
function parseExplicitProto(protoArg) {
  const sep = protoArg.includes('#') ? '#' : protoArg.includes(':') ? ':' : null;
  if (!sep) {
    if (protoArg.endsWith('.ts') || protoArg.endsWith('.tsx')) {
      throw new Error(`Missing export name. Use ${protoArg}:ExportName`);
    }
    return null;
  }

  const idx = protoArg.lastIndexOf(sep);
  const filePart = protoArg.slice(0, idx);
  const name = protoArg.slice(idx + 1);
  if (!filePart || !name || filePart.includes('://')) {
    return null;
  }
  if (!filePart.endsWith('.ts') && !filePart.endsWith('.tsx')) {
    return null;
  }

  const file = path.isAbsolute(filePart) ? filePart : path.join(REPO_ROOT, filePart);
  if (!fs.existsSync(file)) {
    throw new Error(`Proto file not found: ${file}`);
  }
  return {
    file,
    name,
    display: `${path.relative(REPO_ROOT, file)}:${name}`,
  };
}

/**
 * @param {string} name
 * @returns {{ candidates: { file: string, name: string, display: string }[], matchKind: 'exact' | 'fuzzy' }}
 */
function searchProtoExports(name) {
  const exact = collectRgMatches(`^export const ${escapeRegExp(name)}\\b`, {
    expectedName: name,
    caseInsensitive: false,
  });
  if (exact.length > 0) {
    return { candidates: exact, matchKind: 'exact' };
  }

  const fuzzy = collectRgMatches(`^export const (\\w*${escapeRegExp(name)}\\w*)\\b`, {
    caseInsensitive: true,
  });
  return { candidates: fuzzy, matchKind: 'fuzzy' };
}

/**
 * @param {string} pattern
 * @param {{ expectedName?: string, caseInsensitive?: boolean }} opts
 * @returns {{ file: string, name: string, display: string }[]}
 */
function collectRgMatches(pattern, opts = {}) {
  const rg = resolveRg();
  const args = [
    '--glob',
    '*_proto.ts',
    '--glob',
    '!**/{node_modules,bazel-*,.git,target,dist,build}/**',
    '--no-heading',
    '--with-filename',
    '-n',
    '--regexp',
    pattern,
  ];
  if (opts.caseInsensitive) {
    args.push('-i');
  }
  args.push(REPO_ROOT);

  const result = spawnSync(rg, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (result.error) {
    throw new Error(
      `Failed to run ${rg}: ${result.error.message}. Install ripgrep or set CANVA_JSON_DECODE_RG.`,
    );
  }

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `rg failed with status ${result.status}`);
  }

  const lines = (result.stdout || '').split('\n').filter(Boolean);
  /** @type {Map<string, { file: string, name: string, display: string }>} */
  const byKey = new Map();
  for (const line of lines) {
    const parsed = parseRgLine(line);
    if (!parsed) {
      continue;
    }
    const { file, content } = parsed;
    if (!file.endsWith('_proto.ts')) {
      continue;
    }
    if (file.includes('/tests/') || file.includes('.tests.')) {
      continue;
    }

    const exportMatch = content.match(/^export const ([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (!exportMatch) {
      continue;
    }
    const exportName = opts.expectedName ?? exportMatch[1];
    const key = `${file}:${exportName}`;
    byKey.set(key, {
      file,
      name: exportName,
      display: `${path.relative(REPO_ROOT, file)}:${exportName}`,
    });
  }
  return [...byKey.values()].sort((a, b) => a.display.localeCompare(b.display));
}

/**
 * @param {string} line
 * @returns {{ file: string, content: string } | null}
 */
function parseRgLine(line) {
  const match = line.match(/^(.+?):(\d+):(.*)$/);
  if (!match) {
    return null;
  }
  return { file: match[1], content: match[3] };
}

/**
 * @param {string} prettyJson
 * @param {string} protoName
 */
function openDecodedInViewer(prettyJson, protoName) {
  const safeName = protoName.replace(/[^A-Za-z0-9_-]+/g, '_');
  const outPath = path.join(os.tmpdir(), `canva-json-decode-${safeName}-${Date.now()}.json`);
  fs.writeFileSync(outPath, `${prettyJson}\n`, 'utf8');
  console.error(`Wrote ${outPath}`);

  /** @type {[string, string[]][]} */
  const attempts = [
    ['cursor', [outPath]],
    ['code', [outPath]],
    ['open', [outPath]],
  ];

  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { stdio: 'ignore' });
    if (result.error?.code === 'ENOENT') {
      continue;
    }
    if (result.status === 0) {
      console.error(`Opened with ${cmd}`);
      return;
    }
    console.error(`${cmd} exited ${result.status ?? 'unknown'}; trying next viewer…`);
  }

  console.error('Could not open a viewer; open the temp file manually.');
}

/**
 * @param {string} protoArg
 * @param {'exact' | 'fuzzy' | 'explicit'} matchKind
 * @param {{ display: string }[]} candidates
 */
function logSearchResult(protoArg, matchKind, candidates) {
  if (matchKind === 'explicit') {
    console.error(`Resolved explicit --proto ${JSON.stringify(protoArg)}`);
  } else if (matchKind === 'exact') {
    console.error(
      `Exact match for export const ${JSON.stringify(protoArg)} (${candidates.length} hit(s))`,
    );
  } else {
    console.error(
      `No exact match for ${JSON.stringify(protoArg)}; substring matches export const *${protoArg}* (${candidates.length} hit(s))`,
    );
  }
  printCandidates(candidates);
}

/**
 * @param {{ file: string, name: string, display: string }[]} candidates
 * @param {string | undefined} pick
 * @returns {Promise<{ selected: { file: string, name: string, display: string }, how: string }>}
 */
async function selectCandidate(candidates, pick) {
  if (candidates.length === 1) {
    return { selected: candidates[0], how: 'only-match' };
  }

  if (pick != null) {
    const index = Number(pick);
    if (!Number.isInteger(index) || index < 1 || index > candidates.length) {
      throw new Error(`--pick must be an integer from 1 to ${candidates.length}`);
    }
    return { selected: candidates[index - 1], how: `--pick ${index}` };
  }

  let ttyIn;
  try {
    ttyIn = fs.createReadStream('/dev/tty');
  } catch {
    ttyIn = null;
  }
  if (!ttyIn || !process.stdout.isTTY) {
    console.error(
      `\nMultiple matches. Re-run with --pick N, or --proto path/to/file_proto.ts:${candidates[0].name}`,
    );
    process.exit(2);
  }

  const rl = readline.createInterface({ input: ttyIn, output: process.stdout });
  try {
    const answer = await rl.question(`Pick 1-${candidates.length}: `);
    const index = Number(answer.trim());
    if (!Number.isInteger(index) || index < 1 || index > candidates.length) {
      throw new Error(`Expected an integer from 1 to ${candidates.length}`);
    }
    return { selected: candidates[index - 1], how: `interactive pick ${index}` };
  } finally {
    rl.close();
    ttyIn.destroy();
  }
}

/**
 * @param {{ display: string }[]} candidates
 */
function printCandidates(candidates) {
  candidates.forEach((c, i) => {
    console.error(`  [${i + 1}] ${c.display}`);
  });
}

/**
 * @param {string | undefined} inputPath
 */
async function readInput(inputPath) {
  if (inputPath) {
    const resolved = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), inputPath);
    return fs.readFileSync(resolved, 'utf8');
  }
  if (process.stdin.isTTY) {
    throw new Error('No --input and stdin is a TTY. Pipe JSON or pass --input file.json');
  }
  return readStdin();
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

/**
 * @param {string} raw
 */
function parseInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Empty input');
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (decoded.startsWith('{') || decoded.startsWith('[')) {
        return JSON.parse(decoded);
      }
    } catch {
      // fall through
    }
  }

  return JSON.parse(trimmed);
}

/**
 * @param {{ file: string, name: string, display: string }} candidate
 * @param {object} json
 */
async function deserializeWithProto(candidate, json) {
  await ensureEsbuild();

  const alias = loadPathAliases();
  const entrySource = `import { ${candidate.name} as ProtoMessage } from ${JSON.stringify(candidate.file)};
export function decode(o: object) {
  if (ProtoMessage == null || typeof ProtoMessage.deserialize !== 'function') {
    throw new Error(${JSON.stringify(candidate.name)} + ' is not a deserializable proto export');
  }
  return ProtoMessage.deserialize(o);
}
`;

  const result = await esbuild.build({
    stdin: {
      contents: entrySource,
      resolveDir: path.dirname(candidate.file),
      sourcefile: 'canva-json-decode-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    absWorkingDir: REPO_ROOT,
    alias,
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const Module = require('module');
  const filename = path.join(path.dirname(candidate.file), 'canva-json-decode-entry.ts');
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(code, filename);

  if (typeof m.exports.decode !== 'function') {
    throw new Error(`Failed to load decode() for ${candidate.display}`);
  }
  return m.exports.decode(json);
}

let esbuildReady = false;
async function ensureEsbuild() {
  if (esbuildReady) {
    return;
  }
  esbuild = await loadEsbuildFromCanva();
  await esbuild.initialize();
  esbuildReady = true;
}

async function loadEsbuildFromCanva() {
  const candidates = [
    path.join(REPO_ROOT, 'node_modules/esbuild-wasm/lib/main.js'),
    path.join(REPO_ROOT, 'node_modules/esbuild-wasm/esm/browser.js'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    const mod = await import(pathToFileURL(candidate).href);
    return mod.default ?? mod;
  }
  throw new Error(
    `esbuild-wasm not found under ${REPO_ROOT}/node_modules. Run pnpm install in the Canva checkout.`,
  );
}

function loadPathAliases() {
  const raw = JSON.parse(fs.readFileSync(PATHS_JSON, 'utf8'));
  const paths = raw.compilerOptions?.paths ?? {};
  /** @type {Record<string, string>} */
  const alias = {};
  for (const [key, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) {
      continue;
    }
    const aliasKey = key.endsWith('/*') ? key.slice(0, -2) : key;
    let target = targets[0];
    if (target.endsWith('/*')) {
      target = target.slice(0, -2);
    }
    const abs = path.resolve(path.join(REPO_ROOT, 'web'), target);
    alias[aliasKey] = abs;
  }
  return alias;
}

function jsonReplacer(_key, value) {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  // Cursor/VS Code flag U+2028 (LS) and U+2029 (PS) as "unusual line terminators".
  // Canva copy/strings often contain them; turn them into normal newlines so JSON.stringify
  // emits `\n` instead of raw LS/PS in the temp file.
  if (typeof value === 'string' && /[\u2028\u2029]/.test(value)) {
    return value.replace(/\u2028/g, '\n').replace(/\u2029/g, '\n');
  }
  return value;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
