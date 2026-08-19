# Mayasabhas

**A 2D building blueprint becomes an offline, correctable, tactical 3D walkthrough.
A commander can brief an assault team in minutes, on an air-gapped laptop.**

SIH1773 — Conversion of 2D Blueprints into 3D Model. National Security Guard, MHA.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run test-all   # types, layer lint, fixture, headless pipeline, production build
```

No API keys. No server. No network call at run time — the app refuses them and counts them.

---

## What runs today

| | |
|---|---|
| **Frozen document** | Two storeys, 41 walls, 29 openings, 13 rooms, 1 stair, hand-authored, schema `2.1.0` |
| **Geometry** | Wall panelisation with real openings, junctions solved by half-thickness extension, stepped stair solid — all in TypeScript, in the browser |
| **Rooms** | Flood fill from seed points over an occupancy grid. Areas measured from wall faces, not centrelines |
| **Walkthrough** | First person, 1.6 m eye height, grid collision, walks up the stair between storeys |
| **Analysers** | Bridges (critical doors), articulation points (critical rooms), betweenness, shortest route, isolation, dead ends |
| **Scale engine** | `UNSCALED / PROVISIONAL / VALIDATED`, five semantic sanity checks, two-click calibration, one-click factor fixes |
| **Review** | Findings with anchors, warnings accepted with a written reason, `DRAFT → REVIEWED → LOCKED` |
| **Audit** | Every operator action is an op with a `prev_hash`. Undo by state cache. Tamper check by replay |
| **Briefing Mode** | Five keyboard-driven steps. Gated on `LOCKED` |
| **Geo context** | Neighbouring blocks extruded and roads drawn from an offline area pack |
| **Offline proof** | Runtime kill switch plus a build-time import lint |
| **Export** | GLB, and the op log as `.jsonl` |

Not built, and why: `docs/POST_SIH.md`.

---

## The five-minute demo

Rehearse it five times. Time it. The demo decides the result more than the code does.

| Time | Do this | Say this |
|---|---|---|
| 0:00 | Title slide only | "A commander gets a paper floor plan. He has twenty minutes to brief an assault team. We give him a 3D walkthrough in under a minute, on a laptop with no internet." |
| 0:30 | **Turn the network adapter off, on screen.** Point at the SEALED badge | "This machine is now offline. The badge is not decoration — the app counts every outbound attempt and refuses it. It reads zero." |
| 0:45 | Doll-house view. Click a room in 3D → it highlights in the 2D plan | "One model, two views. Same room ID. There is no second representation to drift." |
| 1:15 | **Click Clear scale** | "Watch what happens when the system does not know the scale." Red banner. Areas read UNAVAILABLE. Export greys out. "It refuses to answer. A commander told a corridor is 2.0 m wide when it is 1.2 m is worse off than a commander told nothing." |
| 1:45 | **Calibrate: two clicks on the plan, type 20** | "Two clicks. That is what minimum supervision looks like. Five sanity checks now pass — door width, wall thickness, corridor width, footprint against the length he typed in, smallest room." |
| 2:15 | Walkthrough. In the front door, along the corridor, **up the stairs** | Say nothing for five seconds. Let it speak |
| 3:00 | Route: Exterior → Server Room. Then the bridges list | "Two doors are **bridges** — remove one and the building splits in two. A door is an edge, so the critical-door question is a bridge question. The **rooms** whose removal splits the building are the articulation points: the corridor and the stairwell. Sealing the stair isolates six spaces." |
| 3:45 | Select a wall → **Mark breachable**, type a reason. Show the audit log | "A human ticked that box and the reason is in the log. We claim no structural inference we do not have." |
| 4:15 | Mark REVIEWED → LOCK → Briefing Mode, arrow through five steps | "Briefing is gated on the document status, not on the interface. An unverified model cannot reach a commander." |
| 4:45 | Neighbourhood view + Export GLB | "Still offline. The area pack was downloaded at install time." |

### The three lines that win the round

1. "A door is an edge, so critical doors are **bridges**, not cut vertices. Cut vertices
   answer the different question: which *rooms* must a force hold." Most teams get this
   backwards; a CS judge will notice.
2. "The bands are configurable plausibility bounds, not universal truths."
3. "Minimum supervision is not zero supervision. It is measured supervision — here is
   the correction density for this document."

### Honesty notes — say these before a judge finds them

- The blueprint is a **hand-authored fixture**, not a parsed scan. Perception is the
  deferred module, deliberately, so the demo does not depend on the riskiest part.
- The neighbourhood pack is **hand-authored in the OpenStreetMap schema**, not real OSM
  data. The UI says so. Swapping in real PMTiles is a data change, not a code change.
- The content hash is FNV-1a, not SHA-256. It is a cache and tamper key, not a signature.

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
tools/                        migration, fixture check, layer lint, headless smoke test
```

Read `CLAUDE.md` first. It is the document of record and it settles the conflicts
between the design documents in `docs/`.
