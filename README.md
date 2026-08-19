# NotMayasabha

SIH problem statement: 
SIH1773 | Conversion of 2D Blueprints into 3D Model

Description:
1. National Security Guard (NSG) operates inside buildings, built up areas and other infrastructures like metro stations, schools, etc in case of any terror. Since the operations are of National security significance, better understanding of the target layout is of paramount importance. 3-Dimensional walk through of the buildings helps in the efficient understanding of the target layout and also enables effective briefing of the troops by the Commander for operating inside such targets.

2. Presently, the building authorities provide 2-Dimensional layout of the building in the form of blue prints/ floor plan. Assimilation of the situation and appreciating the potent threat with the help of 2-Dimensional layout turns out to be a challenging task. In such a scenario, a 3-Dimensional walk-through of the building helps significantly in increasing the efficiency of the ground forces while operating.

3. The software which needs to be developed should take the 2-Dimensional blueprint layout as input and also should take various parameters like length, breadth, height of the building, layout of staircase, entry and exit, etc as additional inputs. The software should then export them to a file and create a full fledged 3-Dimensional walkthrough model of the building. The software must also include the facility for integration of exported model to the offline Google maps, Satellite pictures (if any available).

4. Since the target includes buildings which are secretive in nature, the software is required to be operable fully in standalone mode, without any internet connectivity required in future. For the initial installation phase, the system can be connected to the internet to facilitate fetching up of Maps, satellite imagery from open source, etc required for the software functioning.

5. This software would also reduce the time taken during the initial briefing of the troops prior to the launch of any operation. It further increases the efficiency of the operations, thus resulting in early success.

6. The conversion of 2-Dimensional blueprints to 3-Dimensional models must address following problems.

(a) Software should take 2-Dimensional blueprint as an input and produce 3- Dimensional walk through as output.
(b) Provisions to input parameters like length, breadth, height of the building and other details should be included.
(c) Minimum supervision from the user end should be needed to finalise the conversion.
(d) Offline integration with Google maps, satellite imagery to get enhanced output covering the nearby geographical areas as well.

**A 2D building blueprint becomes an offline, correctable, tactical 3D walkthrough.
A commander can brief an assault team in minutes, on an air-gapped laptop.**

**Live: [notmayasabha](https://notmayasabha.vercel.app)**

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

## Tactical markers — what every colour in the 3D view means

Nothing in the viewer is decorative. Every colour is a computed property of the room
graph, drawn in `src/view3d/overlays.ts`. If you can't say what a marker means, don't
point at it.

| Marker | Colour / shape | Meaning |
|---|---|---|
| **Bridge door** | Red door slab | A graph bridge (§ below). Remove this door and the building splits into two disconnected pieces. The single points of failure |
| Ordinary door | Grey door slab | Redundant — there is another way around |
| Entry pylon | Green cone, floating | An `is_entry` opening |
| Exit pylon | Yellow cone, floating | An `is_exit` opening |
| Route | Cyan tube, with a ring at every doorway it crosses | The currently computed shortest path over the door graph |
| **Critical room** | Orange-tinted floor | An articulation point (§ below). Losing this room disconnects the graph, independent of any single door |
| Target beacon | Red/pink translucent cylinder | The room selected as the objective for the current route |
| Briefing marker | Pink octahedron on a stem | A human-placed threat / hostage / IED / cover marker |
| Selection outline | Cyan-green box | Whatever room or door is currently selected in either view |
| Wall tint | Faint wash of the room's floor colour | Added so a first-person walker can tell which room they're in without leaving the walkthrough — see `storeyInteriorWallGeometry` in `src/geometry/build3d.ts` |

---

## Why this is not just "2D → 3D"

Extruding walls from a floor plan is a rendering problem with a fixed answer: it has
been solved since Raster-to-Vector (Liu et al., ICCV 2017). Everything after extrusion
in this project is a different kind of problem — a **derivation** problem, with a real,
checkable mathematical answer, not a rendered guess.

**One occupancy grid, four consumers.** `src/core/grid.ts` flood-fills a `Uint8Array`
from each room's seed point. Room extraction, room area, walkthrough collision and the
corridor-width sanity check all read that same grid. Nothing is polygonized, so an
unclosed wall loop degrades to one visibly-too-large room instead of throwing — a
detectable failure mode instead of a silent one.

**The room graph is the real artifact.** `src/analysis/graph.ts` turns the floor plan
into a graph: rooms are nodes, doors and stairs are edges. Three classical graph
algorithms run on it, each O(V+E), each with a genuine tactical reading:

- **Bridges** (`bridges()`, iterative Tarjan low-link DFS) — a door is an *edge*, so
  "which doors are critical" is a **bridge** question, not a cut-vertex question. Most
  teams get this backwards.
- **Articulation points** (`articulationPoints()`, same DFS) — a room is a *node*, so
  "which rooms are critical" is the cut-vertex question. Bridges and articulation
  points answer different questions and are drawn with different colours on purpose.
- **Betweenness centrality** (`betweenness()`) — which rooms sit on the most
  shortest paths between other rooms. The corridor lights up because the graph says
  so, not because someone decided corridors are important.

**Scale is falsifiable, not assumed.** `src/core/scale.ts` runs five independent,
deterministic sanity checks — door width, wall thickness, corridor width, bounding
box against a manually-entered dimension, and smallest room area — against
**configurable plausibility bounds**, not universal truths. `VALIDATED` requires zero
`FAIL` and at most one `WARN`. If the scale is unknown, the state is `UNSCALED`: a
legal, visible, red-banner state where areas are **refused, not defaulted**, and
export and briefing are blocked. A confidently wrong building is the worst output this
system can produce, so the system is built to say "I don't know" instead.

None of this needed a neural network. It needed the floor plan to become a graph
instead of a picture — and once it's a graph, sixty years of graph theory is free.

---

## What to tell the judges

This is an internal SIH selection round, not a stage pitch. Two faculty visits:
**2:30 PM** is unscored mentoring — get real feedback, don't perform for it. **4:00 PM**
is the evaluation, and it scores how well you engaged with that feedback, not whether
you agreed with all of it. You are explicitly allowed to defend a decision to not
take a piece of feedback — with a reason, not a shrug.

What they are actually checking for, in order:

1. **Do you understand the real problem, and who has it** — not the technology you
   wanted to use. Lead every answer with the commander under time pressure, not with
   three.js or graph theory.
2. **Does the solution genuinely follow from the problem**, or was the problem
   reverse-engineered to justify a tool you liked? If asked "why graph theory," the
   honest answer is the problem statement itself: NSG needs chokepoints and critical
   rooms, and a room graph is the only representation that can answer that question
   at all — a rendered mesh cannot.
3. **Did you engage with round-1 feedback** — by 4:00 PM, be ready to say plainly
   what changed and, just as importantly, what you deliberately did *not* change and
   why.
4. **Is there a realistic, buildable 36-hour plan** with named ownership — not "we'll
   figure it out." Use the day-by-day plan and the six roles in `docs/sih.md` §15 as
   the answer, not an aspiration.

### The sentence to open with

> "A commander gets a paper floor plan. He has twenty minutes to brief an assault
> team. We give him a 3D walkthrough in under a minute, on a laptop with no internet."

Say this before any mention of three.js, TypeScript, or graph theory. Technology is
the answer to a question the judges haven't asked yet.

### The best three things to actually show

1. **Turn the network adapter off, on screen**, then keep working. The SEALED badge
   counts every outbound attempt and refuses it — this is provable, not claimed, and
   it is the single most memorable thing you can do in the room.
2. **Click Clear scale.** Red banner. Areas refuse to render instead of guessing.
   "A commander told a corridor is 2.0 m when it is 1.2 m is worse off than a
   commander told nothing." This is the line that separates you from a team that
   just renders a mesh.
3. **The bridges list next to the route.** "Two doors are bridges — remove one and
   the building splits in two. A door is an edge, so the critical-door question is a
   bridge question. The rooms whose removal splits the building are the articulation
   points, and they get a different colour on purpose." A technical mentor will
   notice you got this distinction right.

### If feedback pushes on something, and you disagree

Say so, with the reason, out loud — that is what "engaged with feedback, not
compliant with feedback" means to this rubric. Examples already reasoned through in
`docs/sih.md`:

- If told to fake the Google Maps integration the problem statement literally asks
  for: the terms of service prohibit bulk offline caching of Google tiles. That's not
  a corner cut, it's a legal constraint — the OSM-schema offline pack is the answer,
  not a workaround.
- If told the CV/parsing pipeline should be the headline: the blueprint in this demo
  is a hand-authored fixture on purpose, so the demo doesn't depend on the riskiest,
  least-differentiating part of the pipeline. Perception is deferred, not skipped.

### Honest answers beat confident ones

Straight from `docs/sih.md` §13 and §17 — this is what the mentors are trained to
listen for:

- "What if the model is wrong?" → Confidence per element, a review canvas, an audit
  log with `prev_hash`. The system is designed to be wrong *safely*, not to never be
  wrong.
- "What's genuinely new here?" → The combination, not the parser. Floor-plan-to-3D is
  commodity. Air-gapped, auditable, tactical semantics with a measured
  human-correction loop is not. Say this plainly — overclaiming novelty is the
  fastest way to lose a technical panel.
- If you don't know an answer, say so. Every source on hackathon judging agrees:
  honest uncertainty scores better than a confident guess, and a team that can't
  answer questions about its own assumptions is the single most common reason teams
  don't advance.

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
