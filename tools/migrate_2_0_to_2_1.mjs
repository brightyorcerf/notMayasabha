/**
 * Migration: the ad-hoc fixture shape -> ARCHITECTURE-v2 §2 SiteDocument,
 * with the freeze-patch corrections (thickness_u, anchor+offset_u, seed_point_u,
 * one document-level meters_per_unit).
 *
 * Run once: node tools/migrate_2_0_to_2_1.mjs
 * The schema change, the migration and the fixture land in the same commit.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync('fixtures/site.json', 'utf8'));
if (src.doc_id) { console.log('already migrated'); process.exit(0); }

const USE = {
  HALL: 'HALL', OFFICE: 'OFFICE', SERVER: 'SERVER', CIRCULATION: 'CORRIDOR',
  STORE: 'STORE', STAIR: 'STAIRWELL', MEETING: 'HALL', UTILITY: 'PLANT',
};
const SWING = { DOOR: 'IN', ARCH: 'NONE', WINDOW: 'NONE' };
const p = src.manual_parameters;

const storeys = src.storeys.map((st) => ({
  id: st.id,
  index: st.level,
  name: st.name,
  source: { kind: 'MANUAL', rel_path: '', sha256: '' },
  transform: { tx_u: 0, ty_u: 0, rot_deg: 0 },
  elevation_m: st.base_m,
  floor_to_floor_m: Math.max(...st.walls.map((w) => w.height_m)),
  nodes: st.nodes,
  walls: st.walls.map((w) => ({
    id: w.id, a: w.a, b: w.b,
    thickness_u: w.thickness_u,
    height_m: w.height_m,
    base_offset_m: w.base_offset_m,
    height_source: w.height_source,
    wall_class: w.exterior ? 'EXTERIOR' : 'PARTITION',
    breachable: w.breachable,
    breach_note: w.breach_note,
    breach_origin: w.breach_origin,
    confidence: w.confidence,
    origin: 'HUMAN',
    verified: true,
  })),
  openings: st.openings.map((o) => ({
    id: o.id, wall_id: o.wall_id, anchor: o.anchor,
    offset_u: o.offset_u, width_u: o.width_u,
    sill_m: o.sill_m, head_m: o.head_m,
    kind: o.kind,
    swing: SWING[o.kind] ?? 'NONE',
    is_entry: o.is_entry, is_exit: o.is_exit,
    confidence: o.confidence,
    origin: 'HUMAN',
    verified: true,
  })),
  rooms: st.rooms.map((r) => ({
    id: r.id, seed_point_u: r.seed_point_u, name: r.name,
    use: USE[r.use] ?? 'UNKNOWN',
    confidence: r.confidence, origin: 'HUMAN', verified: true,
  })),
  status: 'DRAFT',
}));

const stairs = src.stairs.map((s) => {
  const from = src.storeys.find((x) => x.id === s.from_storey);
  const to = src.storeys.find((x) => x.id === s.to_storey);
  const rise = to.base_m - from.base_m;
  const xs = s.footprint_u.map((q) => q[0]), ys = s.footprint_u.map((q) => q[1]);
  const vertical = Math.abs(s.up_dir_u[1]) > Math.abs(s.up_dir_u[0]);
  return {
    id: s.id,
    kind: 'STRAIGHT',
    footprint_u: s.footprint_u,
    up_direction_u: s.up_dir_u,
    from_storey: s.from_storey, to_storey: s.to_storey,
    from_room: s.from_room, to_room: s.to_room,
    width_u: vertical ? Math.max(...xs) - Math.min(...xs) : Math.max(...ys) - Math.min(...ys),
    tread_m: s.tread_m,
    riser_m: s.riser_m,
    step_count: Math.round(rise / s.riser_m),
    confidence: s.confidence,
    origin: 'HUMAN',
    verified: true,
  };
});

const entries = [], exits = [];
for (const st of storeys) {
  for (const o of st.openings) {
    if (o.is_entry) entries.push({ opening_id: o.id, label: 'Main entry, south face', assigned_team: 'ALPHA' });
    if (o.is_exit) exits.push({ opening_id: o.id, label: 'Rear exit, north face' });
  }
}

const out = {
  schema_version: '2.1.0',
  doc_id: src.site_id,
  created_utc: src.created_utc,
  modified_utc: src.created_utc,
  status: 'DRAFT',
  building: { name: src.name, site_type: 'GOVT', notes: 'Hand-authored two-storey fixture. The frozen contract every other module is built against.' },
  georef: {
    mode: 'ANCHORED',
    origin_lat: src.georef.lat,
    origin_lon: src.georef.lon,
    heading_deg: src.georef.bearing_deg,
  },
  defaults: {
    wall_height_m: p.storey_height_m,
    ext_wall_thickness_u: p.ext_wall_thickness_u,
    int_wall_thickness_u: p.int_wall_thickness_u,
    door_height_m: p.door_head_m,
    window_sill_m: 0.9,
    window_head_m: 2.2,
  },
  manual_parameters: {
    length_u: p.length_u,
    breadth_u: p.breadth_u,
    storey_height_m: p.storey_height_m,
    stair_count: src.stairs.length,
    source: 'USER',
  },
  scale: {
    state: 'VALIDATED',
    meters_per_unit: 1.0,
    method: 'CALIBRATION_SEGMENT',
    calibration: { p0: [0, 0], p1: [20, 0], real_length_m: 20.0 },
    checks: [],
    evidence: [{ text: 'south elevation, gridline A to E', unit: 'm', measured_u: 20, mpu: 1.0 }],
    dispersion: 0.0,
    confidence: 1.0,
    set_by: 'USER',
    set_at: src.created_utc,
  },
  storeys,
  stairs,
  briefing: { entry_points: entries, exit_points: exits, routes: [], markers: [] },
  provenance: {
    created_by: 'hand-authored',
    tool: 'NotMayasabha',
    tool_version: '0.1.0',
    source_files: [],
  },
};

writeFileSync('fixtures/site.json', JSON.stringify(out, null, 2) + '\n');
console.log(`migrated: ${storeys.length} storeys, ${storeys.reduce((a, s) => a + s.walls.length, 0)} walls, entries=${entries.length}`);
