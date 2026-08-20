/**
 * Post-processing: contact shading on the building, restrained bloom on the HUD.
 *
 * Takes:   the renderer, scene and camera the Viewer already owns.
 * Returns: a composer the Viewer renders through instead of renderer.render().
 * Assumes: only objects on GLOW_LAYER bloom, so a sunlit wall can never smear; tone
 *          mapping is applied exactly once, by OutputPass, because RenderPass writes
 *          linear HDR into a target and three disables in-material tone mapping there.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { NO_GLOW } from './labels';

/**
 * Objects on this layer bloom. The bloom camera renders this layer alone, so bloom is
 * selective by construction rather than by a luminance threshold we would have to
 * re-tune every time a light changes.
 */
export const GLOW_LAYER = 1;

/**
 * `minDistance` is a self-occlusion BIAS in normalised depth, not a metric distance.
 * Shrinking it to a "correct" metric value makes every depth sample read as an
 * occluder, occlusion saturates at 1.0 and the scene multiplies to black. These are
 * three's own defaults; only the radius is scene-scaled. Do not re-derive them.
 */
const AO_MIN_DISTANCE = 0.005;
const AO_MAX_DISTANCE = 0.1;
/** Occlusion radius in world metres. Contact shading on a ~25 m building. */
const AO_RADIUS = 1.0;

/** Vignette darkening at the frame edge, 0..1. Folded into MIX_SHADER: it is the
 *  last thing drawn before OutputPass, so adding it here costs no extra pass. */
const VIGNETTE_STRENGTH = 0.38;

const MIX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    bloomTexture: { value: null as THREE.Texture | null },
    strength: { value: 1.0 },
    vignette: { value: VIGNETTE_STRENGTH },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D bloomTexture;
    uniform float strength;
    uniform float vignette;
    varying vec2 vUv;

    // Interleaved gradient noise (Jimenez 2014). One dot product, no texture lookup —
    // cheap enough to run on every pixel, every frame.
    float dither(vec2 co) {
      return fract(52.9829189 * fract(dot(co, vec2(0.06711056, 0.00583715))));
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 glow = texture2D(bloomTexture, vUv);
      vec3 lit = base.rgb + glow.rgb * strength;
      float d = length(vUv - 0.5);
      float shade = 1.0 - vignette * smoothstep(0.35, 0.85, d);
      // Break up 8-bit banding on the large, near-flat floors the new environment
      // reflection and vignette both grade smoothly across — a wide, faintly lit
      // room-tinted floor is exactly the surface a subtle gradient bands visibly on,
      // and how visible it is depends on that room's own colour, hence "some rooms
      // more than others." One LSB of noise is imperceptible as noise but erases the
      // step edges between adjacent colour bands.
      float noise = (dither(gl_FragCoord.xy) - 0.5) / 255.0;
      gl_FragColor = vec4(lit * shade + noise, base.a);
    }
  `,
};

export class PostFX {
  private bloomComposer: EffectComposer;
  private finalComposer: EffectComposer;
  private ssao: SSAOPass;
  private bloom: UnrealBloomPass;
  private mix: ShaderPass;
  /** Set false to fall back to a plain forward render. The demo escape hatch. */
  enabled = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.bloomComposer = new EffectComposer(renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.70, 0.5, 0.0);
    this.bloomComposer.addPass(this.bloom);

    this.finalComposer = new EffectComposer(renderer);
    this.finalComposer.addPass(new RenderPass(scene, camera));

    this.ssao = new SSAOPass(scene, camera, width, height);
    this.ssao.output = SSAOPass.OUTPUT.Default;
    this.ssao.kernelRadius = AO_RADIUS;
    this.ssao.minDistance = AO_MIN_DISTANCE;
    this.ssao.maxDistance = AO_MAX_DISTANCE;
    // Off by default. The camera runs near = 0.05 with far = 500, and at that depth
    // ratio SSAO bands badly across the ground plane at grazing angles. The sun
    // already casts real shadows, so this pass buys little and can cost the demo.
    this.ssao.enabled = false;
    this.finalComposer.addPass(this.ssao);

    this.mix = new ShaderPass(MIX_SHADER, 'tDiffuse');
    this.mix.uniforms.bloomTexture.value = this.bloomComposer.renderTarget2.texture;
    this.finalComposer.addPass(this.mix);

    this.finalComposer.addPass(new OutputPass());
    this.setSize(width, height);
  }

  /** Turn ambient occlusion on or off. The auto-degrade path drops this pass first. */
  setAO(on: boolean): void {
    this.ssao.enabled = on;
  }

  get aoOn(): boolean { return this.ssao.enabled; }

  setBloom(on: boolean): void {
    this.mix.enabled = on;
  }

  get bloomOn(): boolean { return this.mix.enabled; }

  setSize(width: number, height: number): void {
    const ratio = Math.min(devicePixelRatio, 2);
    for (const c of [this.bloomComposer, this.finalComposer]) {
      c.setPixelRatio(ratio);
      c.setSize(width, height);
    }
    this.ssao.setSize(width * ratio, height * ratio);
  }

  /**
   * Render the glow layer alone, on black, with no fog. Fog would tint the halo and
   * the background would bloom as a solid rectangle.
   */
  private renderGlow(): void {
    const mask = this.camera.layers.mask;
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.camera.layers.set(GLOW_LAYER);
    this.scene.background = null;
    this.scene.fog = null;
    this.bloomComposer.render();
    this.scene.fog = fog;
    this.scene.background = bg;
    this.camera.layers.mask = mask;
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.mix.enabled) this.renderGlow();
    this.finalComposer.render();
  }

  dispose(): void {
    this.bloomComposer.dispose();
    this.finalComposer.dispose();
  }
}

/** Mark an object and everything under it as a bloom emitter. */
export function markGlow(root: THREE.Object3D): void {
  root.traverse((o) => {
    // Text opts out: bloom turns glyphs into a smear, and a label a commander cannot
    // read is worse than no label. See view3d/labels.ts.
    if (o.userData[NO_GLOW]) o.layers.disable(GLOW_LAYER);
    else o.layers.enable(GLOW_LAYER);
  });
}
