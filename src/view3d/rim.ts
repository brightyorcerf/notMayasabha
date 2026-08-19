/**
 * Fresnel rim light. A cool edge term so wall silhouettes separate from the dark ground.
 *
 * Takes:   a MeshStandardMaterial and a rim colour, strength and falloff power.
 * Returns: nothing. It patches the material's shader in place, once.
 * Assumes: the material is MeshStandardMaterial, whose fragment shader declares
 *          `vViewPosition` and defines `normal` before the tone-mapping include. The
 *          rim is added before tone mapping and fog so it is graded like real light,
 *          not painted on top of the finished pixel.
 */

import * as THREE from 'three';

interface RimUniforms {
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
  uRimPower: { value: number };
}

const PATCHED = Symbol('rim-patched');

type Patchable = THREE.MeshStandardMaterial & {
  [PATCHED]?: RimUniforms;
};

/**
 * Add a rim term to `mat`. Calling it twice on the same material updates the existing
 * uniforms rather than compiling a second copy of the patch into the shader.
 */
export function applyRim(
  mat: THREE.MeshStandardMaterial,
  colour: number,
  strength: number,
  power: number,
): void {
  const m = mat as Patchable;
  const existing = m[PATCHED];
  if (existing) {
    existing.uRimColor.value.setHex(colour);
    existing.uRimStrength.value = strength;
    existing.uRimPower.value = power;
    return;
  }

  const uniforms: RimUniforms = {
    uRimColor: { value: new THREE.Color(colour) },
    uRimStrength: { value: strength },
    uRimPower: { value: power },
  };
  m[PATCHED] = uniforms;

  mat.onBeforeCompile = (shader): void => {
    shader.uniforms.uRimColor = uniforms.uRimColor;
    shader.uniforms.uRimStrength = uniforms.uRimStrength;
    shader.uniforms.uRimPower = uniforms.uRimPower;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#define STANDARD',
        `#define STANDARD
         uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        `{
           float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
           float rim = pow(1.0 - facing, uRimPower) * uRimStrength;
           gl_FragColor.rgb += uRimColor * rim;
         }
         #include <tonemapping_fragment>`,
      );
  };

  // Programs are cached by shader source, and every rim material shares that source.
  // The key keeps rim and non-rim variants of the same base material apart.
  mat.customProgramCacheKey = (): string => 'rim';
  mat.needsUpdate = true;
}

/** Patch every wall material under `root`. Wall materials are shared across storeys. */
export function applyWallRim(
  root: THREE.Object3D,
  colour: number,
  strength: number,
  power: number,
): number {
  const seen = new Set<THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    if (o.userData?.kind !== 'walls') return;
    const mat = (o as THREE.Mesh).material;
    if (mat instanceof THREE.MeshStandardMaterial) seen.add(mat);
  });
  for (const m of seen) applyRim(m, colour, strength, power);
  return seen.size;
}
