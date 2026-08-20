/**
 * Billboard text chips. The dark pill labels that name things in the 3D view.
 *
 * Takes:   a string, a tint, and the plan scale in metres per document unit.
 * Returns: a THREE.Sprite carrying its own canvas texture, plus a disposer.
 * Assumes: labels live inside the viewer's world group, which is scaled
 *          (mpu, 1, mpu). A sprite's world scale is the product of that and its own,
 *          so the X term is divided by mpu to keep the chip square under recalibration.
 *          Labels are excluded from the bloom layer: bloom on glyphs is a smear.
 */

import * as THREE from 'three';

/** Height of a chip in document units. Sized against a ~40 u building. */
const CHIP_H_U = 1.15;
/** Canvas pixels per chip; higher than needed on purpose, so zoom stays crisp. */
const PX_H = 64;
const FONT_STACK = '"Avenir Next", "Segoe UI", system-ui, sans-serif';

/**
 * Objects flagged this way are skipped by markGlow. Text must not bloom, and the
 * viewer re-marks the whole overlay tree every frame, so the opt-out has to live on
 * the object rather than be applied once at construction.
 */
export const NO_GLOW = 'noGlow';

export interface Label {
  sprite: THREE.Sprite;
  dispose(): void;
}

/** Rounded-rect path. Canvas2D roundRect is not in every target we support. */
function roundRect(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Draw `text` into a dark chip tinted `colour`, as a sprite `CHIP_H_U` tall.
 * The caller owns the result and must call `dispose()` before dropping it: a sprite
 * removed from the graph still holds a canvas texture until it is told otherwise.
 */
export function makeLabel(text: string, colour: number, mpu: number): Label {
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const label = text.toUpperCase();

  // Measure on a scratch context before sizing the real one.
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('labels: 2D canvas context unavailable');
  const fontPx = Math.round(PX_H * 0.44);
  const font = `600 ${fontPx}px ${FONT_STACK}`;
  probe.font = font;
  const padX = Math.round(fontPx * 0.62);
  const textW = probe.measureText(label).width;
  const wPx = Math.ceil(textW + padX * 2);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPx * dpr);
  canvas.height = Math.ceil(PX_H * dpr);
  const c = canvas.getContext('2d');
  if (!c) throw new Error('labels: 2D canvas context unavailable');
  c.scale(dpr, dpr);

  const tint = new THREE.Color(colour);
  const border = `rgba(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)}, 0.85)`;
  const inset = 2;
  const h = PX_H - inset * 2;

  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  roundRect(c, inset, inset, wPx - inset * 2, h, h / 2);
  c.fillStyle = 'rgba(9, 13, 20, 0.86)';
  c.fill();
  c.lineWidth = 1.5;
  c.strokeStyle = border;
  c.stroke();

  // The tint carries the meaning; near-white keeps the glyphs readable at distance.
  c.fillStyle = '#eef3fa';
  c.fillText(label, wPx / 2, PX_H / 2 + 1);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;

  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 20;
  sprite.userData[NO_GLOW] = true;

  const safeMpu = mpu > 1e-6 ? mpu : 1;
  sprite.scale.set((CHIP_H_U * (wPx / PX_H)) / safeMpu, CHIP_H_U, 1);

  return {
    sprite,
    dispose(): void {
      tex.dispose();
      mat.dispose();
    },
  };
}
