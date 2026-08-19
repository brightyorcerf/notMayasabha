# Mayasabha — SIH1773, 2D blueprint → tactical 3D

One document of record. Where the source documents disagree, this file wins.

| Document | Status |
|---|---|
| `docs/ARCHITECTURE.md` | **The design. Single source of truth.** v2 and the freeze patch are merged into it; both are superseded and live only in git history |
| `docs/compliance.md` | Clause-by-clause check against the problem statement |
| `docs/POST_SIH.md` | Everything deliberately not built. Do not read it during the build |
| `README.md` | What runs today, and the five-minute demo script |
| `skill.md` | Competition strategy, pitch, judge Q&A |

---

## 1. THE FIVE SETTLED CONFLICTS

v2 and the freeze patch disagreed in five places. These are decided. Do not reopen them.

| Question | Decision | Where |
|---|---|---|
| Wall thickness unit | `thickness_u`, document units | `ARCHITECTURE.md` §2.1 |
| Opening position | `anchor` + `offset_u`, never a normalised `t_center` | §2.4 |
| Room boundary | `seed_point_u` + flood fill, never stored `boundary_nodes` | §2.5 |
| Scale scope | One `meters_per_unit` per document (invariant I6), not per storey | §2.3 |
| Undo | Rolling cache of 50 document states. `Op.prev_hash` is tamper evidence, not undo | §2.9 |

Two more, decided here:

- **Geometry runs in TypeScript, in the browser.** No Python on the demo path at all.
  If a perception backend ever exists and dies, the building still renders. (§6.1.)
- **No PDF.** Briefing Mode replaces it. (§9, `compliance.md` G1.)

---

## 2. INVARIANTS

| # | Invariant | Where it is enforced |
|---|---|---|
| I1 | Only an `Op` writes to the document | `core/session.ts` is the only writer |
| I2 | Derived data is never truth | `derive()` recomputes; nothing is persisted |
| I3 | Nothing below the app layer opens a socket | `tools/lint-layers.mjs` + `core/netguard.ts` |
| I4 | Scale is never silently assumed. `UNSCALED` is a legal, visible, degraded state | `core/scale.ts` |
| I5 | XY is in document units. Metres come only through `meters_per_unit` | Grep rule below |
| I6 | One `meters_per_unit` for the whole document | `SiteDocument.scale` |
| I7 | Every element carries `confidence`, `origin` and `verified` | `core/types.ts` |
| I8 | Every `Finding` carries an anchor | `core/site.ts` |

**Grep rule for I5:** an `_m` field is a Z-axis or user-parameter field. Nothing else.
An `_u` field is a plan-space field. There is no third case.

---

## 3. LAYERS

```
core       0   schema, grid, scale, ops, session, netguard   — imports nothing above
geometry   1   wall panelisation, mesh generation
analysis   2   room graph, bridges, articulation, routes
geo        2   offline area pack
view2d/3d  3   canvas plan, three.js viewer, overlays
ui         4   panels, app wiring, briefing, export
```

An upward import is a build error. `npm run lint-layers` before every commit.
If you think you need one, the code is in the wrong module. Move the code.

---

## 4. HOW THE MODEL WORKS

```
site.json  ──derive()──▶  occupancy grid ──▶ rooms, areas, collision, corridor width
    │                          │
    │                          └──▶ room graph ──▶ bridges, articulation, routes
    │
    └──apply(Op)──▶ site.json'      ops.jsonl is the history; site.json is a checkpoint
```

**One occupancy grid, four consumers.** Room extraction, room area, walk collision and
the corridor-width sanity check all read the same `Uint8Array`. A flood fill degrades
gracefully: an unclosed wall loop leaks into the neighbour and shows up as one large
room, which is visible and correctable. A polygonizer would throw.

**Two masks.** `wallMask` has no doorways carved, so room fills cannot leak outdoors.
`walkMask` has them carved, so a person can walk through a door. Never confuse them.

---

## 5. THE ONE THING THAT MUST NOT BREAK

Scale. A confidently wrong building is the worst output this system can produce.

- `meters_per_unit === null` ⟺ state is `UNSCALED`.
- `UNSCALED` renders, in normalised units, under a red banner, with **areas refused
  rather than defaulted**, and with export and briefing blocked.
- `VALIDATED` needs zero `FAIL` and at most one `WARN` across the five sanity checks.
- The bands in `core/scale.ts` are **configurable plausibility bounds**, not universal
  truths. Say that out loud if a judge asks.

---

## 6. STANDARDS

- TypeScript, strict, full type hints. `npm run check` clean.
- Functions under ~50 lines. Files under ~400.
- Fail loudly and typed. Never `catch {}`. Never a default that hides a failure.
- Five-line module docstring: what it takes, what it returns, what it assumes.
- Every member must be able to explain their own module without notes. Judges ask.
  "The AI wrote it" ends a team's run.

Forbidden: agent frameworks, cloud SDKs, telemetry, analytics, crash reporting,
`localStorage`, global mutable state, any LLM anywhere in the geometry path.

---

## 7. COMMANDS

```bash
npm run dev            # vite on 127.0.0.1:5173
npm run check          # tsc, no emit
npm run lint-layers    # no upward imports, no network below the app layer
npm run test-fixture   # fixture sanity, no TypeScript involved
npm run test-contracts # headless run of the whole derived pipeline + op log + determinism
npm run test-all       # all of the above, then a production build
```

`npm run test-all` must be green before every commit. It takes about ten seconds.

---

## 8. WHEN YOU ARE STUCK

1. Check the fixture. `fixtures/site.json` is frozen and always works. Build against it.
2. Reduce the case. Smallest plan that reproduces it, into `fixtures/`.
3. Fall back a level: L0 vector → L1 classical → L2 neural → L3 manual.
4. Time-box at 90 minutes, then take the fallback and open an issue.
5. Ask a human. Say what you tried and what the fallback costs.

Never: disable a test, edit a fixture to make a test pass, add a default that hides a
failure, add a dependency to escape a bug, or start a second module while the first is red.

A fixture correction is always its own commit, and the message says why it was wrong.

---

## 9. DEMO FREEZE

Six hours before the presentation:

1. `npm run test-all` green.
2. Golden path run end to end on both laptops.
3. Two demo videos recorded and stored locally.
4. `demo` branch protected. No merges after the freeze. None.

Work continues on `main` and does not reach the demo. Any fix that reaches `demo` needs
two people to agree, and the golden path is re-run afterwards.

---

## 10. THE SENTENCE TO DEFEND

> The CV model is not the product. The verified floor graph is the product. We built a
> blueprint verification workstation with a 3D renderer attached — not a converter with a
> human bolted on for error cases. Every element carries who created it and whether a
> human has verified it. A model that has not been verified cannot reach a commander,
> because briefing mode is gated on the document status, not on the interface.

And its companion, for the judge who says "this is a manual CAD editor with AI branding":

> Minimum supervision is not zero supervision. It is *measured* supervision. The system
> reports exactly how much human effort a given blueprint costs, and every engineering
> decision drives that number down. A system that claims zero supervision is a system
> that has not measured its own error rate.
