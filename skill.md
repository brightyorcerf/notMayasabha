---
name: sih1773-playbook
description: Internal winning playbook for Smart India Hackathon problem statement SIH1773 (Conversion of 2D Blueprints into 3D Model, National Security Guard). Use this for all work on the internal college hackathon, the SIH idea PPT, the architecture, the demo script, the metrics, and judge Q&A preparation.
---

# SIH1773 WINNING PLAYBOOK

Problem statement: **SIH1773 — Conversion of 2D Blueprints into 3D Model**
Organisation: **National Security Guard (NSG), Ministry of Home Affairs**
Theme: Smart Automation. Category: Software.

This document is written in Simplified Technical English (ASD-STE100).
Short sentences. Active voice. One idea per sentence.

---

## 1. THE ONE-SENTENCE FRAME

> We convert a scanned building blueprint into an offline, correctable, tactical 3D
> walkthrough. A commander can brief an assault team in minutes, on an air-gapped laptop.

Say this sentence first in every pitch. Do not start with the technology.

### 1.1 What the problem really is

This is **not** a machine-learning accuracy problem. It is a **trust and time** problem.

- NSG does not need a perfect model. NSG needs a **trusted** model, fast.
- The user is a commander under time pressure. The user is not a CAD operator.
- The measure of success is **time to a briefable model**, not mean IoU.

Most teams will build a segmentation model and extrude walls. That approach is
15 years old and is a solved research task. It will not win.

### 1.2 The five requirements in the problem statement

Read them again. Each one is a scoring line.

| Ref | Requirement | Most teams will | You must |
|---|---|---|---|
| 6(a) | 2D blueprint in, 3D walkthrough out | Do this | Do this, plus tactical semantics |
| 6(b) | Input length, breadth, height, stairs, entry, exit | Add a form | Auto-detect scale from dimension text, then let the user correct |
| 6(c) | Minimum supervision | Claim "fully automatic" | Claim "assisted", and **measure correction time** |
| 6(d) | Offline maps and satellite imagery | Skip or fake it | Ship a real offline map pack |
| Para 4 | Full standalone operation, no internet | Ignore | **Demonstrate it live with the network off** |

Requirement 6(d) and paragraph 4 are the ones that separate you from the field.
They are unglamorous. Very few teams will do them. Do them.

---

## 2. THE SHARPEST INSIGHT: THE PROBLEM STATEMENT CONTAINS AN IMPOSSIBILITY

The problem statement asks for "offline integration with Google Maps".

Google Maps Platform terms of service prohibit the bulk download, the caching and the
redistribution of map tiles for offline use. An air-gapped, standalone installation with
Google tiles is not legally deliverable. Confirm the current terms yourself before you
present this.

**Do not point this out as a complaint. Present it as an engineering decision.**

Propose the compliant alternative:

- **OpenStreetMap** vector data, packaged as PMTiles or MBTiles. Open licence (ODbL).
- **Bhuvan (ISRO / NRSC)** for Indian satellite imagery. An Indian government source.
- **Sentinel-2 (ESA Copernicus)** for open, free multispectral imagery.
- One "Area Pack" file, downloaded during the online installation phase, then used forever offline.

This single slide does three things:

1. It proves you read the problem statement more carefully than anyone else.
2. It shows legal and procurement awareness. Government judges value this a lot.
3. It gives you a defensible answer when a judge asks "how is this different?"

---

## 3. REFERENCE PROJECT ANALYSIS: MedSim (kokonut121/medsim)

MedSim won "most innovative" at the 2026 Harvard HSIL Hackathon. It builds Gaussian-splat
world models of hospitals from Street View imagery. It then runs six parallel Claude agent
teams over the model to find safety risks. It streams findings over Redis and WebSockets to
a Next.js viewer, and exports PDF and FHIR reports. Storage and audit run on InterSystems IRIS.

### 3.1 What transfers directly

| Idea | Why it transfers | How you use it |
|---|---|---|
| **A structured intermediate representation** (their scene graph) | The graph, not the mesh, is the real product | Build a **Building Graph** JSON. Everything else is a view of it |
| **Synthetic fallback flag** (`USE_SYNTHETIC_FALLBACKS=true`) | Demo insurance | Add `--demo-safe`. It replays a cached, deterministic result |
| **Named pipeline stages with one data-flow diagram** | Judges read diagrams, not code | Copy the arrow-chain diagram style into your README and slide 3 |
| **Export artifacts as the deliverable** (PDF + FHIR) | The user keeps something | Export GLB, IFC and a printable **Assault Briefing Pack** PDF |
| **Live progress streaming** | Good demo theatre | Local Server-Sent Events. Show stage-by-stage progress |
| **Repository documents** (ARCHITECTURE.md, PRD.md, AGENTS.md) | Cheap credibility | Write all three. Judges open the repository |
| **Domain-specific analysis layer on top of geometry** | This is why they won "most innovative" | Your tactical layer is the equivalent. See section 5 |

### 3.2 What does NOT transfer — and why copying it would lose

| Idea | Why it fails here |
|---|---|
| Gaussian splats / World Labs API | Splats need photographs. Your input is a line drawing. Also cloud-only |
| Six parallel LLM agent teams | Non-deterministic, slow, expensive, and **impossible offline**. Geometry is deterministic. Do not put an LLM where a solver works |
| Google Street View / Places acquisition | The target buildings are secret. There is no public imagery |
| InterSystems IRIS, FHIR R4 | Healthcare-specific |
| Modal A10G serverless GPU | Air-gapped means local CPU or one local GPU |
| Cloudflare R2, Upstash Redis, Mapbox tokens | Every one of these is a network call. Each one fails your core requirement |

**The core lesson is inverted.** MedSim's architecture assumes the cloud. Your problem
statement forbids the cloud. If you copy the shape of MedSim, you lose on the requirement
that matters most.

**Take the design discipline. Reject the runtime.**

### 3.3 The trap to avoid

Your team will feel pressure to add "AI agents" because the reference project has them and
because it sounds advanced. Resist this. A judge will ask "does it run without internet?".
An agent swarm has no good answer. Use a small local model for parsing, and deterministic
algorithms for everything else.

---

## 4. RECOMMENDED ARCHITECTURE

Working name suggestions: **NotMayasabha**, **DRISHTI**, **PRAHAAR**. Pick one. Names help judges remember you.

### 4.1 Principle

> Image → **Graph** → 3D.
> Never image → mesh.

The Building Graph is inspectable, editable, exportable, versionable and small. A neural
mesh is none of these things.

### 4.2 Pipeline

```
[1] INGEST          PDF / PNG / JPG / DXF
                    If DXF or DWG exists, parse vectors and skip the ML branch entirely.
                          |
[2] PRE-PROCESS     deskew, denoise, binarize, dewarp photographed scans
                          |
[3] PARSE (hybrid)  ML branch:        wall / room / opening segmentation (CubiCasa5K-style)
                    Classical branch: morphology, line detection, skeletonization
                    Symbol branch:    doors, windows, stairs, lifts
                    OCR branch:       room labels AND dimension strings  -> AUTOMATIC SCALE
                          |
[4] VECTORIZE       wall centrelines, junction detection, collinear merge,
                    room polygons from planar-graph face extraction,
                    constraint solve for alignment
                          |
[5] BUILDING GRAPH  storeys, walls, openings, rooms, stairs, entries, exits
                    every element carries: confidence + provenance (auto | edited)
                          |
[6] REVIEW CANVAS   2D overlay on the original scan
                    low-confidence elements are highlighted
                    the user drags to correct. Every edit is logged
                          |
[7] GENERATE 3D     parametric extrusion from the graph -> GLB (+ IFC export)
                          |
[8] TACTICAL LAYER  navmesh, routes, sightlines, chokepoints, breach points
                          |
[9] WALKTHROUGH     first-person camera, eye height 1.6 m, collision
                          |
[10] GEO-CONTEXT    footprint placed on offline PMTiles / MBTiles basemap
                          |
[11] EXPORT         GLB, IFC, encrypted .mission package, briefing PDF
```

### 4.3 Stack recommendation

| Layer | Choice | Reason |
|---|---|---|
| Core | Python + FastAPI, run on localhost | Fast to build. The team knows it |
| CV / ML | PyTorch, OpenCV, PaddleOCR or Tesseract | All work offline. All bundle into an installer |
| Geometry | Shapely, NetworkX, trimesh, pygltflib | Deterministic and mature |
| 3D view | three.js / react-three-fiber | Fastest path to a walkthrough |
| Map | MapLibre GL + local PMTiles | Genuinely offline. No API key |
| Shell | Tauri or Electron, one installer | Proves "standalone software", not "website" |
| Storage | SQLite, encrypted project file (AES-GCM) | No server. Matches the secrecy requirement |

**Do not use Unity or Unreal for the internal round.** Build time is too long. Keep a
Godot or Unity export path as a future-work slide only.

### 4.4 Automatic scale — build this, it is a genuine differentiator

Blueprints carry dimension text ("3600", "3.60 m", "12'-0\""). Read it with OCR. Match
each dimension string to the nearest wall run. Compute pixels-per-metre. Take the median
across all matched dimensions and report the variance as a confidence value.

Fallback: the user clicks two points on a known dimension and types the real length.
Two clicks. That is "minimum supervision", and you can defend it.

Most teams will ask the user to type a scale factor. That is worse and it looks worse.

---

## 5. THE TACTICAL LAYER — YOUR REAL DIFFERENTIATION

Floor-plan-to-3D is a commodity. Tactical semantics for an assault force is not.
This layer is why NSG posted the problem, and it is what almost every team will forget.

| Feature | Method | Effort |
|---|---|---|
| Room adjacency graph | Rooms are nodes. Doors are edges | Low |
| **Chokepoints** | Articulation points (cut vertices) of the room graph | Low. High impact |
| **Key rooms to control** | Betweenness centrality on the room graph | Low. High impact |
| Entry-to-target route | Shortest path over the door graph | Low |
| Room clearing sequence | Traversal order over the graph from the chosen entry | Low |
| **Sightlines** | 2D visibility polygon from a chosen point, per storey | Medium |
| Breach point marking | User places markers, saved to the graph | Low |
| Multi-storey stack | Align storeys on a common reference (stair core or lift shaft) | Medium |
| Danger areas | Long corridors, stairwells, junctions with high centrality | Low |

Graph theory here is cheap to implement, correct, explainable and impressive. A judge who
asks "how do you decide which rooms matter?" gets a real mathematical answer, not a guess.

---

## 6. SECURITY AND OFFLINE POSTURE — FREE POINTS

The problem statement says the targets are secret. One slide, five lines:

- Zero outbound network sockets at runtime. Provable with a firewall rule or a packet capture.
- Project files encrypted at rest (AES-GCM). Password or key file.
- No telemetry. No analytics. No crash reporting.
- Full audit log of every automatic result and every human edit.
- Updates by signed offline bundle on removable media.

**Demonstrate it.** In the live demo, disable the network adapter on screen, then run the
full conversion. This is the single most memorable thing you can do in five minutes.

---

## 7. COMPETITIVE ANALYSIS

Claim no novelty in floor-plan parsing. There is none. Claim novelty in the **combination**.
If you claim more, a judge who knows the field will destroy you in Q&A.

| Existing work | What it does | Strength | Weakness | What we learn | How we differentiate |
|---|---|---|---|---|---|
| Raster-to-Vector (Liu et al., ICCV 2017) | Corner prediction, then integer programming to vector floor plans | First strong deep method. Clean vector output | Manhattan assumption. Fails on non-rectangular rooms | Vector output beats pixel output | We keep vector output but drop the Manhattan constraint |
| CubiCasa5K (Kalervo et al., SCIA 2019) | 5000-plan dataset + multi-task CNN, 80+ categories | Best public dataset. Reusable weights | Finnish real-estate plans. Not Indian government blueprints | Start here. Do not train from zero | We fine-tune and we measure the domain gap honestly |
| DeepFloorplan (Zeng et al., ICCV 2019) | Multi-task net with room-boundary-guided attention | Strong room-boundary results | Segmentation only. No 3D. No topology | Boundary-aware losses help | We convert segmentation to a topological graph |
| Raster-to-Graph (Hu et al., CGF 2024) / Raster2Seq (2026) | Autoregressive transformer predicts the wall graph | Graph output is the right target | Heavy model. Hard to run offline on a laptop | The graph is the correct representation | We reach a graph with a lighter hybrid pipeline |
| 3DPlanNet (Park & Kim, 2021) | Ensemble method, 2D plan to 3D | End-to-end 3D | Residential focus. No tactical semantics | 3D generation is the easy part | We spend our effort after the 3D, not on it |
| ArchCAD-400K / FloorPlanCAD | Large CAD symbol-spotting datasets | Good for door / window / stair symbols | CAD vectors, not scans | Use for the symbol branch | We handle degraded scans as well as clean CAD |
| CubiCasa (commercial), Smart2D3D, RoomSketcher, Planner5D, Maket.ai | Cloud services, plan to 3D in minutes | Polished. Accurate on clean plans | **Cloud-only.** Real-estate use. No security posture | The UX bar is high | Air-gapped. Secure. Tactical |
| Revit / ArchiCAD / FreeCAD BIM | Full BIM authoring with IFC | Industry standard. IFC export | Manual. Needs a trained operator. Slow | Export IFC for interoperability | We automate the first 80 percent, then hand over |
| OpenPlan3D / open3dFloorplan (three.js, SvelteKit) | Open-source 2D/3D floor plan editors | Free. Good editing UX | Manual drawing. No blueprint parsing | Reuse editor interaction patterns | We add automatic parsing in front of the editor |
| **Farsight Vision, FSV App "Floor Plan" (June 2026)** | Uploads a 2D plan, converts to a 3D scene for assault rehearsal and VR | **Direct competitor.** Combat-proven context | Platform-tied. Upload via their platform. Foreign vendor | The need is real and validated | Indian data sovereignty. Fully offline. No vendor platform. Open export formats |
| SkyeBrowse | Drone / video photogrammetry for tactical 3D, offline viewers | Real geometry of the real building | Needs physical access to the site | Offline viewers matter to this user | We need no site access. A blueprint is enough |
| The Crime Zone (CAD Zone) | Police 2D/3D diagramming, imports DWG/DXF | Long police adoption | Manual drawing. Dated | DXF import is valuable | We add the DXF fast path plus automatic scan parsing |
| Operator XR Tactical SDK | VR scenario building from imported 3D models | Full VR rehearsal | You must supply the 3D model | This is our downstream customer | We generate the model they need to import |
| Matterport / Polycam | Capture-based digital twins | Photoreal | Needs site access. Cloud | Not applicable to secret targets | Blueprint-only input |

**Honest novelty statement to use with judges:**

> "Floor-plan-to-3D is well studied and commercially available. Nothing in that step is new.
> What does not exist is an air-gapped, auditable, tactical version built for Indian security
> forces, with an offline map pack and a measured human-correction loop. That combination is
> our contribution."

Judges reward this kind of honesty. Overclaiming is the fastest way to lose Q&A.

---

## 8. SCOPE FOR THE INTERNAL HACKATHON (THIS WEEK)

Be ruthless. A stable small demo beats a broken large one. This is the most consistent
finding across every hackathon judging source.

### 8.1 Must have (P0)

1. Upload one clean single-storey blueprint. Get a 3D walkthrough. Target under 60 seconds.
2. Parameter panel: wall height, storey height, scale override.
3. Review canvas with confidence highlighting, and correction of at least **one** element type.
4. **Offline proof.** Network off, on screen, then run the pipeline.
5. **One** tactical feature. Recommended: route from the entry to a selected room.
6. Export: GLB + a one-page briefing PDF.

### 8.2 Should have (P1)

7. Automatic scale from OCR of dimension text.
8. Offline basemap with the footprint placed on it.
9. Chokepoint highlighting.
10. Second storey with manual alignment.

### 8.3 Do NOT build yet (P2 — slide only)

- VR or AR.
- IFC export.
- DWG parsing (DXF is acceptable if it is easy).
- Automatic multi-storey alignment.
- Furniture, textures, photorealistic rendering.
- Any agent framework.

### 8.4 Fallback ladder

Build the levels in this order. Each level must work before you start the next.

| Level | Behaviour | Trigger |
|---|---|---|
| L0 | DXF or vector PDF → exact geometry, no ML | Vector input available |
| L1 | Classical CV: morphology + line detection + contours | Clean CAD-rendered raster |
| L2 | ML segmentation + symbol detection | Noisy or scanned raster |
| L3 | Manual trace in the review canvas | Everything else failed |

**L1 alone produces a convincing demo on clean plans.** Build L1 first. Treat L2 as an
upgrade, not as a dependency. Never let the demo depend on the newest, least tested branch.

### 8.5 Golden path

Prepare 5 to 8 blueprints that you have tested end to end. Include:
- one clean CAD plan (the demo hero),
- one photographed and skewed scan (the robustness proof),
- one deliberately hard plan **that partly fails** (the honesty proof).

Show the failure yourself. Explain the fallback. Judges trust teams that show failures.

---

## 9. FAILURE-MODE ANALYSIS

### 9.1 Technical

| Failure | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model trained on Finnish plans fails on Indian blueprints | High | High | Hybrid pipeline. Classical branch as fallback. Fine-tune on a small hand-annotated set |
| Wrong scale, so the building is the wrong size | High | High | OCR dimensions + median + variance. Two-click manual override always visible |
| Wall loops do not close, so rooms are not detected | High | Medium | Gap-closing morphology, junction snapping, then manual close in the canvas |
| Curved or diagonal walls break the vectorizer | Medium | Medium | Polyline approximation. Flag as low confidence |
| Multi-storey stacking misaligns | High | Medium | Manual pin on a stair core for the internal round |
| Stairs not recognised | High | Medium | Symbol template plus manual placement. Stairs are explicitly named in the PS. Do not skip |
| Walkthrough camera clips through walls | Medium | High in demo | Simple collision capsule. Test it 20 times |
| Offline map pack too large | Medium | Medium | Limit zoom levels. One city at zoom 16 only |
| Model file too large to load in the browser | Low | Medium | Merge geometry, instance repeated openings |

### 9.2 Demo and process

| Failure | Mitigation |
|---|---|
| Live demo crashes | `--demo-safe` mode. A recorded video as backup. Record the video twice |
| Wi-Fi is unavailable at the venue | You are offline by design. Turn this into the story |
| One laptop holds everything | Two laptops. Same build. Test both |
| Last-minute merge breaks the demo | Freeze the build 6 hours before. `demo` branch is protected. No merges after freeze |
| A teammate cannot explain the code | Rule: every member must explain their module without slides. Enforce this the day before |
| The team over-builds and finishes nothing | P0 list only. A daily 15-minute cut meeting |

### 9.3 Judging

| Failure | Mitigation |
|---|---|
| "This already exists" | Section 7. Name the competitors first. State the honest gap |
| "Your accuracy claim is not credible" | Section 10. State N, dataset and hardware for every number |
| "Does this really work offline?" | Show it. Network adapter off, on screen |
| "Who maintains this?" | One slide: offline signed updates, open formats, no vendor lock |
| The deck buries the product under architecture | Demo first. Architecture after |
| "Did you write this code?" | Every member owns a module and can defend it |

---

## 10. METRICS

**Rule: never state a number without N, the dataset and the hardware.**
An invented accuracy figure is the fastest way to lose credibility with a technical judge.

### 10.1 Realistic for a student prototype

| Metric | How to measure | Notes |
|---|---|---|
| Wall detection precision / recall / F1 | Against hand-annotated ground truth, 20–50 plans | Honest and achievable. Annotate as a team over one evening |
| Room detection accuracy / room IoU | Polygon IoU per room, matched by centroid | Standard and defensible |
| **Topology accuracy** | Graph edit distance of the room-adjacency graph vs ground truth | Strong, uncommon, and directly relevant to navigation |
| **Scale error (%)** | Computed scale vs a known dimension | Easy. Directly ties to real-world usefulness |
| Wall position RMS error (cm) | Centreline deviation after scaling | Only on plans with known dimensions |
| **End-to-end conversion time (s)** | Wall clock, stated CPU, no GPU | Judges care about this |
| **Manual correction time (s)** | Stopwatch, 5 test users, to an accepted model | This is the KPI NSG actually wants |
| **Elements auto-accepted (%)** | Count of elements never edited / total | This is the honest reading of "minimum supervision" |
| Pathfinding correctness (%) | Room pairs with a valid path vs ground-truth reachability | Ties the tactical layer to evidence |
| Outbound network connections | Packet capture during a full run. Target: 0 | Binary, provable, unarguable |
| Model size (MB), RAM (MB), walkthrough FPS | Direct measurement on the demo laptop | Cheap and credible |

### 10.2 Do not claim

- Any accuracy figure from fewer than about 20 annotated plans.
- Generalisation to hand-drawn sketches without a hand-drawn test set.
- A comparison to a commercial tool you have not actually run.
- Any absolute claim of "fully automatic".

### 10.3 The honest headline

> "On our 30-plan test set, N of them reached a briefable model in under X minutes, with a
> median of Y manual corrections. Here is the case that failed, and here is why."

That sentence is worth more than "97% accuracy".

---

## 11. THE SIX-SLIDE SIH IDEA PPT

The official template allows a maximum of six slides, including the title slide. Use points,
diagrams and images. Avoid paragraphs. Save as PDF. Use the provided template. Do not change
the section headings.

| Slide | Title | What to put on it |
|---|---|---|
| 1 | Title page | PS ID SIH1773, title, theme, category Software, team ID, team name |
| 2 | Idea title / proposed solution | The one-sentence frame. A before/after image: blueprint → 3D room. Three bullets: air-gapped, tactical semantics, human-in-the-loop correction. State the Google Maps licence problem and your OSM/Bhuvan answer in one line |
| 3 | Technical approach | The 11-stage pipeline diagram from section 4.2. The stack table, condensed. Highlight the Building Graph as the core artifact |
| 4 | Feasibility and viability | The L0–L3 fallback ladder. The three biggest risks with mitigations. State clearly what is already working |
| 5 | Impact and benefits | Reduced briefing time. Reduced operator risk. Reusable across metro, school and hospital pre-incident planning. Fire services and disaster response as secondary users. No recurring licence cost |
| 6 | Research and references | CubiCasa5K, Raster-to-Vector, DeepFloorplan, Raster-to-Graph, OpenStreetMap, Bhuvan, IFC. Name Farsight Vision and CubiCasa as existing work. **Citing your competitors raises your credibility** |

Delete the instructions slide before you upload.

---

## 12. THE FIVE-MINUTE DEMO SCRIPT

Rehearse this five times. Time it. The demo decides the result more than the code does.

| Time | Action | Words |
|---|---|---|
| 0:00–0:30 | Slide 1 only | "A commander gets a paper floor plan of a metro station. He has 20 minutes to brief an assault team. We give him a 3D walkthrough in under a minute, on a laptop with no internet." |
| 0:30–0:45 | **Turn the network adapter off on screen** | "This machine is now offline. Everything after this point is local." |
| 0:45–1:45 | Upload the blueprint. Show the pipeline progress. Show the review canvas | "Red elements are low confidence. I fix this one door. Two seconds." |
| 1:45–3:00 | Enter the 3D walkthrough. Walk in the front door. Go up the stairs | Say nothing for five seconds. Let the walkthrough speak |
| 3:00–4:00 | Tactical layer: route to the target room, chokepoints, sightlines | "The system marks these two doors as chokepoints. They are the cut vertices of the room graph." |
| 4:00–4:30 | Offline map. Footprint on the basemap | "Still offline. This map pack was downloaded at installation." |
| 4:30–5:00 | Export the briefing PDF. Show the failure case | "Here is a plan we handle badly, and here is the fallback." |

Rules:
- Demo before architecture. Always.
- Never mock the thing the judges came to see.
- If a judge interrupts, stop and answer. Do not keep talking over them.
- If you do not know an answer, say so. Honest uncertainty scores better than a confident guess.

---

## 13. JUDGE Q&A — PREPARED ANSWERS

| Question | Answer |
|---|---|
| Why this problem statement? | Time to brief is a measurable operational risk. Every other input for a secret target is unavailable. The blueprint is all you get |
| What already exists? | Name CubiCasa, Farsight Vision FSV, SkyeBrowse, Revit. Then state the gap: air-gapped, tactical, Indian data sovereignty |
| What is genuinely new? | The combination, not the parser. Say this plainly |
| Does it work offline? | Show it. Do not explain it |
| What if the model is wrong? | Confidence per element, review canvas, audit log. The system is designed to be wrong safely |
| What assumptions did you make? | Blueprints are axis-aligned in most cases. Wall thickness is roughly constant per storey. Dimension text exists on most professional drawings. State each one |
| Can it scale nationally? | The output is a file. There is no server to scale. Distribution is by installer and signed offline update |
| How is it maintained? | Open formats (glTF, IFC, PMTiles). No vendor lock. No API keys |
| What would you do with more time? | Automatic multi-storey alignment, IFC, VR rehearsal, DWG, hand-drawn sketch support |
| Did you use AI to build this? | Yes, as a coding assistant. Then explain your own module in detail. Never say "the AI wrote it" |

---

## 14. HOW TO USE AI (KEEP IT SIMPLE)

Ranked by expected value. Do the top three. Ignore the rest unless you have spare time.

1. **Claude Code in the repository.** Give it `skill.md` and `ARCHITECTURE.md` as context.
   This is worth more than every other AI tactic combined. Code beats conversation.
2. **One long "project brain" chat.** Strategy, problem-statement interpretation, deck copy,
   Q&A preparation. One thread keeps context coherent.
3. **One separate red-team chat.** Fresh context, no history. Paste the deck and the demo
   script. Prompt: "You are a skeptical NSG technical judge. Find every weakness."
   The fresh context is the whole point. Do not do this in the project-brain chat.
4. **A single architecture duel, once.** Two independent chats design the parse pipeline.
   A third compares them. Do this **one time**, for the one decision that matters. Do not
   run this ritual for every choice. It costs hours and returns little.
5. **A hierarchical agent system.** Skip it. High overhead, low return, and you cannot
   defend output you did not reason through.

Hard rules for the team:
- Every member must explain their own module without notes. Judges will ask.
- AI writes drafts and boilerplate. Humans own the pipeline logic and the geometry.
- Log which AI tools you used. Be transparent if asked.

---

## 15. TEAM AND SCHEDULE

Roles (six members, at least one female member is mandatory under SIH rules):

| Role | Owns |
|---|---|
| Lead / integrator | The demo build, the freeze, the merge queue |
| CV / parsing | Stages 2–4 |
| Geometry / graph | Stages 5, 7, 8 |
| Frontend / 3D | Stages 6, 9 |
| Geo / offline packaging | Stage 10, the installer, the offline proof |
| Docs / pitch / metrics | The deck, the ground-truth annotation, the metrics table |

Suggested day plan for a short internal round:

| Day | Target |
|---|---|
| 1 | L0 + L1 working end to end on one clean plan. Ugly is fine |
| 2 | Building Graph + 3D extrusion + walkthrough. First full loop |
| 3 | Review canvas + one tactical feature + offline map |
| 4 | Metrics run, annotation, deck, briefing PDF export |
| 5 | Freeze. Rehearse five times. Record two backup videos |

---

## 16. THE CHECKLIST BEFORE YOU PRESENT

- [ ] The demo runs with the network adapter disabled.
- [ ] `--demo-safe` mode works.
- [ ] Two laptops carry the same working build.
- [ ] Two demo videos are recorded and stored locally.
- [ ] The deck is six slides, exported as PDF, in the official template.
- [ ] Every number on every slide has N, dataset and hardware behind it.
- [ ] Competitors are named on the references slide.
- [ ] Every member can explain their own module.
- [ ] The failure case is prepared and rehearsed.
- [ ] The one-sentence frame is memorised by all six members.

---

## 17. WHAT LOSES

For reference, the recurring reasons teams do not advance:

- Weak grasp of the problem. The team jumps straight to technology.
- Over-engineering beyond what the team can finish.
- An unstable or incomplete prototype at demo time.
- A presentation that buries the product under architecture slides.
- No measurable impact story.
- The team cannot answer basic questions about its own assumptions.

Read this list again on the morning of the presentation.
