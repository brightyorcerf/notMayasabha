# Mayasabha — ARCHITECTURE

**SIH1773 — Conversion of 2D Blueprints into 3D Model. National Security Guard, MHA.**

This is the source of truth for the system design. It merges `ARCHITECTURE-v2.md` (the
merged design) and `FREEZE-PATCH-v2.1.md` (the corrections applied on top of it) into one
document. Where those two disagreed, the freeze patch won, because it was written later
and against a schema that had to survive contact with a build. Both source files are in
git history; neither is authoritative any more.

Schema version: **2.1.0**, frozen.

Written in Simplified Technical English (ASD-STE100).

---

## 0. HOW TO READ THIS DOCUMENT

Every section is marked with its implementation status.

| Mark | Meaning |
|---|---|
| **BUILT** | It exists, it is typed, and `npm run test-all` covers it |
| **PARTIAL** | The mechanism exists. Some cases are not wired |
| **DEFERRED** | Designed here, not built this week. Reason in §12 |

A design that does not say which of its parts are real is a wish list. This one says.

---

## 1. THE INVARIANTS

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | Perception has no write access to the truth. It emits confidence-scored proposals. Only a typed `Op` promotes a proposal into the graph | `core/session.ts` is the only writer |
| **I2** | Derived data is never truth. Mesh, occupancy grid, room areas, graphs and findings are recomputed and cached by document hash | `derive()`; nothing derived is persisted |
| **I3** | No module below the app layer opens a socket. Enforced by an import lint **and** by a runtime kill switch | `tools/lint-layers.mjs`, `core/netguard.ts` |
| **I4** | Scale is never silently assumed. `UNSCALED` is a legal, visible, degraded state | `core/scale.ts` |
| **I5** | Plan coordinates live in document units. Metres are derived through `meters_per_unit` | Grep rule, §2.1 |
| **I6** | One `meters_per_unit` for the whole document | `SiteDocument.scale` |
| **I7** | Every element carries `confidence`, `origin` and `verified` | `core/types.ts` |
| **I8** | Every `Finding` carries an anchor: a `room_id`, `wall_id`, `opening_id`, `node_id` or point | `core/site.ts` |

I1 is the one that was broken in v1 and repaired in v2: v1 declared "only the review gate
writes" and then had `reconstruct` assemble the model directly. The `Proposal` type (§2.8)
is what resolves the contradiction.

---

## 2. THE SOURCE OF TRUTH

Three files. `site.json` holds state. `ops.jsonl` holds history. `proposals.json` holds
what the machine suggested and what the human did about it.

**Ownership rule, stated once so that two people do not implement two models of undo:**
**replay is authoritative, `site.json` is a checkpoint.**

### 2.1 The unit system — read this before any other section

**Plan coordinates come from the drawing and are in document units. Height never appears
on the drawing and is in metres.**

```ts
Node    { x_u, y_u }
Wall    { thickness_u, height_m, base_offset_m }
Opening { offset_u, width_u, sill_m, head_m }
Stair   { width_u, tread_m, riser_m }
```

**Grep invariant:** an `_m` field in `site.json` is a Z-axis field or a user parameter.
Nothing else. An `_u` field is a plan-space field. There is no third case.

This is what makes re-scaling one edit instead of a rewrite, and it is what makes the
editor usable before the scale is known. Storing endpoints in metres — the v1 design —
makes `UNSCALED` unrepresentable.

Editing snap tolerance is in **units** (screen pixels ÷ view scale), never in metres.

**Status: BUILT.**

### 2.2 `SiteDocument`

```ts
interface SiteDocument {
  schema_version: "2.1.0";
  doc_id: UUID;
  created_utc: ISO; modified_utc: ISO;
  status: "DRAFT" | "REVIEWED" | "LOCKED" | "TAMPERED";

  building: { name: string;
              site_type: "METRO"|"SCHOOL"|"GOVT"|"RESIDENTIAL"|"OTHER";
              notes: string };

  georef: { mode: "NONE" | "ANCHORED";           // offline basemap underlay only
            origin_lat: number | null;           // WGS84
            origin_lon: number | null;
            heading_deg: number };               // building +Y against true north

  defaults: { wall_height_m; ext_wall_thickness_u; int_wall_thickness_u;
              door_height_m; window_sill_m; window_head_m };

  manual_parameters: {                           // requirement ¶3 supplies these by hand
    length_u; breadth_u; storey_height_m; stair_count;
    source: "USER" | "OCR" | "VECTOR" | "DEFAULT";
  };

  scale: ScaleRecord;                            // ONE record for the document — I6
  storeys: Storey[];
  stairs: Stair[];                               // a stair spans two storeys
  briefing: Briefing;
  provenance: DocProvenance;
}
```

`manual_parameters` is a visible panel in the UI, named out loud in the demo. The problem
statement explicitly supplies length, breadth, height, staircases, entry and exit; a design
in which those appear only as an internal scale ladder throws away free requirement
compliance.

**Status: BUILT.**

### 2.3 `Storey` — a self-contained planar graph

```ts
interface Storey {
  id: UUID;
  index: number;                                 // 0 ground, -1 basement, 1 first
  name: string;
  source: { kind: "RASTER"|"VECTOR"|"MANUAL"; rel_path: string; sha256: string };
  transform: { tx_u: number; ty_u: number; rot_deg: number };   // no scale term — I6
  elevation_m: number;
  floor_to_floor_m: number;

  nodes: Node[];                                 // the planar-graph primitive
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];

  status: "DRAFT" | "REVIEWED" | "LOCKED";
}

interface Node { id: UUID; x_u: number; y_u: number; }

interface Wall {
  id: UUID; a: UUID; b: UUID;                    // node IDs, never coordinates
  thickness_u: number; height_m: number; base_offset_m: number;
  height_source: "USER"|"OCR"|"VECTOR"|"DEFAULT";
  wall_class: "EXTERIOR"|"INTERIOR"|"PARTITION"|"GLAZED"|"SHAFT";
  breachable: boolean;                           // commander-facing
  breach_note: string;
  breach_origin: "HUMAN" | null;                 // always HUMAN. We infer no structure
  confidence: number;                            // 1.0 when origin is HUMAN or VECTOR
  origin: "CV" | "VECTOR" | "HUMAN";
  verified: boolean;
}
```

Walls reference node IDs. Moving a corner moves one node. Coincident floats drift;
shared nodes cannot.

`Storey.transform` carries no scale term. Without I6, a 300 dpi raster ground floor and a
millimetre DXF first floor cannot be assembled into one building.

`height_source` exists because a design that says "scale is never silently assumed" and
then ships `wall_height_m: 3.0` and `ext_wall_thickness: 0.23` as defaults has assumed two
things. Tag them, and mark them visually in the UI. Otherwise a judge points at the
contradiction and is right.

`breachable` needs its companions. An NSG officer will ask how the software knows a wall
can be breached. "A human ticked a box, and here is the reason he typed" is a good answer.
Claiming structural inference we do not have is not.

**Status: BUILT.**

### 2.4 `Opening` — anchored, never normalised

```ts
interface Opening {
  id: UUID; wall_id: UUID;
  anchor: "FROM_A" | "FROM_B";                   // which node the offset is measured from
  offset_u: number;                              // distance along the wall from the anchor
  width_u: number;
  sill_m: number; head_m: number;
  kind: "DOOR"|"DOUBLE_DOOR"|"WINDOW"|"ARCH"|"SHUTTER"|"BREACH_POINT";
  swing: "IN"|"OUT"|"BOTH"|"SLIDING"|"NONE";
  is_entry: boolean; is_exit: boolean;
  confidence: number; origin: "CV"|"VECTOR"|"HUMAN"; verified: boolean;
}
```

An opening binds to a wall by `wall_id` plus an anchored offset, **never** by an absolute
point and **never** by a normalised `t ∈ [0,1]`. An absolute point drifts away from its
wall on the first correction. A normalised `t` makes a door slide along the wall when the
wall is lengthened, which is wrong and which is hard to see until it is on stage.

**`SPLIT_WALL` longhand, defined now because undefined behaviour here puts doors in mid-air
and nobody will know why:** each opening is reassigned to whichever fragment contains its
centre, and `offset_u` is recomputed against that fragment's anchor node. An opening that
straddles the split point **blocks the split with a typed error**.

**Status: BUILT** (the schema and the panelisation). `SPLIT_WALL` itself is **DEFERRED**
with the other geometric ops.

### 2.5 `Room` — identity only

```ts
interface Room {
  id: UUID;
  seed_point_u: [number, number];
  name: string;
  use: "CORRIDOR"|"HALL"|"OFFICE"|"CLASSROOM"|"TOILET"|"PLANT"
     | "STAIRWELL"|"PLATFORM"|"UNKNOWN"|"SERVER"|"STORE";
  confidence: number; origin: "CV"|"VECTOR"|"HUMAN"; verified: boolean;
}
```

`SERVER` and `STORE` are declared extensions to the v2 list. Extensions are named, not
slipped in.

A room stores **no boundary**. Faces are recomputed on every mutation and matched to a
`Room` by point-in-face against `seed_point_u`. A face with no seed is an unnamed room. A
seed inside no face is an orphan: **warn, do not fail**. `area_m2` is derived and lives in
the cache.

Storing `boundary_nodes` violates I2 and forces every `MOVE_NODE`, `SPLIT_WALL` and
`DELETE_WALL` to maintain room cycles by hand. Removing it deletes roughly 400 lines of the
code most likely to break.

**The room-extraction robustness ladder.** This is the most fragile step in the pipeline;
the analysers, the areas, the collision and the 2D↔3D link all hang off it.

```
ε-cluster snap → close gaps below threshold → planarise at all intersections
→ extract faces → discard the unbounded face → discard faces under 1 m²
→ MANUAL "paint room" flood fill from a click
```

**The manual escape hatch is not optional.** It is what keeps the analysers demonstrable
when traversal fails. A face that will not close becomes an `OPEN_ZONE`, not a storey-wide
validation failure.

**What is built is the bottom of that ladder, deliberately: an occupancy grid and a flood
fill from each seed** (§3.1). A flood fill degrades gracefully — an unclosed loop leaks
into the neighbour and shows up as one large room, which is visible and correctable. A
polygonizer throws.

Room polygons follow wall **faces**, not centrelines. Centrelines overstate area by about
`perimeter × thickness / 2`, roughly 7 % on a 4 × 4 m room with 0.115 m walls. Either use
faces or state the assumption in the UI. Do not let a judge find it.

**Status: BUILT** (grid, flood fill, faces, orphan warning). Paint-room escape hatch:
**DEFERRED** — the grid already supports it; only the UI is missing.

### 2.6 `Stair`

```ts
interface Stair {
  id: UUID;
  kind: "STRAIGHT"|"DOGLEG"|"U_TURN"|"SPIRAL"|"ESCALATOR";
  footprint_u: Array<[number, number]>;          // in from_storey frame
  up_direction_u: [number, number];
  from_storey: UUID; to_storey: UUID;
  from_room: UUID; to_room: UUID;                // the vertical edge in the room graph
  width_u: number; tread_m: number; riser_m: number; step_count: number;
  confidence: number; origin: "CV"|"HUMAN"; verified: boolean;
}
```

Staircases are named in requirement ¶3 beside length, breadth and height, so they get a
real input path in the parameter panel and real stepped geometry — not a coloured prism.
A stepped solid from tread and riser is about thirty lines.

`from_room` and `to_room` are what make the stair an edge in the room graph, which is what
makes multi-storey routing work at all.

**Status: BUILT.**

### 2.7 `ScaleRecord` — the part that must not break

```ts
interface ScaleRecord {
  state: "UNSCALED" | "PROVISIONAL" | "VALIDATED";
  meters_per_unit: number | null;                // null if and only if UNSCALED
  method: "VECTOR_UNITS"|"CALIBRATION_SEGMENT"|"MANUAL_BBOX"|"OCR_DIMENSION"|null;
  calibration: { p0:[number,number]; p1:[number,number]; real_length_m:number } | null;
  checks: ScaleCheck[];
  evidence: Array<{ text:string; unit:string; measured_u:number; mpu:number }>;
  dispersion: number;                            // spread across OCR evidence
  confidence: number;
  set_by: "SYSTEM" | "USER"; set_at: ISO;
}
```

**Four ladders, tried in order. The winner is recorded.**

1. `VECTOR_UNITS` — DXF `$INSUNITS`. Highest trust. Still cross-checked. *DEFERRED.*
2. `CALIBRATION_SEGMENT` — the user clicks two points and types the real length. Five
   seconds. **This is the mechanism to demonstrate.** *BUILT.*
3. `OCR_DIMENSION` — read the dimension strings, pair them to measured distances, take the
   median, report the dispersion. **Offered as a suggestion the user accepts. Never
   applied automatically.** *DEFERRED.*
4. `MANUAL_BBOX` — fit the footprint to the length and breadth the operator typed. Weakest,
   because it depends on CV quality. *DEFERRED.*

**Semantic cross-checks. These catch the errors dispersion cannot.** Dispersion catches
noise. A sanity check catches a 3.281× unit error, which is the failure that actually
happens.

| Check | Band | On failure |
|---|---|---|
| Median door opening width | 0.70 – 1.30 m | WARN, naming the likely factor |
| Median wall thickness | 0.08 – 0.50 m | WARN |
| Narrowest corridor clear width | 0.90 – 4.00 m | WARN |
| Footprint against manual L × B | within ±10 % | **FAIL** |
| Smallest room area | > 1.0 m² | WARN |

`VALIDATED` requires zero FAIL and at most one WARN. Otherwise `PROVISIONAL`.

These are **configurable plausibility bounds, not universal truths.** Say that out loud
if a judge asks.

**One-click factor fixes.** When a check fails, offer the errors that cause almost all of
them: ×3.281 (metres and feet), ×1000 and ÷1000 (millimetres), ×1.414 (A3 printed at A4).
One click, one `SET_SCALE` op, no geometry touched.

**`UNSCALED` behaviour.** Render the 3D view in normalised units. Show a persistent red
banner: `UNSCALED MODEL — NOT FOR TACTICAL USE`. **Disable** every area, measurement and
route timing — disable them, do not default them. Block export. The document cannot leave
`DRAFT`, so it cannot reach Briefing Mode.

The normalised ratio comes from a plausibility heuristic: assume the median detected door
is 0.9 m wide. It is display-only. It is **never** written to `meters_per_unit`, which
stays `null`.

> Refusing to answer is the feature. A commander told a corridor is 2.0 m wide when it is
> 1.2 m is worse off than a commander told nothing.

**Status: BUILT**, except ladders 1, 3 and 4.

### 2.8 `Proposal` — the third file

`proposals.json`. Regenerated on every perception run. Never edited by the operator.

```ts
interface ProposalSet { run_id: UUID; storey_id: UUID; source_sha256: string;
                        model_version: string; created_utc: ISO; items: Proposal[]; }

interface Proposal {
  id: UUID;                 // DETERMINISTIC: hash(run_id, kind, geometry)
  kind: "WALL"|"OPENING"|"ROOM_SEED"|"STAIR"|"TEXT";
  geometry: unknown;        // document units
  score: number;            // raw detector output. NOT a probability
  state: "PENDING"|"ACCEPTED"|"REJECTED"|"EDITED";
  accepted_as: UUID | null;
}
```

The ID must be deterministic. If a re-run changes proposal IDs, every `ACCEPT_PROPOSAL` op
in the log points at nothing and replay dies.

`score` is not a probability, and the review threshold τ is not a calibrated one. Say:
"τ is tuned on our validation set to put most true errors in the queue."

**Status: DEFERRED**, with perception. I1 holds trivially today because nothing but the
operator writes at all.

### 2.9 The op log

```ts
interface Op {
  seq: number; ts: ISO; actor: "USER"|"SYSTEM";
  kind: OpKind;
  targets: UUID[];
  payload: Record<string, unknown>;
  prev_hash: string;        // hash of the document this op was applied to
  dt_ms: number;            // clamped at 30 s. Feeds the effort metric
  label: string;            // one human-readable line for the audit panel
}
```

`apply(doc, op) -> doc'` is pure. The log is append-only.

**Undo is a rolling cache of the last 50 document states, about 10 MB.** Writing correct
geometric inverses for `SPLIT_WALL` and `MERGE_NODES` under floating-point drift is a
five-day trap. Brute-force state caching is exact and takes an afternoon. There is no
`Op.inverse`.

**`prev_hash` does a different job: tamper evidence.** On load, replay the log from the
origin document. If the chain does not reproduce the current hash, open the document as
`TAMPERED`, show a red banner and disable briefing. About forty lines.

**The op set.**

| Group | Ops | Status |
|---|---|---|
| Scale | `SET_SCALE`, `CLEAR_SCALE` | BUILT |
| Semantics | `SET_WALL_PROPS`, `SET_ROOM` | BUILT |
| Briefing | `SET_ENTRY`, `SET_EXIT`, `ADD_MARKER`, `DELETE_MARKER`, `ADD_ROUTE` | BUILT |
| Review | `ACCEPT_WARNING`, `SET_STATUS` | BUILT |
| Geometry | `ADD_NODE`, `DELETE_NODE`, `MOVE_NODE`, `ADD_WALL`, `DELETE_WALL`, `SPLIT_WALL`, `MERGE_NODES`, `ADD_OPENING`, `MOVE_OPENING`, `DELETE_OPENING` | DEFERRED |
| Structure | `ADD_STOREY`, `SET_STOREY_TRANSFORM`, `SET_GEOREF`, `SET_DEFAULTS`, `ADD_STAIR`, `DELETE_STAIR` | DEFERRED |
| Perception | `ACCEPT_PROPOSAL`, `REJECT_PROPOSAL` | DEFERRED |

The briefing ops are in the **first** group that was built, on purpose. Entry points,
threat markers and routes are the most commander-relevant decisions in the tool. In a
design where they sit outside the audit trail, there is a hole straight through the
verification claim.

**Status: BUILT** for the semantic and briefing subset. The machinery — pure `apply`,
state-cache undo, chain verification, metrics — is proven and the geometric ops slot into
it unchanged.

### 2.10 `Briefing`

```ts
interface Briefing {
  entry_points: Array<{ opening_id: UUID; label: string; assigned_team: string }>;
  exit_points:  Array<{ opening_id: UUID; label: string }>;
  routes: Array<{ id: UUID; name: string; team: string; color: string;
                  from_key: string; to_key: string;
                  legs: Array<{ storey_id: UUID; points_u: Array<[number,number]> }> }>;
  markers: Array<{ id: UUID; storey_id: UUID; x_u: number; y_u: number; z_m: number;
                   kind: "THREAT"|"HOSTAGE"|"IED_SUSPECT"|"COVER"|"CAMERA"|"OBSTACLE";
                   label: string; notes: string }>;
}
```

Cut for this build: `sectors`, `occupancy_estimate`, `load_bearing`, `material`,
`classification`.

**Status: BUILT.**

---

## 3. DERIVED STATE

Nothing in this section is ever persisted. All of it is recomputed and cached by
`sha256(canonical_json(document))`. A stale nav mesh in a project file is a bug that
appears one edit after the demo.

### 3.1 The occupancy grid — one artifact, four consumers

A 5 cm grid per storey, in document units.

| Mask | Doorways | Consumers |
|---|---|---|
| `wallMask` | **not** carved | room flood fill, outside detection |
| `walkMask` | carved | first-person collision |

Never confuse the two. Room fills read `wallMask`, so a fill cannot leak outdoors through
a door. Collision reads `walkMask`, so a person can walk through one.

Four things read the result: room extraction, room area, walk collision, and the
corridor-width sanity check. Building it once is what makes all four consistent by
construction.

Collision samples the grid rather than raycasting meshes, so it cannot tunnel at speed.

**Status: BUILT.**

### 3.2 The room adjacency graph

**Rooms are nodes. Openings and stairs are edges.** Plus one `OUTSIDE` node, so that
"reach the target from the exterior" is a single graph query.

An opening's two sides are resolved by probing the grid perpendicular to the wall at the
opening centre. A window (`sill_m > 0.05`) is **not** an edge in a movement graph.

Every analyser depends on this graph, so it is defined explicitly rather than implied.

**Status: BUILT.**

---

## 4. THE VERIFICATION LOOP

### 4.1 The triage queue — **DEFERRED** (it needs proposals)

Every proposal below τ = 0.75 enters a queue, sorted by confidence ascending × geometric
impact. One item at a time, highlighted on the original sheet.

```
  [A] accept   [D] reject   [E] edit inline   [S] skip   [Shift+A] accept all above 0.6
  ─────────────────────────────────────────────────────────────────────────────────────
  Queue: 23 remaining  ·  ~2.8 min est.  ·  correction density 0.11
```

Bulk accept is not a nicety. Without it the queue is a keystroke marathon on a
400-segment plan.

Canvas colours: green verified, amber queued, red human-added, grey rejected. A commander
can see at a glance which parts a human personally signed off.

### 4.2 The status gate — **BUILT**

```ts
status_gate: {
  blocking_failures: Check[];                    // UNSCALED, no entry point → hard block
  accepted_warnings: Array<{ check: string; entity_id: UUID;
                             accepted_by: string; reason: string }>;
}
```

- `DRAFT → REVIEWED` requires **zero blocking failures** and **every warning explicitly
  accepted by a human, with a reason string**.
- `REVIEWED → LOCKED` is an explicit human act.
- **Briefing Mode requires `LOCKED`.** The gate is on the document, not on the interface.

The earlier gate — empty queue, every room a closed cycle — is unreachable on a real
scanned plan and would leave a team standing in front of judges with a stuck `DRAFT` badge.
"The operator saw six unclosed rooms and accepted them, and here are his reasons" is a
better answer for an NSG officer than a binary badge, and it is demonstrable.

### 4.3 Validation rules, in graph language — **BUILT**

"No dangling wall with a gap > 0.15 m" is meaningless in a node graph: walls share node
IDs, so a gap is not representable. The real checks are:

- no two distinct nodes closer than ε that are not merged,
- no degree-1 node that is not marked intentional,
- no zero-length wall,
- no opening whose `offset_u + width_u` exceeds its host wall length,
- no room seed outside every enclosed face.

### 4.4 Metrics, computed from `ops.jsonl` — **BUILT**

| Metric | Definition |
|---|---|
| `correction_density` | **corrective** ops ÷ (final walls + final openings) |
| `verified_fraction` | elements a human has signed off ÷ elements |
| `median_dt_s` | median seconds per op, **clamped at 30 s** |
| `ops_by_kind` | histogram |
| `time_to_verified` | seconds from load to status `REVIEWED` |

Four corrections that a technical judge will otherwise make for you:

1. **Count corrective ops only.** Exclude accepts, rejects and status changes. A metric
   dominated by acceptance count *increases* when the CV does well. The metric inverts.
2. **It is not HCI.** Call it correction density. It is not an interaction metric.
3. **`auto_recall` and `auto_precision` are not recall and precision** without ground
   truth. Call them `proposal_acceptance_rate` and `elements_requiring_review` until there
   is a labelled set.
4. **`dt_ms` includes the operator's coffee break.** Report the median, clamped.

Never state a number without N, the dataset and the hardware.

---

## 5. THE ANALYSIS LAYER

Every analyser is a pure function of the document. Every finding carries an anchor, so the
2D canvas, the 3D view and the findings list highlight the same entity at the same moment.

| Analyser | Algorithm | What it tells a commander | Status |
|---|---|---|---|
| **Critical doors** | **Bridges** of the room graph | "This door is the only link to six rooms" | BUILT |
| **Critical rooms** | **Articulation points** | "A force that holds this corridor cuts the building in two" | BUILT |
| **Key rooms** | Betweenness centrality | "This corridor carries 41 % of all shortest paths" | BUILT |
| **Route** | Shortest path over the room graph | "Entry to R14: 3 doors, 1 stair" | BUILT |
| **Isolation** | Components after removing one edge | "Sealing this door isolates six spaces" | BUILT |
| **Dead ends** | Degree-1 room nodes | "This room has one way in" | BUILT |
| `ClearOrder` | Traversal weighted by centrality | Suggested clearing sequence | DEFERRED |
| `Egress` | Distance to the nearest access point | "Nine rooms exceed 45 m to an exit" | DEFERRED |
| `Sightline` | 2D visibility polygon | Visible area and blind corners | DEFERRED |

**The correction that matters, because a CS judge will catch it.** A door is an **edge**.
"This door is the only link to six rooms" is a **bridge**, not an articulation point.
Articulation points answer a different question: which *rooms* disconnect the graph when
removed — the corridor, the stairwell. Ship both. Label them differently. Never say "cut
vertex" while pointing at a door.

The rhetoric for the deferred ones costs nothing: *"the analyser layer is a pure function
of the graph. Here are six. The others are the same forty lines each."*

---

## 6. GEOMETRY GENERATION

### 6.1 It runs in TypeScript, in the browser — **BUILT**

Not in Python, and not on a server. Three reasons:

1. A claim that the UI "renders a static `site.json` with no backend alive" is false if
   extrusion runs in Python. With the backend dead you have a JSON file and no mesh.
   Moving geometry to the browser makes the last fallback layer real.
2. It removes a serialisation round trip. Regeneration drops from ~200 ms to ~30 ms.
3. It leaves any future Python responsible only for CV, which is the part most likely
   to die.

GLB export is `GLTFExporter`, about twenty lines.

### 6.2 Panelisation and junctions — **BUILT**

A wall becomes a list of rectangular panels in wall-local coordinates: solid spans between
openings, a panel below each sill, a panel above each head. So a window keeps its lintel
and its parapet, and a door is a real hole.

**Junctions are solved by extending each wall by half its own thickness at any node where
two or more walls meet.** Overlap inside a junction is invisible and free. This handles a
0.23 m exterior wall meeting a 0.115 m partition at a T.

The upgrade path, when curved or oblique walls arrive: buffer each centreline by
`thickness/2` with flat caps and mitre joins, union the result, extrude the polygon, and
subtract opening boxes. Junctions then solve themselves for every angle. It is about sixty
lines with a polygon library, and it is the difference between a demo that looks like a
building and one that looks like a broken toy.

### 6.3 The centreline problem — **DEFERRED, and it is not small**

CV detects wall **faces** — two parallel lines. The graph needs **centrelines**. Collapsing
double-line detections into one centreline with the correct thickness, and making junctions
meet at a single node, is more work than the detection itself. Budget for it. It was not in
any earlier version of this document, and that omission is the most likely source of a
schedule surprise.

---

## 7. OFFLINE — ENFORCED TWICE

### 7.1 Install-time asset layer — **DEFERRED**

The only layer that touches the network. It fetches map tiles, satellite rasters, model
weights and OCR dictionaries, then writes `assets.manifest.json` (path, sha256, bytes,
source URL, timestamp) and an `INSTALL_COMPLETE` sentinel.

Today the area pack is bundled at build time and is hand-authored in the OpenStreetMap
schema. **The UI says so.** Swapping in real PMTiles is a data change, not a code change.

### 7.2 Runtime kill switch — **BUILT**

A guard installed before any application code runs. It wraps `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource` and `sendBeacon`, classifies the target, refuses anything that
is not loopback, counts it, and shows it in the UI.

**Loopback must be permitted.** Blocking every socket kills the app's own dev server and
HMR channel, and the app will not start. Permit `127.0.0.1` explicitly and label those
attempts as loopback in the log.

**Demonstrate the guard.** A guard a judge can watch fire is worth far more than a claim.

### 7.3 Structural prevention — **BUILT**

An import lint forbids network APIs below the app layer and forbids upward imports across
the layer boundaries. The kill switch catches mistakes; the lint prevents them.

```
core       0   schema, grid, scale, ops, session, netguard
geometry   1   panelisation, mesh generation
analysis   2   room graph and analysers
geo        2   offline area pack
view2d/3d  3   canvas plan, viewer, overlays
ui         4   panels, wiring, briefing, export
```

An upward import is a build error. If you think you need one, the code is in the wrong
module. Move the code; do not relax the rule. (This lint caught `core` importing
`geometry` on the day it was written. The grid moved into `core`.)

### 7.4 The legal point, which belongs on a slide

Google Maps Platform prohibits pre-fetching, caching, storing and offline use of its
content, and its Map Tiles API policy names offline use as a non-permitted case.
Requirement ¶6(d), read literally, cannot be delivered.

State it in this order:

1. ¶4 permits map and imagery sources **"from open source"** at install time.
2. Google Maps Platform prohibits the offline use ¶6(d) implies.
3. Therefore the area pack uses OpenStreetMap (ODbL, with attribution) and Sentinel-2
   (Copernicus, open). NRSC/Bhuvan is available **subject to its own terms, verified per
   deployment** — its licence may not permit redistribution inside a packaged area file.

Point 1 first. It turns "we could not do what you asked" into "we did what ¶4 told us to
do, and here is why ¶6(d) cannot be read literally." Put the actual policy URL on the
slide, not a paraphrase. Verify the current terms before presenting.

### 7.5 Neighbourhood context — **BUILT**

¶6(d) asks for enhanced output "covering the nearby geographical areas as well." That is
not "place the footprint on a tile"; it is surroundings. Neighbouring building footprints
are extruded at `building:levels × 3.1 m` (defaulting to three storeys where the tag is
absent) and roads are drawn as flat ribbons. The target then sits inside its real urban
block, with approach roads and adjacent rooftops.

The level-to-height assumption is an assumption. It is labelled as one.

---

## 8. THE 2D ↔ 3D LINK

Click a room in the 3D view: it highlights on the plan. Click a room on the plan: the
camera flies to it. Both views read the same `room_id`.

This costs almost nothing and it is the clearest possible demonstration that the system
holds **one** representation, not two loosely coupled products. Rehearse this moment.

**Status: BUILT.**

---

## 9. BRIEFING MODE

Five keyboard-driven steps over data the document already holds. It replaces PDF export,
which is more work and worse on stage.

```
[1] Exterior      target in its surroundings, approach directions
[2] Entry points  each marked, each with an assigned team
[3] Route         camera flies the assigned route to the target room
[4] Target room   adjacent rooms, second exit, whether there is only one way in
[5] Overview      doll-house, both storeys, chokepoints highlighted
```

Gated on `LOCKED`.

**Status: BUILT.**

---

## 10. DEMO SURVIVAL

Three independent layers, each covering a different failure.

| Layer | Covers | Mechanism | Status |
|---|---|---|---|
| Golden bundle | Total CV and OCR failure | A frozen, committed `site.json`. One button, no ingest | BUILT — it is the default path today |
| `DEMO_SAFE=1` | Model crash mid-run | Cached proposal fixtures for the known sheets, honestly labelled | DEFERRED — no backend exists to fail |
| Frontend fallback | Total backend death | The UI renders `site.json` with no server process alive | BUILT — it is the only path |

The third layer is the one most teams miss, because a backend segfault on stage kills the
other two. Here it is not a fallback; it is the architecture.

`--demo-safe` is dependency isolation, not deception. It replays real outputs previously
produced by the real pipeline. Say so if a judge asks. Never mock the feature the judges
came to see.

Also: two laptops, the demo one frozen at T−12 h and never used for development; two
screen recordings on a USB stick; and stage re-entry, so any stage can be skipped by
supplying the previous stage's artifact by hand.

The deep reason all of this works: **the truth is a 200 KB text file.** In the worst case
one person opens it in an editor and fixes it by hand while another talks over the slides.

### 10.1 Two operational risks that are not yet closed

- **Persistence.** The runtime is a static bundle. The document is bundled and the op log
  is exported by hand. There is no save path, so there is no atomic-write story yet. When
  one is added: write to a temp file and `os.replace` it. A power blip mid-save otherwise
  leaves a truncated truth file. Two lines.
- **Packaging.** Shipping as a desktop binary is not done. It is far less risky than it
  was when the plan involved PyInstaller and OpenCV — a static bundle in a shell is a small
  job — but it is a job, and "the demo laptop cannot launch the app" ends everything else
  in this document. Do it on a machine that has never had the toolchain installed.

---

## 11. THE HONEST SCOPE STATEMENT

The problem statement mentions buildings, built-up areas, metro stations and schools. This
system handles **one building, up to two storeys, with manual storey alignment.** Say that
plainly on the feasibility slide, next to what makes it extend: a campus is a set of
buildings sharing one georeferenced frame, and the data model already supports that.

A stated, scoped limitation reads as engineering judgement. A limitation a judge discovers
reads as a gap.

Three more to say before a judge finds them:

- The blueprint in the demo is a **hand-authored fixture**, not a parsed scan.
- The neighbourhood pack is **hand-authored in the OSM schema**, not real OSM data.
- The document hash is FNV-1a. It is a cache and tamper key, **not a signature**.

---

## 12. WHAT IS NOT BUILT, AND WHY

| Not built | Why |
|---|---|
| Perception, and a model trained from scratch | Labelling eats three of five days and yields a brittle result. This architecture makes model quality **replaceable rather than load-bearing**, which is the whole point of building the viewer against a fixture first |
| Automatic multi-storey registration | Research grade. Fails silently. Two anchor clicks replace it |
| Curved, arc and spline walls | Polylines only. Under 5 % of target buildings, ~1.5 person-days of geometry |
| Furniture, symbols beyond door/window/stair | Zero tactical value |
| PBR materials, texturing, baked lighting | Flat shading with ambient occlusion looks more professional for a tactical tool than poor PBR |
| Photogrammetry from satellite imagery | The problem statement says *integrate* imagery. Lay a georeferenced raster and stop |
| IFC and BIM export | Nobody in the judging room opens an IFC file. GLB is enough |
| PDF export | Replaced by Briefing Mode: cheaper and better on stage |
| Encrypted `.sitepkg` (AES-GCM) | About thirty lines, and a good eight seconds on stage. Cut only for time — **put this back first** |
| Accounts, RBAC, collaboration | Offline single-operator tool |
| Unity or Unreal | Long install, export risk, crash risk on a judge's laptop |
| A general vector-PDF parser | Handle DXF and SVG properly. Treat PDF as raster |
| Roof topology | Flat ceilings at wall height. Assault teams breach walls and doors, not roof pitch |

Governing rule: if a feature does not raise verified-model fidelity, lower correction
density, or appear in the five-minute demo, it does not exist this week.

Anything arriving after the freeze — a better idea, a sharper critique, a fifth
architecture — goes in `POST_SIH.md` and is not read until next week.

---

## 13. THE TWO WAYS THIS DESIGN DIES

**1. Somebody spends a day training a segmentation network.** Do not allow it. The
architecture makes the model replaceable precisely so that nobody needs to gamble on it.

**2. The schema is not frozen on day one.** Every other person codes against `site.json`
fixtures. An unfrozen schema blocks five people at once. It is frozen at `2.1.0`. A schema
change updates the types, the migration and the fixtures **in the same commit**. A fixture
correction is always its own commit, and the message says why it was wrong.

---

## 14. THE SENTENCES TO DEFEND

> The CV model is not the product. The verified floor graph is the product. We built a
> blueprint verification workstation with a 3D renderer attached — not a converter with a
> human bolted on for error cases. Every element carries who created it and whether a human
> has verified it. A model that has not been verified cannot reach a commander, because
> briefing mode is gated on the document status, not on the interface.

> Minimum supervision is not zero supervision. It is *measured* supervision. The system
> reports exactly how much human effort a given blueprint costs, and every engineering
> decision drives that number down. A system that claims zero supervision is a system that
> has not measured its own error rate.

The second sentence is the answer to "you built a manual CAD editor and called it AI."
Without it, that one question can lose the round.
