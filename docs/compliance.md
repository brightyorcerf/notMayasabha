# SIH1773: COMPLIANCE AUDIT

This is a requirements check, not a design document. 

---

## 1. CLAUSE-BY-CLAUSE

| PS clause | What it asks for | Our design element | Status |
|---|---|---|---|
| ¶1 | 3D walkthrough for understanding the target layout | First-person walkthrough | **COVERED** |
| ¶1 | "effective briefing of the troops by the Commander" | Briefing layer (entries, markers, routes) | **PARTIAL** — the briefing *artifact* was deferred. See G1 |
| ¶1 | "appreciating the potent threat" | Bridge / articulation / route analysers | **COVERED** — and this clause is the hook that makes the analysers *compliance*, not just differentiation |
| ¶3 | Take the 2D blueprint as input | Raster + DXF ingest | **COVERED** |
| ¶3 | Input length, breadth, height | Manual parameter panel (patch item 13) | **COVERED** |
| ¶3 | Input **layout of staircase** | Stair objects exist; no explicit input path | **GAP** — see G2 |
| ¶3 | Input entry and exit | `SET_ENTRY`, briefing entry/exit points | **COVERED** |
| ¶3 | "export them to a file" | `.sitepkg` (encrypted) + GLB | **COVERED** — but must be *named* as the export step in the demo |
| ¶3 | Full-fledged 3D walkthrough model | Geometry generator + walkthrough | **COVERED** |
| ¶3 / ¶6(d) | Integration of the exported model with offline maps and satellite imagery | Georeference + basemap underlay | **PARTIAL** — see G3 |
| ¶4 | Fully standalone, zero internet after install | Kill-switch + import lint + area pack | **STRONG** |
| ¶4 | Install-time internet to fetch maps and imagery **"from open source"** | Install-time asset layer | **STRONG** — see §3 |
| ¶5 | "reduce the time taken during the initial briefing" | Correction-time metrics only | **GAP** — see G4 |
| ¶6(a) | Blueprint in, 3D walkthrough out | Full pipeline | **COVERED** |
| ¶6(b) | Provisions to input parameters | Parameter panel | **COVERED** |
| ¶6(c) | Minimum supervision to finalise the conversion | Triage queue, bulk accept, measured-supervision framing | **COVERED** — conditional on writing the paragraph |
| ¶6(d) | Enhanced output "covering the nearby geographical areas as well" | Not built | **GAP** — see G3 |

---

## 2. THE FOUR GAPS

### G1 — The briefing artifact was deferred. Put it back, in a cheaper form.

¶1 and ¶5 both name **briefing** as the purpose of the whole system. The v2.1 deferred list
dropped PDF export. That removes the artifact the problem statement exists to produce.

**Do not build the PDF.** Build **Briefing Mode** instead: a full-screen, keyboard-driven
sequence the commander steps through.

```
[1] Exterior — target in its surroundings, approach directions
[2] Entry points — each marked, each with an assigned team
[3] Route — camera flies the assigned route to the target room
[4] Target room — sightlines, adjacent rooms, second exit
[5] Storey overview — doll-house view, chokepoints highlighted
```

Cheaper than PDF generation, and far better on stage. It is a camera path over data you
already hold. Roughly half a day.

### G2 — "Layout of staircase" is a named input parameter and has no input path

¶3 lists it beside length, breadth and height. Our stairs come from CV detection or manual
placement, which is not the same thing as an *input provision*.

**Fix:** the parameter panel gets a stair block — count, position (click on the plan),
direction, width, connects-from-storey, connects-to-storey. Also un-defer basic stair
geometry: a stepped solid from tread and riser is about 30 lines. A coloured prism where the
problem statement explicitly names staircases is a visible miss.

### G3 — "Nearby geographical areas" is not a footprint on a map

Read ¶6(d) literally: offline maps and satellite imagery, to get enhanced output
**covering the nearby geographical areas as well.** That is not "place the building on a
tile." It is surroundings.

**Fix, and it is cheap because the data is already in the area pack:** extrude the
neighbouring OpenStreetMap building footprints around the target at a nominal height
(OSM often carries `building:levels`; default to three storeys where absent). Add roads as
flat ribbons.

Cost: a few hours, because you already ship OSM vector data offline.
Effect: the target building sits inside its real urban block, with approach roads and
adjacent rooftops. It converts a floating model into a tactical scene, and it satisfies the
literal text of a lettered requirement. This is the highest value-per-hour item on the list.

### G4 — ¶5 states a measurable benefit and we do not measure it

"This software would also reduce the time taken during the initial briefing of the troops."
Our metrics measure *correction* effort. Nothing measures *briefing* time, which is the
benefit the problem statement claims.

**Fix — a cheap, honest study you can run in one evening:**

Take one floor plan. Recruit 10 people who have not seen it. Split into two groups.
Ask each person five spatial questions:

- How many rooms open onto the main corridor?
- Which room has only one way in?
- From the east entry, how many doors to reach room X?
- Which room is directly above room Y?
- Where would you post one person to cover the most rooms?

Group A gets the paper 2D plan. Group B gets the 3D walkthrough.
Record time-to-answer and correctness for each group.

State N, state the population, state that these are students and not NSG operators. Then
report the difference. **That is a real impact number**, it is honest, it is defensible, and
it addresses the impact rubric line, which is worth as much as technical execution in a
typical internal round.

Nobody else in your college will bring a measured impact study. Most teams assert impact.

---

## 3. THE WORDING THAT DE-RISKS THE GOOGLE MAPS ARGUMENT

¶3 and ¶6(d) say "Google maps." ¶4 says the system may connect at install time to fetch
"Maps, satellite imagery **from open source**."

The problem statement itself anticipates open-source sourcing. So the OpenStreetMap and
Sentinel-2 substitution is not a deviation from the requirement — it is compliance with the
requirement's own wording, and the Google Maps terms of service explain why the alternative
reading is not deliverable.

State it in that order on the slide:

1. ¶4 permits open-source map and imagery sources at install time.
2. Google Maps Platform prohibits pre-fetching, caching and offline use of its content.
3. Therefore the offline pack uses OpenStreetMap (ODbL) and Sentinel-2 (Copernicus).
   NRSC/Bhuvan is available subject to its own terms, verified per deployment.

Point 1 first. It turns the argument from "we could not do what you asked" into "we did what
¶4 told us to do, and here is why ¶6(d) cannot be read literally."

---

## 4. WHAT WE BUILT THAT THE PS DOES NOT ASK FOR

Know the difference. Compliance work outranks these when time runs short.

| Element | Required? | Keep? |
|---|---|---|
| `UNSCALED` state with export blocked | No | **Yes.** Cheap, and it is the strongest trust story |
| Confidence and provenance on every element | No | **Yes.** It is how ¶6(c) becomes measurable |
| Op log and audit trail | No | **Yes.** It produces the ¶6(c) metric at no extra cost |
| `DRAFT → REVIEWED → LOCKED` gate | No | Yes — but it is our safety argument, not a requirement |
| Tamper-evidence hash chain | No | Cut first if time runs short |
| Bridge / articulation analysers | Indirectly, via ¶1 "appreciating the potent threat" | **Yes**, but cut to two if needed |
| 2D ↔ 3D linked selection | No | **Yes.** It is the cheapest proof of the architecture |

---

## 5. REVISED DEFERRED LIST

**Un-deferred** (each is required by a clause):
- Briefing Mode, in place of PDF export — ¶1, ¶5
- Basic parametric stair geometry — ¶3
- Neighbourhood extrusion from OSM footprints — ¶6(d)
- Stair input block in the parameter panel — ¶3

**Still deferred:**
OCR scale ladder · manual-bbox ladder · PDF export · five of eight analysers · live metrics
dashboard · automatic multi-storey registration · IFC · sectors, occupancy, load-bearing,
material · tamper-evidence chain if the schedule slips.

**Net effect:** about one day of work added, all of it directly against lettered
requirements, and one evening for the impact study.

---

## 6. THE HONEST SCOPE STATEMENT FOR THE DECK

¶1 mentions buildings, built-up areas, metro stations and schools. Our system handles **one
building, up to two storeys, with manual storey alignment**. Say this plainly on the
feasibility slide, alongside what makes it extend: a campus is a set of buildings sharing one
georeferenced frame, and the data model already supports that.

A stated, scoped limitation reads as engineering judgement. A limitation a judge discovers
reads as a gap.
