---
name: mayasabha-build
description: Operating manual for an AI coding agent working in the repository (SIH1773, 2D blueprint to 3D tactical model, National Security Guard). Read this before writing any code. It defines the invariants, the stage contract, the build order, the definition of done for each module, and the rules that must never be broken.
---

# Mayasabha — AGENT OPERATING MANUAL

You are working in a hackathon repository under time pressure. A demo happens in days, not
weeks. Read this file fully before the first edit. Re-read section 1 before every commit.

Companion documents in this repository:
- `ARCHITECTURE.md` — the system design. It is authoritative for structure.
- `skill.md` — the competition strategy. It is authoritative for scope and priority.

---

## 1. PRIME DIRECTIVES

Break any of these and the build is wrong, even if the tests pass.

### D1 — The schema is the contract
`core/schema` is the source of truth. Never invent an ad-hoc dict where a schema type
exists. Never add a field to a model without updating the JSON Schema and the fixtures in
the same commit.

### D2 — One writer
Only `L3` (the review gate) writes to a `BuildingModel`. Perception and reconstruction
**produce** a model. Analysis, render and geo **read** a model. If you find yourself
mutating a model outside the gate, stop and ask.

### D3 — Derived data is never truth
Nav mesh, space graph, mesh and findings are recomputed from the model. Never persist them
as authoritative. Cache them by `sha256(canonical_json(model))` and let the hash invalidate.

### D4 — No sockets below the app layer
Modules in `core/`, `perception/`, `reconstruct/`, `analysis/`, `render/` and `geo/` must
not import `requests`, `httpx`, `urllib`, `socket` or any client library. If you need
remote data, it belongs in `tools/` and runs at build time only.

### D5 — Never guess the scale
If `CoordinateFrame.confidence < 0.75` or `dispersion > 0.08`, raise `ScaleUnresolved`.
Do not substitute a default. Do not "assume 1:100". A silently wrong scale produces a
confident, wrong building. That is the worst failure this system can have.

### D6 — Every geometric element carries `confidence` and `provenance`
No exceptions. `provenance` is `auto`, `user` or `imported`. These two fields power the
review UI, the audit log and the metrics.

### D7 — Every `Finding` carries at least one anchor
A finding with no `space_id`, `wall_id` or point is a bug. Anchors are what link the 2D
canvas, the 3D view and the findings list to the same entity.

### D8 — Determinism
Same input, same output, byte for byte. No wall clock in a stage. No unseeded random. If a
stage needs randomness, take the seed from `Context`.

### D9 — Never edit a fixture to make a test pass
If an expected output is genuinely wrong, change it in a **separate commit** whose message
explains why it was wrong.

### D10 — The demo path is sacred
After the freeze, the `demo` branch takes no merges. See section 8.

---

## 2. LAYERS AND IMPORT RULES

```
L0 core        → imports nothing from this repository
L1 perception  → may import core
L2 reconstruct → may import core, perception
L3 review gate → may import core
L4 projections → may import core, analysis, render, geo
L5 ui          → talks to the API only
L6 app         → may import everything
```

An upward import is a build error. Run `make lint-layers` before every commit.

If you believe you need an upward import, you have put the code in the wrong module.
Move the code. Do not relax the rule.

---

## 3. THE STAGE CONTRACT

Every processing step is a stage.

```python
class Stage(Protocol):
    name: str
    def run(self, inp: StageInput, ctx: Context) -> StageOutput: ...
```

Requirements for every stage you write:

1. Pure. No hidden state, no globals, no clock, no network.
2. Input and output are Pydantic models and are JSON-serializable.
3. A fixture pair exists: `fixtures/<stage>/<case>/input.json` and `expected.json`.
4. It fails loudly. Raise a typed error from `core/errors`. Never return a silent default.
5. It records confidence for anything uncertain.

When you add a stage, add its fixture **in the same commit**. A stage without a fixture
cannot be mocked, and a stage that cannot be mocked can kill the demo.

---

## 4. BUILD ORDER — DO NOT REORDER

Work one step at a time. Do not start step N+1 while step N is red.

| Step | Task | Definition of done |
|---|---|---|
| 0 | `core/schema` + a hand-written `BuildingModel` fixture | The fixture validates. `make test-contracts` is green |
| 1 | `core/netguard` + `/health` | `make test-sealed` passes. `/health` reports `sealed: true` |
| 2 | `render/mesh` + GLB export | The hand-written fixture becomes a GLB that opens in a viewer |
| 3 | `ui` walkthrough | WASD movement, 1.6 m eye height, collision, ≥ 45 fps |
| 4 | `perception/ingest/dxf_loader` | A real DXF becomes a real `BuildingModel`. First true end-to-end run |
| 5 | `reconstruct` classical path | A clean raster plan becomes a model. No neural network involved |
| 6 | `core/frame/ScaleSolver` | Scale from OCR dimensions, with evidence and dispersion |
| 7 | `analysis/graph` + `analysis/nav` | Chokepoints and a route render in the 3D view |
| 8 | `L3` review gate, ten operations | Edits apply, undo works, the log persists |
| 9 | `geo` area pack + placement | The footprint sits on an offline basemap |
| 10 | `render/brief` PDF | A one-page briefing pack exports |
| 11 | `perception/detectors/neural` (ONNX) | An accuracy upgrade. **Never a dependency of any earlier step** |

Note the order. The 3D viewer is built at step 2 against a **fake** model. Perception
arrives later into a system that already renders. If perception never works, there is
still a demo.

---

## 5. DEFINITION OF DONE — PER MODULE

Before you mark any module complete, all of these must be true.

- [ ] Types are declared. `mypy` is clean for that module.
- [ ] A fixture exists and `make test-contracts` covers it.
- [ ] The determinism test passes for that stage.
- [ ] Errors are typed and come from `core/errors`.
- [ ] No `print`. Use the structured logger.
- [ ] No network import (D4). `make lint-layers` is green.
- [ ] Confidence and provenance are populated where the schema requires them.
- [ ] The module has a five-line docstring: what it takes, what it returns, what it assumes.
- [ ] One human on the team can explain it without reading the code.

That last item is not optional. Judges ask. "The AI wrote it" ends a team's run.

---

## 6. CODING STANDARDS

| Rule | Reason |
|---|---|
| Python 3.11+, Pydantic v2, full type hints | The schema is the contract |
| Geometry in metres, floats, storey-local coordinates | One unit system. Pixel space stays inside `perception` |
| Pixel space never leaves `perception` | The `CoordinateFrame` is the only bridge |
| Shapely for polygons, NetworkX for graphs, trimesh for meshes | Mature, deterministic, offline |
| ONNX Runtime for inference, CPU provider | Small install, no CUDA, predictable latency |
| No new dependency without a note in `DEPENDENCIES.md` | Every dependency is an install risk and a network risk |
| Functions under about 50 lines. Files under about 400 | Reviewable under time pressure |
| Fail fast, fail typed. Never `except: pass` | Silent failure at 2 a.m. costs the demo |

Forbidden in this repository:
- Any agent framework, orchestration library or task queue.
- Any cloud SDK.
- Any telemetry, analytics or crash-reporting library.
- `localStorage` or `sessionStorage` in artifact-style UI code.
- Global mutable state.

---

## 7. WHEN YOU ARE STUCK

Follow this order. Do not skip to the bottom.

1. **Check the fixture.** Does a fixture for the stage below yours exist? Use it. Do not
   wait for the upstream stage to work.
2. **Reduce the case.** Make the smallest blueprint that reproduces the problem. Put it in
   `fixtures/`.
3. **Fall back a level.** The ladder is L0 vector → L1 classical → L2 neural → L3 manual.
   Falling back a level is a correct engineering decision, not a defeat.
4. **Time-box it.** Ninety minutes maximum on any single blocker. Then take the fallback
   and open an issue.
5. **Ask the human.** Say plainly what you tried and what the fallback costs.

Never do these when stuck:
- Do not disable a test.
- Do not edit a fixture.
- Do not add a default that hides the failure.
- Do not add a dependency to escape a bug.
- Do not start a second module while the first is red.

---

## 8. DEMO FREEZE PROTOCOL

The freeze happens **six hours** before the presentation.

Before the freeze:
1. `make test-all` is green.
2. `make test-sealed` is green.
3. The golden path runs end to end on both demo laptops.
4. `--demo-safe` replays a cached, deterministic result for every stage.
5. Two demo videos are recorded and stored locally.

After the freeze:
- `demo` branch is protected. No merges. None.
- Work continues on `main`. It does not reach the demo.
- Any fix that reaches `demo` needs two people to agree, and the full golden path must be
  re-run afterwards.

`--demo-safe` is dependency isolation, not deception. It replays real outputs previously
produced by the real pipeline. Say so if a judge asks. Never mock the feature the judges
came to see.

---

## 9. ANTI-PATTERNS SPECIFIC TO THIS PROJECT

| Anti-pattern | Why it is wrong here | Do this instead |
|---|---|---|
| Neural network → mesh directly | Loses topology, semantics, editability and export | Perception → graph → parametric mesh |
| Hard-coded Manhattan assumption | Destroys any non-rectangular wing | Dominant-angle histogram per sheet, then snap |
| Averaging conflicting detector outputs | Produces geometry no detector believed | Highest confidence wins. Keep the loser as an alternative |
| Silently bridging a wall gap | Creates a room that does not exist | Flag it. Let the user close it in one click |
| Storing the nav mesh in the project file | Goes stale after the first edit | Recompute. Cache by model hash |
| Adding an LLM to a geometry problem | Non-deterministic, slow, and it breaks offline | Use NetworkX and Shapely. Named algorithms defend themselves |
| Building the UI before the schema | Every schema change then breaks the UI | Schema first. Always |
| Waiting for perception before starting 3D | The demo depends on the riskiest module | Build 3D at step 2 against a fake model |
| A default scale factor | A confident, wrong building | Raise `ScaleUnresolved` |
| A settings screen | Nobody will use it in five minutes | Sensible defaults. Two overrides at most |

---

## 10. COMMANDS

```bash
make setup             # venv, deps, download nothing at run time
make dev               # uvicorn on 127.0.0.1 + vite
make test-contracts    # every stage against its fixture
make test-determinism  # same input twice, identical hash
make test-golden       # 8 blueprints, graph metrics within tolerance
make test-sealed       # assert zero non-loopback sockets during a full run
make lint-layers       # no upward imports
make test-all          # everything above
make bench             # timing table for the metrics slide
make pack-area BBOX=…  # build an offline area pack (ONLINE, build time only)
make demo-safe         # run the pipeline in replay mode
```

---

## 11. COMMIT DISCIPLINE

```
<stage-or-module>: <imperative summary>

Why: one line.
Risk: what could this break?
```

Rules:
- One module per commit. Do not mix a schema change with a UI change.
- A schema change updates the JSON Schema, the migration and the fixtures in the same commit.
- A fixture correction is always its own commit, and the message says why it was wrong.
- Never commit a model weight file to git. Use `models/` with a manifest and a checksum.

---

## 12. WHAT "DONE" MEANS FOR THE WHOLE SYSTEM

The system is ready when a person who has never seen it can do this, offline, in under
five minutes:

1. Open the application.
2. Load a blueprint.
3. See the pipeline run, with per-stage progress.
4. See low-confidence elements highlighted, and fix two of them.
5. Walk through the building in first person.
6. Ask for the route from the main entry to a named room, and see it drawn.
7. See the chokepoints highlighted in both 2D and 3D.
8. See the building footprint on an offline map.
9. Export a GLB and a briefing PDF.
10. Confirm from `/health` that the application never opened a network socket.

If any step needs a developer beside the user, that step is not done.
