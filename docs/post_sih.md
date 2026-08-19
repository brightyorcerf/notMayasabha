# POST_SIH — not built, on purpose

Nothing in this file is read during the build. It exists so that a good idea arriving at
the wrong moment has somewhere to go that is not the codebase.

## Deferred, with the reason

| Item | Why it is not in this build |
|---|---|
| Perception (raster → proposals) | The riskiest module. The architecture makes it replaceable, so it is built last or not at all. The demo runs on a hand-authored, frozen document |
| DXF / DWG ingest | The L0 fast path. Valuable, but the fixture proves the whole downstream chain without it |
| OCR dimension ladder | Ladder 3 of 4. The calibration segment (ladder 2) is the one that demos in five seconds |
| Manual-bbox ladder | Weakest ladder. Depends on CV quality that does not exist yet |
| Neural detectors (ONNX) | An accuracy upgrade, never a dependency of an earlier step |
| Sightline analyser | Fiddly visibility geometry, roughly a day, and the graph analysers already answer the tactical question |
| ClearOrder, Egress analysers | Same forty lines each as the ones that shipped. Cheap to add, nothing new to prove |
| PDF export | Replaced by Briefing Mode. Cheaper to build and better on stage |
| IFC export | Nobody in the judging room opens an IFC file |
| Encrypted `.sitepkg` (AES-GCM) | About 30 lines and a good eight seconds on stage. Cut only for time — put it back first |
| Automatic multi-storey registration | Research grade, fails silently. Two anchor clicks replace it |
| Curved and spline walls | Polylines only. Under 5 % of target buildings |
| Real OSM / Sentinel-2 area pack | The neighbourhood fixture is hand-authored in the OSM schema and **is labelled as such in the UI**. Swapping in real PMTiles is a data change, not a code change |
| Full 2D editing (MOVE_NODE, SPLIT_WALL, ADD_WALL) | The op log and the undo cache are built and proven with the semantic ops. Geometric ops slot into the same machinery |
| Triage queue over CV proposals | Needs proposals, which need perception |
| VR / AR, Unity, Unreal | Install time, export risk, crash risk on someone else's laptop |
| Accounts, RBAC, collaboration | Offline single-operator tool |
| Settings screen | Nobody opens one in a five-minute demo |

## Ideas parked mid-build

- Room "paint" flood-fill escape hatch from a click, for faces that will not close.
  The grid already supports it; only the UI is missing.
- `DEMO_SAFE=1` replay mode. Currently unnecessary: there is no backend to fail.
- Betweenness-weighted clearing order. The centrality numbers are already computed.
