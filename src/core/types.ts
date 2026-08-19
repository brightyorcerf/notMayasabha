/**
 * The site schema. This file is the contract.
 *
 * Takes:   nothing. It declares types only.
 * Returns: nothing.
 * Assumes: XY is in document units (suffix `_u`). Z is in metres (suffix `_m`).
 *          The ONLY bridge between the two is ScaleRecord.meters_per_unit.
 *
 * Grep invariant: an `_m` field is a Z-axis or a user-parameter field. Nothing else.
 *
 * Lineage: ARCHITECTURE-v2 §2, with the five freeze-patch corrections applied —
 *   thickness_u not thickness_m (patch 1), anchor+offset_u not t_center (patch 2),
 *   seed_point_u not boundary_nodes (patch 3), one meters_per_unit per document
 *   (patch 5, invariant I6), prev_hash not Op.inverse (patch 10).
 */

export type UUID = string;
export type ISO = string;

export type Origin = 'CV' | 'VECTOR' | 'HUMAN';
export type DimensionSource = 'USER' | 'OCR' | 'VECTOR' | 'DEFAULT';

// ---------------------------------------------------------------- scale

export type ScaleState = 'UNSCALED' | 'PROVISIONAL' | 'VALIDATED';
export type ScaleMethod =
  | 'VECTOR_UNITS' | 'CALIBRATION_SEGMENT' | 'MANUAL_BBOX' | 'OCR_DIMENSION' | null;

export type CheckName =
  | 'DOOR_WIDTH' | 'WALL_THICKNESS' | 'CORRIDOR_WIDTH' | 'BBOX_VS_MANUAL' | 'ROOM_AREA';

export interface ScaleCheck {
  name: CheckName;
  measured: number;
  expected_lo: number;
  expected_hi: number;
  result: 'PASS' | 'WARN' | 'FAIL';
  note: string;
}

export interface ScaleEvidence {
  text: string;
  unit: string;
  measured_u: number;
  mpu: number;
}

export interface ScaleRecord {
  state: ScaleState;
  /** null if and only if state is UNSCALED. No default is ever substituted. */
  meters_per_unit: number | null;
  method: ScaleMethod;
  calibration: { p0: [number, number]; p1: [number, number]; real_length_m: number } | null;
  checks: ScaleCheck[];
  evidence: ScaleEvidence[];
  dispersion: number;
  confidence: number;
  set_by: 'SYSTEM' | 'USER';
  set_at: ISO;
}

// ---------------------------------------------------------------- graph

export interface Node {
  id: UUID;
  x_u: number;
  y_u: number;
}

export type WallClass = 'EXTERIOR' | 'INTERIOR' | 'PARTITION' | 'GLAZED' | 'SHAFT';

export interface Wall {
  id: UUID;
  a: UUID;
  b: UUID;
  thickness_u: number;
  height_m: number;
  base_offset_m: number;
  height_source: DimensionSource;
  wall_class: WallClass;
  /** Breach assessment is always a human judgement. We infer nothing structural. */
  breachable: boolean;
  breach_note: string;
  breach_origin: 'HUMAN' | null;
  confidence: number;
  origin: Origin;
  verified: boolean;
}

export type OpeningKind =
  | 'DOOR' | 'DOUBLE_DOOR' | 'WINDOW' | 'ARCH' | 'SHUTTER' | 'BREACH_POINT';
export type Swing = 'IN' | 'OUT' | 'BOTH' | 'SLIDING' | 'NONE';

export interface Opening {
  id: UUID;
  wall_id: UUID;
  /** Which node the offset is measured from. Never a normalised t: see freeze patch 2. */
  anchor: 'FROM_A' | 'FROM_B';
  offset_u: number;
  width_u: number;
  sill_m: number;
  head_m: number;
  kind: OpeningKind;
  swing: Swing;
  is_entry: boolean;
  is_exit: boolean;
  confidence: number;
  origin: Origin;
  verified: boolean;
}

/** v2 §2.2, extended with SERVER and STORE. Extensions are declared, not silent. */
export type RoomUse =
  | 'CORRIDOR' | 'HALL' | 'OFFICE' | 'CLASSROOM' | 'TOILET' | 'PLANT'
  | 'STAIRWELL' | 'PLATFORM' | 'UNKNOWN' | 'SERVER' | 'STORE';

/** Identity only. The polygon and the area are derived, never stored (freeze patch 3). */
export interface Room {
  id: UUID;
  seed_point_u: [number, number];
  name: string;
  use: RoomUse;
  confidence: number;
  origin: Origin;
  verified: boolean;
}

export type StairKind = 'STRAIGHT' | 'DOGLEG' | 'U_TURN' | 'SPIRAL' | 'ESCALATOR';

export interface Stair {
  id: UUID;
  kind: StairKind;
  footprint_u: Array<[number, number]>;
  up_direction_u: [number, number];
  from_storey: UUID;
  to_storey: UUID;
  from_room: UUID;
  to_room: UUID;
  width_u: number;
  tread_m: number;
  riser_m: number;
  step_count: number;
  confidence: number;
  origin: Origin;
  verified: boolean;
}

export type StoreyStatus = 'DRAFT' | 'REVIEWED' | 'LOCKED';

export interface Storey {
  id: UUID;
  index: number;
  name: string;
  source: { kind: 'RASTER' | 'VECTOR' | 'MANUAL'; rel_path: string; sha256: string };
  /** Placement into the building frame. No scale term: invariant I6. */
  transform: { tx_u: number; ty_u: number; rot_deg: number };
  elevation_m: number;
  floor_to_floor_m: number;
  nodes: Node[];
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  status: StoreyStatus;
}

// ---------------------------------------------------------------- briefing

export type MarkerKind = 'THREAT' | 'HOSTAGE' | 'IED_SUSPECT' | 'COVER' | 'CAMERA' | 'OBSTACLE';

export interface Marker {
  id: UUID;
  storey_id: UUID;
  x_u: number;
  y_u: number;
  z_m: number;
  kind: MarkerKind;
  label: string;
  notes: string;
}

export interface BriefingRoute {
  id: UUID;
  name: string;
  team: string;
  color: string;
  from_key: string;
  to_key: string;
  legs: Array<{ storey_id: UUID; points_u: Array<[number, number]> }>;
}

export interface Briefing {
  entry_points: Array<{ opening_id: UUID; label: string; assigned_team: string }>;
  exit_points: Array<{ opening_id: UUID; label: string }>;
  routes: BriefingRoute[];
  markers: Marker[];
}

// ---------------------------------------------------------------- document

export interface Defaults {
  wall_height_m: number;
  ext_wall_thickness_u: number;
  int_wall_thickness_u: number;
  door_height_m: number;
  window_sill_m: number;
  window_head_m: number;
}

/** Requirement ¶3 supplies these by hand. They are visible in the UI and named in the demo. */
export interface ManualParameters {
  length_u: number;
  breadth_u: number;
  storey_height_m: number;
  stair_count: number;
  source: DimensionSource;
}

export interface DocProvenance {
  created_by: string;
  tool: string;
  tool_version: string;
  source_files: Array<{ rel_path: string; sha256: string; kind: string }>;
}

export type DocStatus = 'DRAFT' | 'REVIEWED' | 'LOCKED' | 'TAMPERED';

export interface SiteDocument {
  schema_version: string;
  doc_id: UUID;
  created_utc: ISO;
  modified_utc: ISO;
  status: DocStatus;

  building: {
    name: string;
    site_type: 'METRO' | 'SCHOOL' | 'GOVT' | 'RESIDENTIAL' | 'OTHER';
    notes: string;
  };

  georef: {
    mode: 'NONE' | 'ANCHORED';
    origin_lat: number | null;
    origin_lon: number | null;
    heading_deg: number;
  };

  defaults: Defaults;
  manual_parameters: ManualParameters;
  /** One record for the whole document: invariant I6 (freeze patch 5). */
  scale: ScaleRecord;

  storeys: Storey[];
  stairs: Stair[];
  briefing: Briefing;
  provenance: DocProvenance;
}

// ---------------------------------------------------------------- area pack

export interface Neighbour {
  id: string;
  kind: 'BUILDING' | 'ROAD';
  outline_m: Array<[number, number]>;
  levels: number;
  width_m: number;
  name: string;
}

export interface Neighbourhood {
  source: string;
  licence: string;
  origin_lat: number;
  origin_lon: number;
  items: Neighbour[];
}
