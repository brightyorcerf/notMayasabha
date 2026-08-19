/**
 * The 2D plan. Same data as the 3D view, drawn from the same derived grid.
 *
 * Takes:   the session, the room graph and the analyser results.
 * Returns: a canvas view with click selection and a live walkthrough position.
 * Assumes: document units. The only screen transform is fit-to-bounds.
 *          Linked selection is the cheapest proof that 2D and 3D share one model.
 */

import type { Session } from '../core/session';
import type { RoomGraph, Route } from '../analysis/graph';
import { nodeKey } from '../analysis/graph';
import { roomRects, roomAt, nodeMap, wallSeg, openingCentre } from '../core/grid';
import { FLOOR_TINT } from '../geometry/build3d';
import { COL } from '../view3d/overlays';

export interface PlanSelection {
  kind: 'room' | 'door';
  storeyId: string;
  id: string;
}

const hex = (n: number, a = 1): string =>
  `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

export class Plan2D {
  private ctx: CanvasRenderingContext2D;
  private k = 1; private ox = 0; private oy = 0;
  /** User zoom on top of fit-to-bounds, and the pan it takes to keep the cursor anchored. */
  private zoomFactor = 1; private panX = 0; private panY = 0;
  storeyId: string;
  route: Route | null = null;
  bridgeKeys = new Set<string>();
  criticalRooms = new Set<string>();
  selection: PlanSelection | null = null;
  targetKey: string | null = null;
  player: { x: number; y: number; storeyId: string } | null = null;
  onSelect: ((s: PlanSelection) => void) | null = null;
  /** Two-click scale calibration. While true, clicks report points, not selections. */
  calibrating = false;
  onCalibrationPoint: ((x: number, y: number) => void) | null = null;
  private calPoints: Array<[number, number]> = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private s: Session,
    private gr: RoomGraph,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.storeyId = s.doc.storeys[0].id;
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', () => this.resetView());
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  /** Back to fit-to-bounds. Called on zoom reset and whenever the storey changes. */
  resetView(): void {
    this.zoomFactor = 1; this.panX = 0; this.panY = 0;
    this.draw();
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (this.canvas.width / r.width);
    const py = (e.clientY - r.top) * (this.canvas.height / r.height);
    const ux = this.ux(px), uy = this.uy(py);
    this.zoomFactor = Math.min(10, Math.max(1, this.zoomFactor * Math.exp(-e.deltaY * 0.001)));
    this.fit();
    // Re-anchor so the point under the cursor does not jump when the zoom changes.
    this.panX += px - this.sx(ux);
    this.panY += py - this.sy(uy);
    this.draw();
  }

  private fit(): void {
    const st = this.s.doc.storeys.find((s) => s.id === this.storeyId)!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of st.nodes) {
      minX = Math.min(minX, n.x_u); maxX = Math.max(maxX, n.x_u);
      minY = Math.min(minY, n.y_u); maxY = Math.max(maxY, n.y_u);
    }
    const pad = 1.2;
    const w = this.canvas.width, h = this.canvas.height;
    const baseK = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2));
    this.k = baseK * this.zoomFactor;
    this.ox = (w - (maxX - minX) * this.k) / 2 - minX * this.k + this.panX;
    this.oy = (h - (maxY - minY) * this.k) / 2 - minY * this.k + this.panY;
  }

  private sx(x: number): number { return x * this.k + this.ox; }
  private sy(y: number): number { return y * this.k + this.oy; }
  private ux(px: number): number { return (px - this.ox) / this.k; }
  private uy(py: number): number { return (py - this.oy) / this.k; }

  private click(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (this.canvas.width / r.width);
    const py = (e.clientY - r.top) * (this.canvas.height / r.height);
    const x = this.ux(px), y = this.uy(py);
    if (this.calibrating) {
      this.calPoints.push([x, y]);
      if (this.calPoints.length > 2) this.calPoints = [[x, y]];
      this.onCalibrationPoint?.(x, y);
      this.draw();
      return;
    }
    const st = this.s.doc.storeys.find((s) => s.id === this.storeyId)!;
    const g = this.s.derived.grids.get(this.storeyId)!;

    // Doors first: they are small and they are what a commander clicks.
    const N = nodeMap(st);
    const W = new Map(st.walls.map((w) => [w.id, w]));
    let bestId: string | null = null, bestD = 0.55;
    for (const o of st.openings) {
      if (o.sill_m > 0.05) continue;
      const w = W.get(o.wall_id);
      if (!w) continue;
      const [cx, cy] = openingCentre(o, w, N);
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestD) { bestD = d; bestId = o.id; }
    }
    if (bestId) {
      this.selection = { kind: 'door', storeyId: this.storeyId, id: bestId };
      this.onSelect?.(this.selection);
      this.draw();
      return;
    }
    const idx = roomAt(g, x, y);
    if (idx >= 0) {
      this.selection = { kind: 'room', storeyId: this.storeyId, id: st.rooms[idx].id };
      this.onSelect?.(this.selection);
      this.draw();
    }
  }

  draw(): void {
    const c = this.canvas;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.fit();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, c.width, c.height);

    const st = this.s.doc.storeys.find((s) => s.id === this.storeyId)!;
    const g = this.s.derived.grids.get(this.storeyId)!;

    // Room fills, from the same run-length rectangles the 3D floors use.
    st.rooms.forEach((r, i) => {
      const key = nodeKey(st.id, r.id);
      const crit = this.criticalRooms.has(key);
      ctx.fillStyle = hex(FLOOR_TINT[r.use] ?? 0x4a5568, crit ? 0.95 : 0.7);
      for (const rect of roomRects(g, i)) {
        ctx.fillRect(this.sx(rect.x), this.sy(rect.y), rect.w * this.k + 0.6, rect.h * this.k + 0.6);
      }
    });

    // Walls.
    const N = nodeMap(st);
    for (const wl of st.walls) {
      const s = wallSeg(wl, N);
      ctx.strokeStyle = wl.wall_class === 'EXTERIOR' ? '#d7dbe0' : '#9aa3ad';
      ctx.lineWidth = Math.max(1.5, wl.thickness_u * this.k);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(this.sx(s.ax), this.sy(s.ay));
      ctx.lineTo(this.sx(s.bx), this.sy(s.by));
      ctx.stroke();
    }

    // Openings: erase the wall, then mark the door.
    const W = new Map(st.walls.map((x) => [x.id, x]));
    for (const o of st.openings) {
      const wl = W.get(o.wall_id);
      if (!wl) continue;
      const s = wallSeg(wl, N);
      const L = Math.hypot(s.bx - s.ax, s.by - s.ay);
      const ux = (s.bx - s.ax) / L, uy = (s.by - s.ay) / L;
      const start = o.anchor === 'FROM_A' ? o.offset_u : L - o.offset_u - o.width_u;
      const p0 = [s.ax + ux * start, s.ay + uy * start];
      const p1 = [s.ax + ux * (start + o.width_u), s.ay + uy * (start + o.width_u)];
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = Math.max(2, wl.thickness_u * this.k) + 1;
      ctx.beginPath();
      ctx.moveTo(this.sx(p0[0]), this.sy(p0[1]));
      ctx.lineTo(this.sx(p1[0]), this.sy(p1[1]));
      ctx.stroke();
      if (o.sill_m > 0.05) {
        ctx.strokeStyle = '#5b6b7d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.sx(p0[0]), this.sy(p0[1]));
        ctx.lineTo(this.sx(p1[0]), this.sy(p1[1]));
        ctx.stroke();
        continue;
      }
      const e = this.gr.edges.find((x) => x.opening_id === o.id);
      let col: number = COL.door;
      if (e?.is_entry) col = COL.entry;
      else if (e?.is_exit) col = COL.exit;
      if (e && this.bridgeKeys.has(e.key)) col = COL.bridge;
      ctx.strokeStyle = hex(col);
      ctx.lineWidth = Math.max(3, wl.thickness_u * this.k * 1.2);
      ctx.beginPath();
      ctx.moveTo(this.sx(p0[0]), this.sy(p0[1]));
      ctx.lineTo(this.sx(p1[0]), this.sy(p1[1]));
      ctx.stroke();
    }

    // Stairs on this storey.
    for (const s of this.s.doc.stairs) {
      if (s.from_storey !== st.id && s.to_storey !== st.id) continue;
      const xs = s.footprint_u.map((p) => p[0]), ys = s.footprint_u.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      ctx.strokeStyle = 'rgba(200,190,240,0.8)';
      ctx.lineWidth = 1.5;
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        ctx.beginPath();
        ctx.moveTo(this.sx(x0), this.sy(y0 + (y1 - y0) * t));
        ctx.lineTo(this.sx(x1), this.sy(y0 + (y1 - y0) * t));
        ctx.stroke();
      }
    }

    // Route.
    if (this.route) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < this.route.nodes.length; i++) {
        const n = this.gr.nodes.get(this.route.nodes[i]);
        if (n && n.room_id && n.storey_id === st.id) pts.push(n.centre_u);
        const e = this.route.edges[i];
        if (e && e.storey_id === st.id) pts.push(e.point_u);
      }
      if (pts.length >= 2) {
        ctx.strokeStyle = hex(COL.route);
        ctx.lineWidth = 3.5;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(this.sx(pts[0][0]), this.sy(pts[0][1]));
        for (const p of pts.slice(1)) ctx.lineTo(this.sx(p[0]), this.sy(p[1]));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Briefing markers.
    for (const m of this.s.doc.briefing.markers) {
      if (m.storey_id !== st.id) continue;
      ctx.fillStyle = hex(COL.marker);
      ctx.beginPath();
      ctx.arc(this.sx(m.x_u), this.sy(m.y_u), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1117';
      ctx.font = 'bold 9px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(m.kind[0], this.sx(m.x_u), this.sy(m.y_u) + 3);
    }

    // Labels and areas.
    const mpu = this.s.derived.mpu;
    ctx.textAlign = 'center';
    st.rooms.forEach((r, i) => {
      const key = nodeKey(st.id, r.id);
      const n = this.gr.nodes.get(key);
      if (!n) return;
      const px = this.sx(n.centre_u[0]), py = this.sy(n.centre_u[1]);
      ctx.font = `600 ${Math.max(11, this.k * 0.36)}px ui-sans-serif, system-ui`;
      ctx.fillStyle = this.targetKey === key ? hex(COL.target) : '#e6edf3';
      ctx.fillText(r.name, px, py);
      ctx.font = `${Math.max(9, this.k * 0.26)}px ui-monospace, monospace`;
      ctx.fillStyle = this.s.derived.unscaled ? '#f1c40f' : '#8b949e';
      // Areas are refused, not defaulted, while the scale is unresolved.
      ctx.fillText(
        this.s.derived.unscaled ? 'AREA UNAVAILABLE' : `${(g.areas_u2[i] * mpu * mpu).toFixed(1)} m²`,
        px, py + Math.max(12, this.k * 0.42),
      );
      if (this.criticalRooms.has(key)) {
        ctx.fillStyle = hex(COL.critical);
        ctx.fillText('CRITICAL ROOM', px, py - Math.max(12, this.k * 0.42));
      }
    });

    // Selection.
    if (this.selection && this.selection.storeyId === st.id) {
      ctx.strokeStyle = hex(COL.select);
      ctx.lineWidth = 2.5;
      if (this.selection.kind === 'room') {
        const idx = st.rooms.findIndex((r) => r.id === this.selection!.id);
        if (idx >= 0) {
          const rects = roomRects(g, idx);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const r of rects) {
            x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
            x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
          }
          ctx.strokeRect(this.sx(x0), this.sy(y0), (x1 - x0) * this.k, (y1 - y0) * this.k);
        }
      } else {
        const o = st.openings.find((x) => x.id === this.selection!.id);
        const wl = o && W.get(o.wall_id);
        if (o && wl) {
          const [cx, cy] = openingCentre(o, wl, N);
          ctx.beginPath();
          ctx.arc(this.sx(cx), this.sy(cy), Math.max(8, this.k * 0.5), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Calibration segment.
    if (this.calPoints.length > 0) {
      ctx.strokeStyle = hex(COL.route);
      ctx.fillStyle = hex(COL.route);
      ctx.lineWidth = 2;
      for (const p of this.calPoints) {
        ctx.beginPath();
        ctx.arc(this.sx(p[0]), this.sy(p[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.calPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(this.sx(this.calPoints[0][0]), this.sy(this.calPoints[0][1]));
        ctx.lineTo(this.sx(this.calPoints[1][0]), this.sy(this.calPoints[1][1]));
        ctx.stroke();
      }
    }

    // Live walkthrough position.
    if (this.player && this.player.storeyId === st.id) {
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(this.sx(this.player.x), this.sy(this.player.y), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
