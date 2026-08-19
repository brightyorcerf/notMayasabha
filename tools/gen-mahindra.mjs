// Generator for the Mahindra plan fixture.
//
// The engine has only straight walls between shared nodes, so every curve in the
// blueprint (the radial ECR fan, the curved upper wing) is approximated by short
// chord segments, and every room is emitted as a watertight wall loop so the flood
// fill cannot leak. Output: fixtures/site.json. Not on the runtime path.
//
// Layout, in document units, y pointing DOWN to match the drawing:
//   - Lobby (west), a horizontal corridor with a Toilet block,
//   - a central Rotunda (half-disc) the radial rooms open into,
//   - Auditorium + ECR 1..6 as sectors of a lower semicircular ring,
//   - a curved upper Wing gallery with six Faculty rooms,
//   - a Stairwell at the east end.

import { writeFileSync } from 'node:fs';

const DEG = Math.PI / 180;
const round = (v) => Math.round(v * 1000) / 1000;

const EXT = 0.23;
const INT = 0.115;
const H = 3.2;

// ---------------------------------------------------------------- registries
const nodes = [];
const nodeByKey = new Map();
const walls = [];
const openings = [];
const rooms = [];
let wSeq = 0, oSeq = 0;

function node(x, y) {
  x = round(x); y = round(y);
  const key = `${x},${y}`;
  let id = nodeByKey.get(key);
  if (id) return id;
  id = `n${nodes.length}`;
  nodes.push({ id, x_u: x, y_u: y });
  nodeByKey.set(key, id);
  return id;
}

function wall(x0, y0, x1, y1, cls, opts = {}) {
  const a = node(x0, y0), b = node(x1, y1);
  const A = nodeByKey.get(`${round(x0)},${round(y0)}`);
  const B = nodeByKey.get(`${round(x1)},${round(y1)}`);
  void A; void B;
  const ax = round(x0), ay = round(y0), bx = round(x1), by = round(y1);
  const length = Math.hypot(bx - ax, by - ay);
  if (length < 1e-6) return null; // collapsed by rounding; skip
  const id = opts.id ?? `w-${wSeq++}`;
  const w = {
    id, a, b,
    thickness_u: cls === 'EXTERIOR' ? EXT : INT,
    height_m: H, base_offset_m: 0, height_source: 'USER',
    wall_class: cls,
    breachable: !!opts.breachable,
    breach_note: opts.breach_note ?? '',
    breach_origin: opts.breachable ? 'HUMAN' : null,
    confidence: 1, origin: 'HUMAN', verified: true,
    ax, ay, bx, by, length, // scratch, stripped before write
  };
  walls.push(w);
  return w;
}

function opening(w, centerDist, width, kind, opts = {}) {
  if (!w) return;
  const offset = centerDist - width / 2;
  const sill = opts.sill ?? 0;
  const head = opts.head ?? 2.1;
  openings.push({
    id: opts.id ?? `o-${oSeq++}`,
    wall_id: w.id,
    anchor: 'FROM_A',
    offset_u: round(offset),
    width_u: width,
    sill_m: sill, head_m: head,
    kind, swing: opts.swing ?? (kind === 'WINDOW' || kind === 'ARCH' ? 'NONE' : 'IN'),
    is_entry: !!opts.entry, is_exit: !!opts.exit,
    confidence: 1, origin: 'HUMAN', verified: true,
  });
}

/** Centre a door/window on a single wall segment. */
function centerOpening(w, width, kind, opts) { opening(w, w ? w.length / 2 : 0, width, kind, opts); }

function room(x, y, name, use) {
  rooms.push({
    id: opts_id(name), seed_point_u: [round(x), round(y)], name, use,
    confidence: 1, origin: 'HUMAN', verified: true,
  });
}
function opts_id(name) { return 'r-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

const P = (cx, cy, r, aDeg) => [cx + r * Math.cos(aDeg * DEG), cy + r * Math.sin(aDeg * DEG)];

/** Chain of chord walls approximating an arc; returns the segment walls in order. */
function arc(cx, cy, r, a0, a1, cls, opts = {}) {
  const maxStep = opts.maxStep ?? 7;
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / maxStep));
  const segs = [];
  let [px, py] = P(cx, cy, r, a0);
  for (let i = 1; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const [x, y] = P(cx, cy, r, a);
    const w = wall(px, py, x, y, cls, opts);
    if (w) segs.push(w);
    px = x; py = y;
  }
  return segs;
}

/** A straight run along a horizontal line, split at every x in `xs` (sorted). */
function hline(y, xs, cls, opts = {}) {
  const s = [...new Set(xs.map(round))].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const w = wall(s[i], y, s[i + 1], y, cls, opts);
    if (w) segs.push(w);
  }
  return segs;
}
/** Return the segment from `segs` whose midpoint x is nearest `x`. */
function segAtX(segs, x) {
  let best = null, bd = Infinity;
  for (const w of segs) { const mx = (w.ax + w.bx) / 2; const d = Math.abs(mx - x); if (d < bd) { bd = d; best = w; } }
  return best;
}

// ================================================================ geometry

// ---- lower ring: rotunda + auditorium + ECR 1..6 ------------------------
const O = [40, 26];
const Ri = 8, Ro = 20;
// boundary angles, 0=east .. 180=west; 7 sectors
const bnds = [0, 24, 48, 72, 96, 120, 150, 180];
const ringNames = ['ECR 6', 'ECR 5', 'ECR 4', 'ECR 3', 'ECR 2', 'ECR 1', 'Auditorium'];
const ringUse = ['CLASSROOM', 'CLASSROOM', 'CLASSROOM', 'CLASSROOM', 'CLASSROOM', 'CLASSROOM', 'HALL'];

for (let i = 0; i < ringNames.length; i++) {
  const a0 = bnds[i], a1 = bnds[i + 1];
  const inner = arc(O[0], O[1], Ri, a0, a1, 'PARTITION', { maxStep: 999 }); // one chord: fits a door
  arc(O[0], O[1], Ro, a0, a1, 'EXTERIOR');
  // interior radial dividers only (the a=0 and a=180 ends lie on the y=26 line)
  if (a0 !== 0) {
    const [ix, iy] = P(O[0], O[1], Ri, a0), [ox, oy] = P(O[0], O[1], Ro, a0);
    wall(ix, iy, ox, oy, 'PARTITION', { id: `w-rad-${a0}` });
  }
  // door from this room into the rotunda, on its first inner-arc segment
  centerOpening(inner[0], 1.0, 'DOOR');
  // a window on the outer wall (mid sector), high sill so it is not a way through
  const mid = (a0 + a1) / 2;
  const [wx, wy] = P(O[0], O[1], Ro, mid);
  const seed = P(O[0], O[1], (Ri + Ro) / 2, mid);
  room(seed[0], seed[1], ringNames[i], ringUse[i]);
  void wx; void wy;
}
// Rotunda (half-disc) — bounded by the ring inner arcs (a=0..180) and the y=26 top.
room(40, 30, 'Rotunda', 'HALL');

// ---- the two long horizontal lines (y=22 north, y=26 south) -------------
// south / corridor floor line
const southXs = [12, 20, 32, 48, 54, 60];
const south = hline(26, southXs, 'EXTERIOR');
// rotunda <-> corridor arch on the 32..48 segment
opening(segAtX(south, 40), 40 - 32, 1.4, 'ARCH');

// north / corridor ceiling + gallery floor line
const northXs = [12, 26, 32, 38, 40, 54, 60, 64];
const north = hline(22, northXs, 'EXTERIOR');
// corridor <-> gallery arch on the 40..54 segment, centred at x=45
opening(segAtX(north, 47), 45 - 40, 1.4, 'ARCH');

// ---- Lobby --------------------------------------------------------------
// west wall split so corridor walls can attach at y=22 and y=26
const lobbyW = [];
lobbyW.push(wall(2, 17, 2, 25, 'EXTERIOR'));
const lobbyEntry = wall(2, 25, 2, 27, 'EXTERIOR');
lobbyW.push(lobbyEntry);
lobbyW.push(wall(2, 27, 2, 35, 'EXTERIOR'));
opening(lobbyEntry, 1.0, 1.2, 'DOOR', { entry: true, id: 'o-entry' }); // main entry
wall(2, 17, 12, 17, 'EXTERIOR');   // lobby north
wall(2, 35, 12, 35, 'EXTERIOR');   // lobby south
// lobby east wall, split at the corridor band (y22, y26)
wall(12, 17, 12, 22, 'EXTERIOR');
const lobbyDoor = wall(12, 22, 12, 26, 'INTERIOR');
wall(12, 26, 12, 35, 'EXTERIOR');
opening(lobbyDoor, 2, 1.0, 'DOOR'); // lobby -> corridor
room(7, 26, 'Lobby', 'HALL');

// ---- Corridor sides -----------------------------------------------------
wall(54, 22, 54, 26, 'INTERIOR', { id: 'w-corr-e' }); // corridor east wall / stairwell west
room(16, 24, 'Main Corridor', 'CORRIDOR');

// ---- Toilet block (inside the corridor's upper strip) -------------------
wall(26, 22, 26, 24, 'PARTITION');
wall(32, 22, 32, 24, 'PARTITION');
const toiletS = wall(26, 24, 32, 24, 'PARTITION');
opening(toiletS, 3, 0.9, 'DOOR'); // toilet -> corridor
room(29, 23, 'Toilet', 'TOILET');

// ---- Stairwell ----------------------------------------------------------
wall(60, 22, 60, 26, 'EXTERIOR'); // stairwell east (also building east edge here)
const stairDoor = wall(54, 22, 54, 26, 'INTERIOR'); void stairDoor; // already have corridor east; add door there
opening(walls.find((w) => w.id === 'w-corr-e'), 2, 1.0, 'DOOR'); // corridor -> stairwell
room(57, 24, 'Stairwell', 'STAIRWELL');

// ---- Upper Wing: a straight gallery with six Faculty rooms (top-right) ---
// Rectangles above the corridor (y < 22); rooms open down into the gallery,
// the gallery opens into the main corridor through the y=22 arch.
const wx0 = 38, wx1 = 64, wyTop = 8, wyMid = 16, wyBot = 22;
const facN = 6;
const vxs = [];
for (let i = 0; i <= facN; i++) vxs.push(round(wx0 + ((wx1 - wx0) * i) / facN));
// gallery box sides (bottom is the shared y=22 line, extended below)
wall(wx0, wyMid, wx0, wyBot, 'EXTERIOR');
wall(wx1, wyMid, wx1, wyBot, 'EXTERIOR');
// gallery <-> faculty dividing line, one door per room
const galTop = hline(wyMid, vxs, 'PARTITION');
galTop.forEach((seg, i) => { centerOpening(seg, 1.0, 'DOOR'); void i; });
// faculty room top wall (split at each divider so nothing dangles) + vertical dividers
hline(wyTop, vxs, 'EXTERIOR');
for (let i = 0; i <= facN; i++) {
  const cls = (i === 0 || i === facN) ? 'EXTERIOR' : 'PARTITION';
  wall(vxs[i], wyTop, vxs[i], wyMid, cls);
}
for (let i = 0; i < facN; i++) {
  room((vxs[i] + vxs[i + 1]) / 2, (wyTop + wyMid) / 2, `Faculty ${i + 1}`, 'OFFICE');
}
room(41, 19, 'Wing Gallery', 'CORRIDOR');

// ================================================================ assemble

// bounding box for the manual footprint parameter (makes BBOX_VS_MANUAL exact)
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const n of nodes) {
  minX = Math.min(minX, n.x_u); maxX = Math.max(maxX, n.x_u);
  minY = Math.min(minY, n.y_u); maxY = Math.max(maxY, n.y_u);
}
const lengthU = round(maxX - minX);
const breadthU = round(maxY - minY);

for (const w of walls) { delete w.ax; delete w.ay; delete w.bx; delete w.by; delete w.length; }

const doc = {
  schema_version: '2.1.0',
  doc_id: 'site-mahindra-0001',
  created_utc: '2026-08-19T00:00:00Z',
  modified_utc: '2026-08-19T00:00:00Z',
  status: 'DRAFT',
  building: {
    name: 'Mahindra Block (from 2D blueprint)',
    site_type: 'SCHOOL',
    notes: 'Faithful schematic of the mahindra.jpeg floor plan: lobby, corridor, toilet, ' +
      'central rotunda, auditorium, six ECR rooms on a radial fan, a curved faculty wing, and a stair. ' +
      'Curves are chord-approximated; one storey.',
  },
  georef: { mode: 'ANCHORED', origin_lat: 17.4, origin_lon: 78.35, heading_deg: 0 },
  defaults: {
    wall_height_m: H, ext_wall_thickness_u: EXT, int_wall_thickness_u: INT,
    door_height_m: 2.1, window_sill_m: 0.9, window_head_m: 2.2,
  },
  manual_parameters: { length_u: lengthU, breadth_u: breadthU, storey_height_m: H, stair_count: 1, source: 'USER' },
  scale: {
    state: 'VALIDATED', meters_per_unit: 1, method: 'CALIBRATION_SEGMENT',
    calibration: { p0: [0, 0], p1: [20, 0], real_length_m: 20 },
    checks: [],
    evidence: [{ text: 'lobby to corridor gridline', unit: 'm', measured_u: 20, mpu: 1 }],
    dispersion: 0, confidence: 1, set_by: 'USER', set_at: '2026-08-19T00:00:00Z',
  },
  storeys: [{
    id: 'st-ground', index: 0, name: 'Ground Floor',
    source: { kind: 'RASTER', rel_path: 'mahindra.jpeg', sha256: '' },
    transform: { tx_u: 0, ty_u: 0, rot_deg: 0 },
    elevation_m: 0, floor_to_floor_m: H,
    nodes, walls, openings, rooms, status: 'DRAFT',
  }],
  stairs: [],
  briefing: {
    entry_points: [{ opening_id: 'o-entry', label: 'Main entry, Lobby west face', assigned_team: 'ALPHA' }],
    exit_points: [],
    routes: [], markers: [],
  },
  provenance: {
    created_by: 'gen-mahindra.mjs', tool: 'NotMayasabha', tool_version: '0.1.0',
    source_files: [{ rel_path: 'mahindra.jpeg', sha256: '', kind: 'RASTER' }],
  },
};

writeFileSync('fixtures/site.json', JSON.stringify(doc, null, 2));
console.log(`wrote fixtures/site.json  nodes=${nodes.length} walls=${walls.length} openings=${openings.length} rooms=${rooms.length}  bbox=${lengthU}x${breadthU}`);
