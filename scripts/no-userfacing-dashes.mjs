#!/usr/bin/env node
/*
 * no-userfacing-dashes.mjs — house-style guard.
 *
 * Basel's standing rule: NO em dash (U+2014) or en dash (U+2013) in any
 * user-facing UI text. This fails (exit 1) if such a dash reaches operator-facing
 * desktop source, so the repo-wide 2026-07-08 dash purge can never silently rot.
 *
 * It is COMMENT-AWARE: it strips `/* ... *\/` blocks (including the JSX `{/* *\/}`
 * form, which is the same tokens) and `//` line comments before looking, so a
 * dash in a code comment or JSDoc is allowed (comments are not rendered).
 * `console.*` lines are skipped (developer logs, not UI). The comment stripper is
 * deliberately conservative: when unsure it treats text AS a comment, so its only
 * failure mode is a MISSED dash (never a false alarm that blocks a clean merge).
 *
 * Usage: node scripts/no-userfacing-dashes.mjs   (exit 1 on any hit)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps/tauri-pos/src', 'apps/control-desktop/src'];
const EM = '—';
const EN = '–';

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/\.d\.ts$/.test(p)) out.push(p);
  }
  return out;
}

/** Remove `/* *\/` blocks (tracked across lines) and `//` tails from one line. */
function stripComments(line, state) {
  let out = '';
  let j = 0;
  while (j < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', j);
      if (end === -1) return { out, state };
      state.inBlock = false;
      j = end + 2;
    } else {
      const start = line.indexOf('/*', j);
      const lineC = line.indexOf('//', j);
      if (start !== -1 && (lineC === -1 || start < lineC)) {
        out += line.slice(j, start);
        state.inBlock = true;
        j = start + 2;
      } else if (lineC !== -1) {
        out += line.slice(j, lineC);
        return { out, state };
      } else {
        out += line.slice(j);
        return { out, state };
      }
    }
  }
  return { out, state };
}

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root), [])) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const state = { inBlock: false };
    for (let i = 0; i < lines.length; i++) {
      const { out } = stripComments(lines[i], state);
      if (!out.includes(EM) && !out.includes(EN)) continue;
      if (/\bconsole\.(log|warn|error|info|debug)\b/.test(out)) continue;
      hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

if (hits.length) {
  console.error('House-style FAIL: em/en dash in user-facing UI text.');
  console.error('Use a comma, a full stop, or "bis" (ranges). Code comments are exempt.');
  for (const h of hits) console.error('  ' + h);
  console.error(`Total: ${hits.length}`);
  process.exit(1);
}
console.log('House-style: no em/en dash in user-facing UI text. Clean.');
