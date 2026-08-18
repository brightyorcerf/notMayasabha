# v2.1 — FREEZE PATCH

**This is the last architecture document. Nothing after this is designed. It is built.**

Apply items 1–13 to `ARCHITECTURE-v2.md`, hand-author the two-storey `site.json`, commit,
freeze `schema_version: "2.1.0"`. Budget: **90 minutes.** Then stop.

Items 14–23 are execution rules, not schema. They do not block the freeze.
Items in the DEFERRED list are not built this week.

Written in Simplified Technical English.

---

## PART A — SCHEMA CHANGES (must be done before the freeze)

Each of these causes a migration on day three if you skip it.

### 1. Fix the unit system

**Rule: XY comes from the drawing and is in document units. Z never appears on the
drawing and is in metres.**

```ts
Node    { x_u, y_u }                              // unchanged
Wall    { thickness_u, height_m, base_offset_m }  // was thickness_m
Opening { width_u, offset_u, sill_m, head_m }     // was width_m
Stair   { width_u, tread_m, riser_m }             // tread/riser are Z-domain
```

Grep invariant: **an `_m` field in `site.json` must be a Z-axis or user-parameter field.**
Nothing else.

`UNSCALED` rendering uses a `display_mpu`, derived from a plausibility heuristic
(assume the median detected door is 0.9 m). It is flagged display-only. It is **never**
written to `ScaleRecord.meters_per_unit`, which stays `null`.

### 2. Re-parameterise openings

```ts
interface Opening {
  wall_id: UUID;
  anchor: "FROM_A" | "FROM_B";
  offset_u: number;        // distance along the wall from the anchor node
  width_u: number;
  // ...
}
```

Normalised `t ∈ [0,1]` makes a door slide when a wall is lengthened. That is wrong.

**Define `SPLIT_WALL` longhand now:** each opening is reassigned to whichever fragment
contains its centre, with `offset_u` recomputed against the new anchor node. An opening
that straddles the split point **blocks the split with an error**. Undefined behaviour here
puts doors in mid-air on stage and you will not know why.

### 3. Reduce `Room` to identity only

```ts
interface Room { id: UUID; seed_point_u: [number, number]; name: string; use: RoomUse; }
```

Faces are recomputed from wall centrelines on every mutation (`shapely.ops.polygonize`).
Each face matches a `Room` by point-in-polygon against `seed_point_u`. A face with no seed
is an unnamed room. A seed inside no face is an orphan — warn, do not fail.
`area_m2` moves to the derived cache.

Storing `boundary_nodes` violated invariant I2 and would have forced every `MOVE_NODE`,
`SPLIT_WALL` and `DELETE_WALL` to maintain room cycles by hand. This deletes roughly 400
lines of the code most likely to break.

### 4. Add the `Proposal` type — a third file

`proposals.json`, regenerated per perception run, never edited by ops.

```ts
interface ProposalSet { run_id: UUID; storey_id: UUID; source_sha256: string;
                        model_version: string; created_utc: ISO; items: Proposal[]; }

interface Proposal {
  id: UUID;                 // DETERMINISTIC: hash(run_id, kind, geometry)
  kind: "WALL" | "OPENING" | "ROOM_SEED" | "STAIR" | "TEXT";
  geometry: unknown;        // document units
  score: number;            // raw detector output. NOT a probability
  state: "PENDING" | "ACCEPTED" | "REJECTED" | "EDITED";
  accepted_as: UUID | null;
}
```

The ID must be deterministic. If a re-run changes proposal IDs, every `ACCEPT_PROPOSAL` op
in the log points at nothing and replay dies.

Invariant C3 was the headline fix in v2 and the artifact it depends on was never defined.

### 5. One `meters_per_unit` per document

Add **I6**: all storeys share one `meters_per_unit`. A storey whose ladder disagrees by
more than 2 % raises a FAIL.

`Storey.transform` therefore needs no scale term. Without this rule a 300 dpi raster
ground floor and a millimetre DXF first floor cannot be assembled, and the two-storey
demo file you are about to hand-author is wrong from the start.

### 6. Make the status gate reachable

```ts
status_gate: {
  blocking_failures: Check[];        // UNSCALED, no entry point → hard block
  accepted_warnings: Array<{ check: string; entity_id: UUID;
                             accepted_by: string; reason: string }>;
}
```

`REVIEWED` requires zero blocking failures and every warning explicitly accepted by a
human with a reason string.

The v2 gate — empty queue, every room a closed cycle — is unreachable on a real scanned
plan. It would have left you standing in front of judges with a stuck `DRAFT` badge.
"The operator saw six unclosed rooms and accepted them, here are the reasons" is a
*better* answer for an NSG officer than a binary badge, and it is demonstrable.

Also add **bulk accept**: `Shift+A` accepts everything above 0.6. Without it the queue is
a keystroke marathon on a 400-segment plan.

### 7. Mark the source of every dimension

```ts
height_source: "USER" | "OCR" | "VECTOR" | "DEFAULT"
```

v2 says scale is never silently assumed, and then ships `wall_height_m: 3.0` and
`ext_wall_thickness_m: 0.23` as defaults. Those are assumptions. Tag them and mark them
visually in the UI. Otherwise a judge points at the contradiction and is right.

### 8. Rewrite the validation rules in graph language

"No dangling wall with a gap > 0.15 m" is meaningless in a node graph — walls share node
IDs, so a gap is not representable. What you mean:

- no two distinct nodes closer than ε that are not merged,
- no degree-1 node that is not marked intentional,
- no zero-length wall,
- no opening whose `offset_u + width_u` exceeds its wall length.

Editing snap tolerance is in **units** (screen pixels ÷ view scale), never metres.

### 9. Add the missing ops

`ADD_NODE`, `DELETE_NODE`, `ADD_STOREY`, `SET_GEOREF`, `SET_DEFAULTS`, `DELETE_STAIR`,
and — most seriously — the briefing ops: `SET_ENTRY`, `ADD_MARKER`, `MOVE_MARKER`,
`DELETE_MARKER`, `ADD_ROUTE`, `EDIT_ROUTE`.

Entry points, threat markers and routes are the most commander-relevant decisions in the
tool. In v2 they sat entirely outside the audit trail — a hole straight through the
verification claim.

### 10. Drop `Op.inverse`. Add `Op.prev_hash`.

Undo is a **rolling cache of the last 50 `site.json` states in memory** (about 10 MB).
Writing correct geometric inverses for `SPLIT_WALL` and `MERGE_NODES` under floating-point
drift is a five-day trap. Brute-force state caching is exact and takes an afternoon.

`prev_hash` does a different job: tamper evidence. At lock time record
`ops_sha256` = hash of the log. On load, if `site.json` does not replay to that hash, open
the document as `TAMPERED` with a red banner and briefing disabled. About 40 lines.

Declare the ownership rule in one line: **replay is authoritative, `site.json` is a
checkpoint.** Otherwise two people implement two models of undo and they disagree on day four.

### 11. `breachable` needs a companion

```ts
breachable: boolean;
breach_note: string;
breach_origin: "HUMAN";     // always. We infer nothing structural
```

An NSG officer will ask how the software knows a wall is breachable. "A human ticked a
box" is a fine answer. Claiming structural inference you do not have is not.

### 12. Put encryption back

The problem statement's first sentence is about secret buildings in counter-terror
operations. Passphrase-derived AES-GCM on the `.sitepkg` is about 30 lines. Demo the
password prompt — eight seconds on stage, and it signals you know who the customer is.

### 13. Add the manual-parameter panel to the schema and the UI

The problem statement explicitly supplies length, breadth, height, stairs, entry and exit.
In v2 they appear only as scale ladder #4 and some defaults. Build a visible panel, name it
"manual parameters" out loud in the demo. Free requirement compliance.

---

## PART B — EXECUTION RULES (do not block the freeze)

### 14. Build the geometry generator in TypeScript, in the frontend

The v2 claim that the UI "renders static `site.json` with no Python alive" is false if
extrusion runs in Python with trimesh. With the backend dead you have a JSON file and no
mesh.

Moving geometry to the browser: makes fallback layer 3 real; removes a serialisation
round-trip so regeneration drops from ~200 ms to ~30 ms; and leaves Python responsible only
for CV, which is the part most likely to die. Export GLB with three.js `GLTFExporter`
(about 20 lines).

### 15. Solve wall junctions with Shapely, not corner maths

Buffer every wall centreline by `thickness/2` with `cap_style=flat, join_style=mitre`,
`unary_union` the result, then extrude the polygon. Junctions solve themselves, including
0.23 m exterior meeting 0.115 m interior at a T. Openings become boolean subtractions of
boxes.

About 60 lines, and it is the difference between a demo that looks like a building and one
that looks like a broken toy. Hand-rolled corner geometry is the single most time-consuming
task in this build and it was not in v2 at all.

### 16. Name an owner for room extraction today

It is the most fragile step in the pipeline, and all analysers, `area_m2`, the nav mesh and
the 2D↔3D room link hang off it. The robustness ladder:

```
ε-cluster snap → close gaps below threshold → planarise by splitting at all intersections
→ polygonize → discard the unbounded face → discard faces under 1 m²
→ MANUAL "paint room" flood-fill from a click
```

**The flood-fill escape hatch is not optional.** It is what makes the analysers demonstrable
when traversal fails. A face that will not close becomes an `OPEN_ZONE`, not a storey-wide
validation failure.

Decide now: room polygons use wall **faces**, not centrelines. Centrelines overstate area by
about `perimeter × thickness / 2` — roughly 7 % on a 4 × 4 m room with 0.115 m walls. Either
use faces or state the assumption in the UI. Do not let a judge find it.

### 17. Name the centreline problem

CV detects wall *faces* — two parallel lines. The graph needs centrelines. Collapsing
double-line detections into one centreline with the correct thickness, and making junctions
meet at a single node, is more work than the detection itself. It was not mentioned in v2.
Budget for it.

### 18. Fix the chokepoint algorithm

A door is an **edge**. "This door is the only link to six rooms" is a **bridge**, not an
articulation point. Articulation points give you *rooms* whose removal disconnects the graph
— a corridor. Ship both, labelled correctly. A CS judge will catch the mismatch.

Also define the room adjacency graph explicitly — rooms are nodes, openings are edges.
Every analyser depends on it and v2 never states it.

### 19. Cut to three analysers

Keep **Bridge** (critical doors), **Articulation** (critical rooms), **Route** (A*).
Cut Sightline, ClearOrder, DeadEnd, Egress, Isolation. Each needs UI, highlighting and an
explanation. Sightline in particular is fiddly geometry that eats a day.

The rhetoric costs nothing: *"the analyser layer is a pure function of the graph. Here are
three. The other five are the same forty lines each."*

### 20. Fix the metrics before you present them

- `auto_recall` and `auto_precision` are **not** recall and precision without ground truth.
  Rename to `proposal_acceptance_rate` and `elements_requiring_review` until you have a
  labelled set. An ML-literate judge will attack this immediately.
- Rename HCI to **correction density**. It is not an interaction metric.
- Count **corrective ops only** — exclude plain accepts and rejects. As written, HCI is
  dominated by acceptance count and *increases* when CV does well. The metric inverts.
- `dt_ms` includes the operator's coffee break. Report the median and clamp at 30 s per op.
- τ = 0.75 is a knob, not a calibrated probability. Say: *"τ is tuned on our 12-sheet
  validation set to put most true errors in the queue."*
- Call the scale bands **configurable plausibility bounds**, not universal truths.

### 21. Three things that break the app or the demo

- **The kill-switch must permit loopback.** Blocking all sockets kills your own UI-to-Python
  IPC and the app will not start. Permit `127.0.0.1` explicitly.
- **Atomic writes.** Write `site.json` to a temp file and `os.replace` it. A power blip
  mid-save leaves a truncated truth file and ends your day. Two lines.
- **Packaging starts today, not day four.** Produce a hello-world binary and run it on a
  laptop that has never had Python installed. PyInstaller with OpenCV is a known swamp:
  400 MB binaries, missing dylibs, Windows Defender quarantine. If the demo laptop cannot
  launch the app, nothing else in this document exists.

### 22. Two pitch corrections

- Remove **"physically"** from the defended sentence. §7 of v2 says a person can open the
  JSON and fix it by hand. Both claims cannot be true. Say "cannot reach a commander through
  the tool," then over-deliver with the `TAMPERED` check from item 10.
- **Soften Bhuvan.** OSM (ODbL, with attribution) and Sentinel-2 (Copernicus, open) are
  solid. NRSC/Bhuvan has its own terms that may not permit redistribution inside a packaged
  area file. Say "subject to NRSC terms, verified per deployment." The Google Maps point is
  strong — do not let a weaker adjacent claim contaminate it. Put the actual policy URL on
  the slide, not a paraphrase.

### 23. Write the "minimum supervision" paragraph before any code

> Minimum supervision is not zero supervision. It is *measured* supervision. Our system
> reports exactly how much human effort a given blueprint costs, and every engineering
> decision drives that number down. A system that claims zero supervision is a system that
> has not measured its own error rate.

This is the answer to the judge who says "you built a manual CAD editor and called it AI."
Without it, that one sentence can lose the round.

---

## DEFERRED — not built this week, slide only

OCR scale ladder · manual-bbox ladder · five of the eight analysers · stair geometry beyond
a coloured prism · PDF export (use GLB plus screenshots) · georeferencing beyond a static
raster underlay · a live metrics dashboard (compute from `ops.jsonl` offline and put the
numbers on a slide — same credibility, a tenth of the work) · automatic multi-storey
registration · IFC · sectors, occupancy, load-bearing, material.

---

## THE HARD STOP

Four architectures were merged. Four critiques were folded in. That is one merge more than
a five-day build can afford.

The next artifact this team produces is **a committed `site.json` and a running binary.**
Not a document.

```
T + 0:00   Apply items 1–13. One person. 90 minutes. No discussion.
T + 1:30   Hand-author the two-storey site.json. Commit. Tag 2.1.0. Announce the freeze.
T + 1:30   In parallel: hello-world PyInstaller binary on a clean laptop.
T + 2:00   Person 3 starts the 2D editor against the committed file.
           Person 4 starts the TypeScript geometry generator against the committed file.
           Person 6 names the room-extraction owner.
T + 2:00   Somebody writes the "minimum supervision" paragraph.
```

Anything that arrives after the freeze — a better idea, a sharper critique, a fifth
architecture — goes in a file called `POST_SIH.md` and is not read until next week.
