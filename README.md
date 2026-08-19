# NotMayasabha

**Live demo: [notmayasabha.vercel.app](https://notmayasabha.vercel.app)**

A 2D building blueprint becomes an offline, correctable, tactical 3D walkthrough —
entirely in the browser, with no server and no internet connection required.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run test-all   # types, layer lint, fixture, headless pipeline, production build
```

Built for the problem "Conversion of 2D Blueprints into 3D Model" (SIH1773): take a 2D
floor plan plus a few manual parameters (length, breadth, height, staircase, entry/exit),
and produce a full 3D walkthrough of the building that runs standalone on an air-gapped
machine.

---

## Why this is more than "2D → 3D"

Extruding walls from a floor plan is a rendering problem with a fixed answer. Everything
after extrusion in this project is a **derivation** problem — a checkable mathematical
result, not a rendered guess.

**One occupancy grid, four consumers.** `src/core/grid.ts` flood-fills a `Uint8Array`
from each room's seed point. Room extraction, room area, walkthrough collision and the
corridor-width sanity check all read that same grid. Nothing is polygonized, so an
unclosed wall loop degrades to one visibly-too-large room instead of throwing — a
detectable failure mode instead of a silent one.

**The room graph is the real artifact.** `src/analysis/graph.ts` turns the floor plan
into a graph: rooms are nodes, doors and stairs are edges. Three classical graph
algorithms run on it, each O(V+E):

- **Bridges** (`bridges()`, iterative Tarjan low-link DFS) — a door is an *edge*, so
  "which doors are critical" is a **bridge** question. Remove a bridge door and the
  building splits into two disconnected pieces.
- **Articulation points** (`articulationPoints()`, same DFS) — a room is a *node*, so
  "which rooms are critical" is the cut-vertex question. Bridges and articulation points
  answer different questions and are drawn with different colours on purpose.
- **Betweenness centrality** (`betweenness()`) — which rooms sit on the most shortest
  paths between other rooms. The corridor lights up because the graph says so.

**Scale is falsifiable, not assumed.** `src/core/scale.ts` runs five independent,
deterministic sanity checks — door width, wall thickness, corridor width, bounding box
against a manually-entered dimension, and smallest room area — against configurable
plausibility bounds. `VALIDATED` requires zero `FAIL` and at most one `WARN`. If the
scale is unknown, the state is `UNSCALED`: a legal, visible, red-banner state where areas
are **refused, not defaulted**, and export and briefing are blocked. A confidently wrong
building is the worst output this system can produce, so the system is built to say
"I don't know" instead.

None of this needs a neural network. It needs the floor plan to become a graph instead
of a picture — and once it's a graph, graph theory is free.

---

## Tactical markers

Every colour in the 3D view is a computed property of the room graph, drawn in
`src/view3d/overlays.ts`.

| Marker | Colour / shape | Meaning |
|---|---|---|
| **Bridge door** | Red door slab | A graph bridge — remove it and the building splits in two. A single point of failure |
| Ordinary door | Grey door slab | Redundant — there is another way around |
| Entry pylon | Green cone, floating | An `is_entry` opening |
| Exit pylon | Yellow cone, floating | An `is_exit` opening |
| Route | Cyan tube, with a ring at every doorway it crosses | The currently computed shortest path over the door graph |
| **Critical room** | Orange-tinted floor | An articulation point — losing this room disconnects the graph, independent of any single door |
| Target beacon | Red/pink translucent cylinder | The room selected as the objective for the current route |
| Briefing marker | Pink octahedron on a stem | A human-placed threat / hostage / IED / cover marker |
| Selection outline | Cyan-green box | Whatever room or door is currently selected in either view |
| Wall tint | Faint wash of the room's floor colour | Lets a first-person walker tell which room they're in — see `storeyInteriorWallGeometry` in `src/geometry/build3d.ts` |

---

## How it works

```
2D Blueprint Image / Vector
         │
         ▼
[1. Perception / CV] ──> Emits Proposals (Walls, Openings, Rooms)
         │
         ▼
[2. Human Review Gate] ──> Human Accepts/Edits (typed Ops appended to ops.jsonl)
         │
         ▼
[3. Core Site Document] ──> Planar Graph (Nodes + Walls) with scale record
         │
         ├───> [4. TS Geometry Engine] ──> Extrudes 3D Panels (Three.js WebGL)
         │
         └───> [5. Analysis Engine]    ──> 5cm Occupancy Grid ──> Room Adjacency Graph ──> Tactical Intelligence
```

- **Planar node graph, not pixels.** Blueprints become a graph of `Nodes + Walls`. Walls
  reference explicit node IDs rather than coordinate pairs, so connected walls share
  corners without drifting. Moving a corner edits one node and updates every wall on it.
- **Panelisation geometry.** The browser geometry engine converts wall centrelines into
  rectangular panels — solid spans, parapets under window sills, lintels above doors. At
  junctions walls extend by half their thickness so overlaps seal cleanly. WebGL extrudes
  the panels along Z from `wall_height_m`, producing the mesh in under ~30 ms.
- **Dual occupancy masks.** `wallMask` leaves doorways uncarved so room flood-fills can't
  leak outdoors; `walkMask` carves doorways out so the walkthrough camera and pathfinding
  can pass through them.
- **Dual-view binding.** 2D and 3D share the same `room_id`. Clicking a room in 2D flies
  the 3D camera to it; selecting a space in 3D highlights its 2D boundary.
- **Deterministic core.** Extrusion, graph analysis, collision and routing are 100%
  deterministic — no model output ever reaches the geometry or the route. If a perception
  backend exists and dies, the building still renders.

---

## Tech stack

| Component | Technology | Purpose |
|---|---|---|
| Language & runtime | TypeScript (ES2022) | End-to-end type safety, running entirely client-side |
| 3D rendering | Three.js / WebGL | Extrudes 2D vectors into 3D meshes; lighting, camera flights, GLB export |
| 2D plan canvas | HTML5 Canvas | Blueprint overlays, node editing, calibration vectors, tactical markers |
| Security & isolation | Network kill switch (`netguard.ts`) + layer linter | Blocks all non-loopback outbound traffic; forbids network imports in core modules |
| Spatial graph & math | Custom TS algorithms | Tarjan bridges, shortest path, betweenness centrality, 5 cm occupancy grid |
| Geospatial | Offline map pack (OSM schema) | Extrudes neighbouring buildings and roads fully offline |

---

## Layout

```
fixtures/site.json            the frozen contract everything is built against
fixtures/neighbourhood.json   offline area pack (OSM schema)
src/core/                     schema, occupancy grid, scale engine, ops, session, netguard
src/geometry/                 wall panelisation, three.js mesh generation
src/analysis/                 room graph and the analysers
src/geo/                      neighbourhood extrusion
src/view2d/  src/view3d/      canvas plan, viewer, overlays
src/ui/                       panels, wiring, briefing, export
tools/                        fixture check, layer lint, headless smoke test
```

`CLAUDE.md` is the document of record and settles conflicts between the design documents
in `docs/`.

---

## Notes

- The blueprint is a hand-authored fixture, not a parsed scan. Perception is a deliberately
  deferred module so the core does not depend on the riskiest part of the pipeline.
- The neighbourhood pack is hand-authored in the OpenStreetMap schema, not live OSM data.
  Swapping in real PMTiles is a data change, not a code change.
- The content hash is FNV-1a — a cache and tamper-evidence key, not a cryptographic
  signature.
