#!/usr/bin/env node
/**
 * validate-schema.mjs
 *
 * Save gate: validates a complete KnowledgeGraph with the same
 * `validateGraph` the dashboard runs on load. The dashboard silently drops
 * schema-invalid nodes/edges (e.g. a string `lineRange` instead of a
 * `[number, number]` tuple), so a graph that passes the inline structural
 * check can still lose nodes in the UI. This script fails loudly instead.
 *
 * Usage:
 *   node validate-schema.mjs <graphPath> [--report <outPath>]
 *
 * Exit codes:
 *   0  graph accepted as-is (auto-corrected defaults are reported, not fatal)
 *   1  fatal error, any dropped node/edge/layer/tour entry, or count loss
 *   2  usage error / unreadable input
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePluginRoot() {
  const envRoot = process.env.PLUGIN_ROOT;
  if (envRoot && existsSync(join(envRoot, 'package.json'))) return envRoot;
  return resolve(__dirname, '../..');
}

const args = process.argv.slice(2);
const graphPath = args[0];
const reportIdx = args.indexOf('--report');
const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : null;
if (!graphPath || (reportIdx >= 0 && !reportPath)) {
  console.error('Usage: node validate-schema.mjs <graphPath> [--report <outPath>]');
  process.exit(2);
}

const pluginRoot = resolvePluginRoot();
const require = createRequire(resolve(pluginRoot, 'package.json'));
let core;
try {
  core = await import(pathToFileURL(require.resolve('@understand-anything/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { validateGraph } = core;

let graph;
try {
  graph = JSON.parse(readFileSync(graphPath, 'utf8'));
} catch (err) {
  console.error(`validate-schema: cannot read ${graphPath}: ${err.message}`);
  process.exit(2);
}

const result = validateGraph(graph);
const issues = Array.isArray(result.issues) ? result.issues : [];
const dropped = issues.filter((i) => i.level === 'dropped');
const autoCorrected = issues.filter((i) => i.level === 'auto-corrected');

const count = (g, key) => (Array.isArray(g?.[key]) ? g[key].length : 0);
const losses = [];
for (const key of ['nodes', 'edges', 'layers', 'tour']) {
  const before = count(graph, key);
  const after = count(result.data, key);
  if (result.success && after < before) losses.push(`${key}: ${before} -> ${after}`);
}

const blocked = !result.success || Boolean(result.fatal) || dropped.length > 0 || losses.length > 0;
const report = {
  accepted: !blocked,
  fatal: result.fatal ?? null,
  dropped: dropped.map((i) => i.message),
  losses,
  autoCorrected: autoCorrected.length,
};
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (blocked) {
  console.error(`validate-schema: REJECTED ${graphPath}`);
  if (result.fatal) console.error(`  fatal: ${result.fatal}`);
  for (const m of report.dropped.slice(0, 50)) console.error(`  dropped: ${m}`);
  if (report.dropped.length > 50) console.error(`  ... ${report.dropped.length - 50} more`);
  for (const l of losses) console.error(`  count loss: ${l}`);
  process.exit(1);
}

console.log(
  `Schema OK: ${count(result.data, 'nodes')} nodes, ${count(result.data, 'edges')} edges` +
    (autoCorrected.length ? ` (${autoCorrected.length} auto-corrected defaults)` : ''),
);
