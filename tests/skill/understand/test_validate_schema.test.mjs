import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
const SCRIPT = resolve(REPO, 'understand-anything-plugin/skills/understand/validate-schema.mjs');
const SKILL = resolve(REPO, 'understand-anything-plugin/skills/understand/SKILL.md');

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function baseGraph() {
  return {
    version: '1.0.0',
    project: {
      name: 'fixture',
      languages: ['python'],
      frameworks: [],
      description: 'fixture graph',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      gitCommitHash: 'abc123',
    },
    nodes: [
      { id: 'file:a.py', type: 'file', name: 'a.py', filePath: 'a.py', summary: 'A', tags: ['x'], complexity: 'simple' },
      {
        id: 'function:a.py:f', type: 'function', name: 'f', filePath: 'a.py', summary: 'F', tags: ['x'],
        complexity: 'simple', lineRange: [1, 5],
      },
    ],
    edges: [{ source: 'file:a.py', target: 'function:a.py:f', type: 'contains', direction: 'forward', weight: 1 }],
    layers: [{ id: 'layer:core', name: 'Core', description: 'core', nodeIds: ['file:a.py'] }],
    tour: [{ order: 1, title: 'Start', description: 'start', nodeIds: ['file:a.py'] }],
  };
}

function run(graph, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'ua-schema-gate-'));
  dirs.push(dir);
  const p = join(dir, 'graph.json');
  writeFileSync(p, JSON.stringify(graph));
  const res = spawnSync('node', [SCRIPT, p, ...extra], { encoding: 'utf-8' });
  return { ...res, dir };
}

describe('dashboard schema save gate', () => {
  it('accepts a graph the dashboard would load without dropping anything', () => {
    const res = run(baseGraph());
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Schema OK: 2 nodes, 1 edges/);
  });

  it('rejects a prose lineRange that the dashboard would silently drop', () => {
    const g = baseGraph();
    g.nodes[0].lineRange = 'only module-level constants';
    const res = run(g);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/REJECTED/);
    expect(res.stderr).toMatch(/dropped: nodes\[0\] \("a\.py"\): .*tuple/);
  });

  it('writes a machine-readable report listing what would be dropped', () => {
    const g = baseGraph();
    g.nodes[1].lineRange = 'bad';
    const dir = mkdtempSync(join(tmpdir(), 'ua-schema-gate-'));
    dirs.push(dir);
    const out = join(dir, 'report.json');
    const res = run(g, ['--report', out]);
    expect(res.status).toBe(1);
    const report = JSON.parse(readFileSync(out, 'utf-8'));
    expect(report.accepted).toBe(false);
    expect(report.dropped.length).toBeGreaterThan(0);
  });

  it('is wired into both the full-analysis and incremental save paths of /understand', () => {
    const skill = readFileSync(SKILL, 'utf-8');
    const calls = skill.match(/node "<SKILL_DIR>\/validate-schema\.mjs"/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(skill).toMatch(/Never delete a node or edge to pass the gate/);
    expect(skill).toMatch(/dashboard schema gate passed/);
  });
});
