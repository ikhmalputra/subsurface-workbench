import type * as THREE from "three";
import { RenderPipeline } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { builtinAOContext, mrt, normalView, pass, screenUV } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";

/**
 * Ground-truth ambient occlusion for a scene drawn by three's WebGPU renderer: a depth-and-normal
 * pre-pass feeds GTAO, and the result darkens the scene's own ambient and environment light where
 * surfaces crowd each other — the inside of a casing, the step of a shoe, the gap between strings.
 * It is the shading a Blender bake would give, computed live, so it follows edits and exploded
 * views instead of being frozen into the models.
 *
 * It needs no extra setup on WebGL 2: the renderer's fallback backend runs the same nodes.
 */
export class AmbientOcclusion {
  private readonly pipeline: RenderPipeline;

  constructor(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, { radius = 0.6, strength = 1, resolutionScale = 0.6 }: { readonly radius?: number; readonly strength?: number; readonly resolutionScale?: number } = {}) {
    this.pipeline = new RenderPipeline(renderer);
    // GTAO reads depth with textureGather, which a multisampled depth texture does not allow: the
    // pre-pass is single-sampled even when the canvas is antialiased.
    const prePass = pass(scene, camera, { samples: 0 });
    prePass.setMRT(mrt({ output: normalView }));
    const occlusion = ao(prePass.getTextureNode("depth"), prePass.getTextureNode(), camera);
    occlusion.radius.value = radius;
    occlusion.scale.value = strength;
    occlusion.resolutionScale = resolutionScale;
    const scenePass = pass(scene, camera);
    scenePass.contextNode = builtinAOContext(occlusion.getTextureNode().sample(screenUV).r);
    this.pipeline.outputNode = scenePass;
  }

  /** Draw the scene with occlusion to the canvas, in place of `renderer.render(scene, camera)`. */
  render() {
    this.pipeline.render();
  }

  dispose() {
    this.pipeline.dispose();
  }
}
