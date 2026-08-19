/**
 * The 3D view. Doll-house orbit and first-person walkthrough over the same scene.
 *
 * Takes:   a SiteDocument, its occupancy grids and its built meshes.
 * Returns: a viewer object the app drives. Nothing here reads the schema directly.
 * Assumes: eye height 1.6 m, body radius 0.28 m. Collision is sampled from the
 *          occupancy grid, not from mesh raycasts, so it cannot tunnel at speed.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { SiteMeshes } from '../geometry/build3d';
import type { Grid } from '../core/grid';
import type { SiteDocument, Stair } from '../core/types';

const EYE_M = 1.6;
const BODY_R = 0.28;
const WALK_MS = 3.1;
const RUN_MS = 6.0;

export type ViewMode = 'ORBIT' | 'WALK';

interface StoreyRT {
  id: string;
  elevation_m: number;
  level: number;
  grid: Grid;
}

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly overlay = new THREE.Group();
  mode: ViewMode = 'ORBIT';
  fps = 0;

  private orbit: OrbitControls;
  private lock: PointerLockControls;
  private keys = new Set<string>();
  private clock = new THREE.Clock();
  private storeysRT: StoreyRT[] = [];
  private currentBase = 0;
  /** Plan scale. Set it and the whole world rescales: no geometry is rebuilt. */
  private _mpu = 1;
  readonly world = new THREE.Group();
  private site: SiteDocument;
  private meshes: SiteMeshes;
  private frames = 0;
  private fpsAcc = 0;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; fromLook: THREE.Vector3; toLook: THREE.Vector3; t: number; dur: number } | null = null;
  private path: { curve: THREE.CatmullRomCurve3; t: number; dur: number; height: number } | null = null;
  private lookTarget = new THREE.Vector3();
  onRoomEnter: ((roomId: string | null) => void) | null = null;
  private lastRoom: string | null = null;

  constructor(
    private el: HTMLElement,
    doc: SiteDocument,
    grids: Map<string, Grid>,
    meshes: SiteMeshes,
    mpu: number,
  ) {
    this.site = doc;
    this.meshes = meshes;
    this._mpu = mpu;
    this.storeysRT = doc.storeys.map((st) => ({
      id: st.id, elevation_m: st.elevation_m, level: st.index, grid: grids.get(st.id)!,
    }));

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 60, 220);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);
    this.camera.position.set(-18, 22, -16);

    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x24211c, 1.15);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
    sun.position.set(28, 44, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 40;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 160;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(200, 100, 0x2b3440, 0x1f2630);
    grid.position.y = -0.05;
    this.scene.add(grid);

    // XY is in document units, Y is already in metres, so the plan scales and heights do not.
    this.world.add(meshes.root, this.overlay);
    this.world.scale.set(this._mpu, 1, this._mpu);
    this.scene.add(this.world);

    const c = meshes.bounds.getCenter(new THREE.Vector3());
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.copy(c);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.update();

    this.lock = new PointerLockControls(this.camera, this.renderer.domElement);
    this.scene.add(this.lock.getObject());

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.lock.addEventListener('unlock', () => { if (this.mode === 'WALK') this.keys.clear(); });

    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  get mpu(): number { return this._mpu; }

  set mpu(v: number) {
    this._mpu = v;
    this.world.scale.set(v, 1, v);
  }

  /** Refresh the runtime grids after a document change. */
  setGrids(doc: SiteDocument, grids: Map<string, Grid>): void {
    this.site = doc;
    this.storeysRT = doc.storeys.map((st) => ({
      id: st.id, elevation_m: st.elevation_m, level: st.index, grid: grids.get(st.id)!,
    }));
  }

  private resize(): void {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Enter the walkthrough at a world point, facing a direction. */
  enterWalk(x: number, z: number, yawTo?: THREE.Vector3): void {
    this.mode = 'WALK';
    this.fly = null;
    this.path = null;
    this.orbit.enabled = false;
    this.currentBase = this.baseNear(0);
    this.camera.position.set(x, this.currentBase + EYE_M, z);
    if (yawTo) this.camera.lookAt(yawTo.x, this.currentBase + EYE_M, yawTo.z);
    this.lock.lock();
  }

  enterOrbit(): void {
    this.mode = 'ORBIT';
    this.orbit.enabled = true;
    if (this.lock.isLocked) this.lock.unlock();
  }

  private baseNear(y: number): number {
    let best = this.storeysRT[0];
    for (const s of this.storeysRT) if (Math.abs(s.elevation_m - y) < Math.abs(best.elevation_m - y)) best = s;
    return best.elevation_m;
  }

  private storeyForBase(base: number): StoreyRT {
    let best = this.storeysRT[0];
    for (const s of this.storeysRT) if (Math.abs(s.elevation_m - base) < Math.abs(best.elevation_m - base)) best = s;
    return best;
  }

  /** Stair progress at a plan point, in document units. Null when off the stair. */
  private stairAt(xu: number, yu: number): { s: Stair; t: number } | null {
    for (const s of this.site.stairs) {
      const xs = s.footprint_u.map((p) => p[0]), ys = s.footprint_u.map((p) => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      if (xu < minX || xu > maxX || yu < minY || yu > maxY) continue;
      const vertical = Math.abs(s.up_direction_u[1]) > Math.abs(s.up_direction_u[0]);
      const dir = vertical ? Math.sign(s.up_direction_u[1]) : Math.sign(s.up_direction_u[0]);
      const lo = vertical ? (dir > 0 ? minY : maxY) : (dir > 0 ? minX : maxX);
      const hi = vertical ? (dir > 0 ? maxY : minY) : (dir > 0 ? maxX : minX);
      const cur = vertical ? yu : xu;
      const t = Math.max(0, Math.min(1, (cur - lo) / (hi - lo)));
      return { s, t };
    }
    return null;
  }

  private blocked(wx: number, wz: number, base: number): boolean {
    const st = this.storeyForBase(base);
    const g = st.grid;
    const xu = wx / this._mpu, yu = wz / this._mpu;
    const r = BODY_R / this._mpu;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = xu + Math.cos(ang) * r, py = yu + Math.sin(ang) * r;
      const i = Math.floor((px - g.x0) / g.cell), j = Math.floor((py - g.y0) / g.cell);
      if (i < 0 || i >= g.nx || j < 0 || j >= g.ny) return true;
      const k = j * g.nx + i;
      if (g.walkMask[k]) return true;
      // On an upper storey there is no floor outside the envelope.
      if (st.level > 0 && g.outsideMask[k] && !this.stairAt(px, py)) return true;
    }
    return false;
  }

  private walkStep(dt: number): void {
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? RUN_MS : WALK_MS) * dt;
    let fwd = 0, side = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) side += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) side -= 1;

    const pos = this.camera.position;
    if (fwd !== 0 || side !== 0) {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      dir.y = 0; dir.normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      const move = new THREE.Vector3()
        .addScaledVector(dir, fwd)
        .addScaledVector(right, side);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
      // Axis-separated resolution, so a wall slides instead of stopping you dead.
      if (!this.blocked(pos.x + move.x, pos.z, this.currentBase)) pos.x += move.x;
      if (!this.blocked(pos.x, pos.z + move.z, this.currentBase)) pos.z += move.z;
    }

    const st = this.stairAt(pos.x / this._mpu, pos.z / this._mpu);
    if (st) {
      const from = this.site.storeys.find((s) => s.id === st.s.from_storey)!;
      const to = this.site.storeys.find((s) => s.id === st.s.to_storey)!;
      const y = from.elevation_m + (to.elevation_m - from.elevation_m) * st.t;
      pos.y = y + EYE_M;
      this.currentBase = st.t > 0.5 ? to.elevation_m : from.elevation_m;
    } else {
      pos.y += (this.currentBase + EYE_M - pos.y) * Math.min(1, dt * 12);
    }

    if (this.onRoomEnter) {
      const g = this.storeyForBase(this.currentBase).grid;
      const stq = this.storeyForBase(this.currentBase);
      const sd = this.site.storeys.find((s) => s.id === stq.id)!;
      const i = Math.floor((pos.x / this._mpu - g.x0) / g.cell);
      const j = Math.floor((pos.z / this._mpu - g.y0) / g.cell);
      let rid: string | null = null;
      if (i >= 0 && i < g.nx && j >= 0 && j < g.ny) {
        const idx = g.roomOf[j * g.nx + i];
        rid = idx >= 0 ? sd.rooms[idx].id : null;
      }
      if (rid !== this.lastRoom) { this.lastRoom = rid; this.onRoomEnter(rid); }
    }
  }

  /** Cinematic move. Used by Briefing Mode only. */
  flyTo(pos: THREE.Vector3, look: THREE.Vector3, ms = 1600): void {
    this.enterOrbit();
    this.fly = {
      from: this.camera.position.clone(), to: pos.clone(),
      fromLook: this.orbit.target.clone(), toLook: look.clone(),
      t: 0, dur: ms / 1000,
    };
  }

  /** Tracking shot along a polyline. Briefing Mode stage 3. */
  followPath(points: THREE.Vector3[], height: number, ms: number): void {
    if (points.length < 2) return;
    this.enterOrbit();
    this.path = {
      curve: new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2),
      t: 0, dur: ms / 1000, height,
    };
    this.fly = null;
  }

  get busy(): boolean {
    return this.fly !== null || this.path !== null;
  }

  private tick(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.path) {
      this.path.t += dt;
      const k = Math.min(1, this.path.t / this.path.dur);
      const p = this.path.curve.getPointAt(k);
      const ahead = this.path.curve.getPointAt(Math.min(1, k + 0.06));
      const back = new THREE.Vector3().subVectors(p, ahead).setY(0).normalize().multiplyScalar(6.5);
      this.camera.position.set(p.x + back.x, p.y + this.path.height, p.z + back.z);
      this.orbit.target.copy(ahead);
      this.camera.lookAt(ahead);
      if (k >= 1) this.path = null;
    } else if (this.fly) {
      this.fly.t += dt;
      const k = Math.min(1, this.fly.t / this.fly.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.camera.position.lerpVectors(this.fly.from, this.fly.to, e);
      this.lookTarget.lerpVectors(this.fly.fromLook, this.fly.toLook, e);
      this.orbit.target.copy(this.lookTarget);
      this.camera.lookAt(this.lookTarget);
      if (k >= 1) this.fly = null;
    } else if (this.mode === 'WALK') {
      this.walkStep(dt);
    } else {
      this.orbit.update();
    }
    this.renderer.render(this.scene, this.camera);

    this.frames++; this.fpsAcc += dt;
    if (this.fpsAcc >= 0.5) { this.fps = this.frames / this.fpsAcc; this.frames = 0; this.fpsAcc = 0; }
  }

  setStoreyVisible(id: string, on: boolean): void {
    const s = this.meshes.storeys.get(id);
    if (s) s.group.visible = on;
  }

  setRoofVisible(on: boolean): void {
    for (const s of this.meshes.storeys.values()) if (s.roof) s.roof.visible = on;
  }

  /** Raycast the pointer at the model. Returns the userData of the first hit. */
  pick(clientX: number, clientY: number): Record<string, unknown> | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.meshes.root, true);
    for (const h of hits) {
      const ud = h.object.userData;
      if (ud && ud.kind) return ud as Record<string, unknown>;
    }
    return null;
  }
}
