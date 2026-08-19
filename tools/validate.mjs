// Fixture sanity check. Catches authoring typos before the app ever loads.
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync('fixtures/site.json', 'utf8'));
const errs = [], warns = [];
const len = (n1, n2) => Math.hypot(n2.x_u - n1.x_u, n2.y_u - n1.y_u);
for (const st of s.storeys) {
  const N = new Map(st.nodes.map(n => [n.id, n]));
  const W = new Map(st.walls.map(w => [w.id, w]));
  const deg = new Map();
  for (const w of st.walls) {
    if (!N.has(w.a)) errs.push(`${w.id}: node a ${w.a} missing`);
    if (!N.has(w.b)) errs.push(`${w.id}: node b ${w.b} missing`);
    if (!N.has(w.a) || !N.has(w.b)) continue;
    const L = len(N.get(w.a), N.get(w.b));
    if (L < 1e-6) errs.push(`${w.id}: zero length`);
    deg.set(w.a, (deg.get(w.a) || 0) + 1);
    deg.set(w.b, (deg.get(w.b) || 0) + 1);
    if (w.base_offset_m !== st.elevation_m) errs.push(`${w.id}: base_offset_m ${w.base_offset_m} != storey elevation ${st.elevation_m}`);
  }
  for (const n of st.nodes) if (!deg.has(n.id)) errs.push(`${st.id}: node ${n.id} is orphaned`);
  for (const [id, d] of deg) if (d === 1) warns.push(`${st.id}: node ${id} has degree 1 (dangling)`);
  // coincident nodes
  for (let i = 0; i < st.nodes.length; i++) for (let j = i + 1; j < st.nodes.length; j++)
    if (len(st.nodes[i], st.nodes[j]) < 1e-6) errs.push(`${st.id}: nodes ${st.nodes[i].id}/${st.nodes[j].id} coincident`);
  const byWall = new Map();
  for (const o of st.openings) {
    const w = W.get(o.wall_id);
    if (!w) { errs.push(`${o.id}: wall ${o.wall_id} missing`); continue; }
    const L = len(N.get(w.a), N.get(w.b));
    if (o.offset_u < 0) errs.push(`${o.id}: negative offset`);
    if (o.offset_u + o.width_u > L + 1e-9) errs.push(`${o.id}: offset+width ${(o.offset_u + o.width_u).toFixed(3)} exceeds wall ${o.wall_id} length ${L.toFixed(3)}`);
    if (o.head_m > w.height_m) errs.push(`${o.id}: head_m above wall height`);
    if (o.sill_m >= o.head_m) errs.push(`${o.id}: sill >= head`);
    const arr = byWall.get(o.wall_id) || []; arr.push(o); byWall.set(o.wall_id, arr);
  }
  for (const [wid, arr] of byWall) {
    arr.sort((a, b) => a.offset_u - b.offset_u);
    for (let i = 1; i < arr.length; i++)
      if (arr[i].offset_u < arr[i - 1].offset_u + arr[i - 1].width_u - 1e-9)
        errs.push(`${wid}: openings ${arr[i - 1].id} and ${arr[i].id} overlap`);
  }
  const ids = new Set();
  for (const x of [...st.nodes, ...st.walls, ...st.openings, ...st.rooms]) {
    if (ids.has(x.id)) errs.push(`duplicate id ${x.id}`);
    ids.add(x.id);
  }
}
const stIds = new Set(s.storeys.map(x => x.id));
for (const t of s.stairs) {
  if (!stIds.has(t.from_storey) || !stIds.has(t.to_storey)) errs.push(`${t.id}: bad storey ref`);
}
console.log(`storeys=${s.storeys.length} walls=${s.storeys.reduce((a, x) => a + x.walls.length, 0)} openings=${s.storeys.reduce((a, x) => a + x.openings.length, 0)} rooms=${s.storeys.reduce((a, x) => a + x.rooms.length, 0)} stairs=${s.stairs.length}`);
warns.forEach(w => console.log('WARN ' + w));
if (errs.length) { errs.forEach(e => console.log('FAIL ' + e)); process.exit(1); }
console.log('FIXTURE OK');
