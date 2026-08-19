/**
 * Structural prevention (ARCHITECTURE-v2 §6). The kill-switch catches mistakes at
 * runtime; this lint prevents them at build time.
 *
 * Rule 1: no module may import a layer above itself.
 * Rule 2: no module below the app layer may reach the network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LAYER = { core: 0, geometry: 1, analysis: 2, geo: 2, view2d: 3, view3d: 3, ui: 4 };
const NET = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection)\b/;
const NET_ALLOWED = new Set(['src/core/netguard.ts', 'src/ui/exportGlb.ts', 'src/ui/app.ts']);

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})('src');

const errs = [];
for (const f of files) {
  const rel = relative('.', f).replace(/\\/g, '/');
  const parts = rel.split('/');
  const layerName = parts[1];
  const mine = LAYER[layerName];
  const src = readFileSync(f, 'utf8');

  if (mine !== undefined) {
    for (const m of src.matchAll(/from '(\.\.?\/[^']+)'/g)) {
      const target = m[1];
      const seg = target.split('/').filter((x) => x !== '..' && x !== '.')[0];
      const theirs = LAYER[seg];
      if (theirs !== undefined && theirs > mine) {
        errs.push(`${rel}: imports UP from layer ${mine} (${layerName}) to layer ${theirs} (${seg})`);
      }
    }
  }

  // Rule 2 — the runtime kill-switch and the two places that legitimately touch
  // browser download/URL APIs are the only exemptions, and they are named here.
  if (!NET_ALLOWED.has(rel) && NET.test(src)) {
    const line = src.split('\n').findIndex((l) => NET.test(l)) + 1;
    errs.push(`${rel}:${line}: network API below the app layer`);
  }
}

if (errs.length) {
  errs.forEach((e) => console.log('FAIL ' + e));
  process.exit(1);
}
console.log(`lint-layers OK — ${files.length} modules, no upward imports, no network below the app layer`);
