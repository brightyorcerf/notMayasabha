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

const MIX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    bloomTexture: { value: null as THREE.Texture | null },
    strength: { value: 1.0 },
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
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 glow = texture2D(bloomTexture, vUv);
      gl_FragColor = vec4(base.rgb + glow.rgb * strength, base.a);
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
  root.traverse((o) => o.layers.enable(GLOW_LAYER));
}
