#!/usr/bin/env node
/**
 * Refuse raw SQL that references a column the database does not have.
 *
 * WHY THIS EXISTS: in one feature, four column names were written from memory
 * instead of from the schema, and every one of them passed `tsc` cleanly:
 *
 *   carts.expires_at          the pickup deadline lives on products
 *   cart_items.created_at     the column is added_at
 *   products.reserved_until   the column is reservation_expires_at
 *   shopper_sessions.revoked_at   that column belongs to the STAFF sessions
 *                                 table; this one never had it
 *
 * The last one was the worst: it sat inside a SECURITY DEFINER function, so
 * `CREATE OR REPLACE FUNCTION` accepted it happily (Postgres parses the body,
 * it does not resolve columns) and the migration applied cleanly while leaving
 * erasure dead for every caller. TypeScript cannot see inside a SQL string and
 * a migration that applies is not a migration that works, so this gate is the
 * only thing standing between "it compiled" and "it runs".
 *
 * How it works: for each raw SQL literal, resolve table aliases from FROM,
 * JOIN, UPDATE, DELETE FROM and USING clauses, then check every `alias.column`
 * against a snapshot of the real schema. Unknown aliases are skipped rather
 * than guessed at, so CTEs and subquery aliases produce no false alarms.
 *
 * The snapshot lives in packages/db/schema-snapshot/columns.json. Refresh it
 * with: npm run schema:snapshot
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SNAPSHOT = join(ROOT, 'packages/db/schema-snapshot/columns.json');

/** @type {Record<string, string[]>} */
const schema = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const columnsOf = new Map(Object.entries(schema).map(([t, c]) => [t, new Set(c)]));

/** Words that follow a table name but are not aliases. */
const NOT_AN_ALIAS = new Set([
  'set', 'where', 'on', 'using', 'join', 'inner', 'left', 'right', 'full',
  'outer', 'cross', 'group', 'order', 'limit', 'returning', 'values', 'as',
  'select', 'from', 'and', 'or', 'union', 'having', 'window', 'for', 'lateral',
]);

/** Pull every raw SQL string out of a TypeScript source file. */
function sqlLiterals(source) {
  const out = [];
  // Tagged template literals: sql`...`, drizzleSql`...`, tx`...`
  const re = /(?:sql|drizzleSql|tx|s)\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const before = source.slice(0, m.index);
    out.push({ text: m[1], line: before.split('\n').length });
  }
  return out;
}

/** alias -> table, from the clauses that actually introduce a table. */
function aliasMap(sql) {
  const map = new Map();
  const re =
    /\b(?:from|join|update|delete\s+from|using|into)\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s*(?:\bas\b\s+)?([a-z_][a-z0-9_]*)?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    if (!columnsOf.has(table)) continue; // CTE, function, or unknown: skip
    map.set(table, table); // the table name is always a valid qualifier
    const alias = (m[2] ?? '').toLowerCase();
    if (alias && !NOT_AN_ALIAS.has(alias)) map.set(alias, table);
  }
  return map;
}

/** Strip comments and placeholders so they cannot look like references. */
function normalise(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ? ');
}

function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const problems = [];
  for (const { text, line } of sqlLiterals(source)) {
    const sql = normalise(text);
    if (!/\b(select|insert|update|delete)\b/i.test(sql)) continue;
    const aliases = aliasMap(sql);
    if (aliases.size === 0) continue;

    // UPDATE <table> [alias] SET col = ..., col = ...
    // The assignment targets are UNQUALIFIED and belong unambiguously to the
    // updated table, so they can be checked directly. This is the shape that
    // hid products.reserved_until: qualified references were all correct
    // while the SET list named a column that does not exist.
    const setRe = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\b([\s\S]*?)(?=\bfrom\b|\bwhere\b|\breturning\b|$)/gi;
    let u;
    while ((u = setRe.exec(sql)) !== null) {
      const table = u[1].toLowerCase();
      const cols = columnsOf.get(table);
      if (!cols) continue;
      const assignRe = /(^|,)\s*([a-z_][a-z0-9_]*)\s*=/gi;
      let a;
      while ((a = assignRe.exec(u[2])) !== null) {
        const column = a[2].toLowerCase();
        if (cols.has(column)) continue;
        const near = [...cols]
          .filter((c) => c.includes(column.split('_')[0]) || column.includes(c.split('_')[0]))
          .slice(0, 3);
        problems.push({
          file: relative(ROOT, file),
          line: line + sql.slice(0, u.index).split('\n').length - 1,
          ref: `${table}.${column} (in SET)`,
          table,
          near,
        });
      }
    }

    const refRe = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
    let r;
    const seen = new Set();
    while ((r = refRe.exec(sql)) !== null) {
      const qualifier = r[1].toLowerCase();
      const column = r[2].toLowerCase();
      const table = aliases.get(qualifier);
      if (!table) continue; // unknown qualifier: not ours to judge
      const cols = columnsOf.get(table);
      if (!cols || cols.has(column)) continue;
      const key = `${qualifier}.${column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Suggest the closest real column, which is usually the intended one.
      const near = [...cols]
        .filter((c) => c.includes(column.split('_')[0]) || column.includes(c.split('_')[0]))
        .slice(0, 3);
      problems.push({
        file: relative(ROOT, file),
        line: line + sql.slice(0, r.index).split('\n').length - 1,
        ref: key,
        table,
        near,
      });
    }
  }
  return problems;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.ts$/.test(entry)) acc.push(full);
  }
  return acc;
}

const targets = [join(ROOT, 'apps/api-cloud/src'), join(ROOT, 'apps/worker/src')];
const files = targets.flatMap((t) => {
  try {
    return walk(t);
  } catch {
    return [];
  }
});

const all = files.flatMap(scanFile);

if (all.length > 0) {
  console.error('SQL references columns that do not exist:\n');
  for (const p of all) {
    console.error(`  ${p.file}:${p.line}  ${p.ref}`);
    console.error(
      `      ${p.table} has no "${p.ref.split('.')[1]}"` +
        (p.near.length ? `. Did you mean: ${p.near.join(', ')}?` : '.'),
    );
  }
  console.error(
    `\nChecked ${files.length} files against ${columnsOf.size} tables.\n` +
      'If the schema changed, refresh the snapshot: npm run schema:snapshot',
  );
  process.exit(1);
}

console.log(`✓ SQL column references valid across ${files.length} files`);
