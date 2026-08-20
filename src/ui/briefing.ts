/**
 * Briefing Mode. The artifact the problem statement exists to produce.
 *
 * Takes:   the viewer, the graph and the current route.
 * Returns: a five-step, keyboard-driven sequence over data already held.
 * Assumes: no PDF. A commander in a corridor steps through this on a laptop.
 *          Every step is a camera move plus one short paragraph.
 */

import * as THREE from 'three';
import type { Viewer } from '../view3d/viewer';
import type { RoomGraph, Route } from '../analysis/graph';
import type { SiteDocument } from '../core/types';
import type { Grid } from '../core/grid';
import { routePath, etaSeconds, formatEta, BRIEFING_FLIGHT_MS } from './routePath';
import { DEFAULT_PROFILE, profile } from '../analysis/pace';

export interface BriefStep {
  title: string;
  body: string;
  run: () => void;
  /** True when this step is reporting a failure state, not a fact. Styled as a warning. */
  warn?: boolean;
}

export class Briefing {
  private steps: BriefStep[] = [];
  index = 0;
  active = false;

  constructor(
    private viewer: Viewer,
    private site: SiteDocument,
    public grids: Map<string, Grid>,
    public mpu: number,
    private el: {
      wrap: HTMLElement; step: HTMLElement; title: HTMLElement; body: HTMLElement;
    },
  ) {}

  build(gr: RoomGraph, route: Route | null, targetKey: string | null, bridgeKeys: Set<string>, critical: Set<string>): void {
    const V = this.viewer;
    const centre = new THREE.Vector3(10 * this.mpu, 1.5, 6 * this.mpu);
    const target = targetKey ? gr.nodes.get(targetKey) : null;
    const entry = gr.edges.find((e) => e.is_entry);
    const exit = gr.edges.find((e) => e.is_exit);
    const base = (id: string): number => this.site.storeys.find((s) => s.id === id)?.elevation_m ?? 0;

    const rp = routePath(gr, route, this.site, this.grids, this.mpu);
    const nDoors = route ? route.doors : 0;
    const adj = target ? gr.adj.get(target.key)!.map((a) => gr.nodes.get(a.to)!.name) : [];

    this.steps = [
      {
        title: 'The target in its surroundings',
        body:
          'Training Block B, two storeys, 240 m² footprint. Approach roads north and south, ' +
          'service road east. Neighbouring blocks are extruded from the offline area pack, so the ' +
          'team sees the building in its real block, not floating in space.',
        run: () => {
          V.setRoofVisible(true);
          for (const s of this.site.storeys) V.setStoreyVisible(s.id, true);
          V.flyTo(new THREE.Vector3(-42, 40, -46), centre, 1800);
        },
      },
      {
        title: 'Entry points',
        body:
          `${entry ? 'Main entry on the south face' : 'No entry marked'}` +
          `${exit ? ', secondary exit on the north face' : ''}. ` +
          'Entry and exit are recorded in the model, not drawn on a slide, so every downstream ' +
          'analysis uses the same two points the commander chose.',
        run: () => {
          V.setRoofVisible(false);
          for (const s of this.site.storeys) V.setStoreyVisible(s.id, s.index === 0);
          V.flyTo(new THREE.Vector3(10, 30, -22), centre, 1600);
        },
      },
      {
        title: 'Assigned route',
        body: !target
          ? 'No target selected.'
          : route
            ? `Entry to ${target.name}: ${nDoors} doors, ${rp.length_m.toFixed(0)} m, about ` +
              `${formatEta(etaSeconds(rp.traverse, DEFAULT_PROFILE))} at ` +
              `${profile(DEFAULT_PROFILE).label.toLowerCase()} pace. The route is the shortest ` +
              'path over the room graph, where rooms are nodes and doorways are edges.'
            : `NO ROUTE to ${target.name}. The room graph is disconnected between the entry and ` +
              'this space — no door or stair links them. Do not brief this path; verify the plan first.',
        warn: !!target && !route,
        run: () => {
          for (const s of this.site.storeys) V.setStoreyVisible(s.id, true);
          V.setRoofVisible(false);
          // Fixed and brisk: this is one beat in a rehearsed five-step sequence, and the
          // honest distance and time are in the body text above, not in the camera's clock.
          // Briefing keeps a raised, trailing camera on purpose — it is an establishing shot
          // for a room of people, not a walkthrough — but 1.4 m above the path, not 7.5 m
          // above the wall tops, and the trail is a leash the curve itself supplies.
          if (rp.points.length >= 2) V.followPath(rp.points, 1.4, BRIEFING_FLIGHT_MS, false, 5.0);
          else V.flyTo(new THREE.Vector3(10, 26, -18), centre, 1400);
        },
      },
      {
        title: 'Target room',
        body: target
          ? `${target.name}, ${(target.area_u2 * this.mpu * this.mpu).toFixed(1)} m². ` +
            `Adjacent: ${adj.join(', ') || 'none'}. ` +
            `${gr.adj.get(target.key)!.length === 1 ? 'One way in. There is no second exit.' : 'More than one way in.'}`
          : 'No target selected.',
        run: () => {
          if (!target) return;
          for (const s of this.site.storeys) V.setStoreyVisible(s.id, true);
          V.setRoofVisible(false);
          const p = new THREE.Vector3(target.centre_u[0] * this.mpu, base(target.storey_id), target.centre_u[1] * this.mpu);
          V.flyTo(new THREE.Vector3(p.x - 7, p.y + 9, p.z - 9), p, 1600);
        },
      },
      {
        title: 'Chokepoints, both storeys',
        body:
          `${bridgeKeys.size} critical doors (bridges: removing one splits the building into two ` +
          `parts) and ${critical.size} critical rooms (articulation points: rooms a force must hold). ` +
          'Hold the corridor and the stairwell and the building is cut in half.',
        run: () => {
          for (const s of this.site.storeys) V.setStoreyVisible(s.id, true);
          V.setRoofVisible(false);
          V.flyTo(new THREE.Vector3(10, 42, 5.9), new THREE.Vector3(10, 0, 5.9), 1600);
        },
      },
    ];
  }

  start(): void {
    this.active = true;
    this.index = 0;
    this.el.wrap.classList.add('on');
    this.show();
  }

  stop(): void {
    this.active = false;
    this.el.wrap.classList.remove('on');
  }

  next(): void { if (this.index < this.steps.length - 1) { this.index++; this.show(); } }
  prev(): void { if (this.index > 0) { this.index--; this.show(); } }

  private show(): void {
    const s = this.steps[this.index];
    if (!s) return;
    this.el.step.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.el.title.textContent = s.title;
    this.el.body.textContent = s.body;
    this.el.body.classList.toggle('b-warn', !!s.warn);
    s.run();
  }
}
