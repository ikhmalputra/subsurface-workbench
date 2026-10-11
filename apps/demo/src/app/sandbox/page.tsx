import type { Metadata } from "next";
import { DemoHeader, DemoPage } from "../../components/showcase";
import { WebGpuSandbox } from "../../components/webgpu-sandbox";

export const metadata: Metadata = { title: "WebGPU sandbox · Subsurface SDK" };

export default function SandboxPage() {
  return <DemoPage current="/sandbox/">
    <DemoHeader eyebrow="Capability · experimental native WebGPU" title="WebGPU seismic sandbox"
      lede="Generate a small seismic cube entirely offline, raymarch it with a native WebGPU backend, or sample it on a freely oriented plane. WebGPU is opt-in; unsupported hardware reports an error instead of silently falling back. The existing View well page remains WebGL."
      points={["Synthetic voxel data remains in browser memory", "WGSL shaders generated from typed Three TSL nodes", "Plane and camera state are linked through the core store"]}
      uses={["WebGpuSeismicCanvas", "createMockSeismicCube", "createSubsurfaceStore"]}
      code={'import { WebGpuSeismicCanvas } from "@ikhmalputra/subsurface-react/webgpu";\nimport { createMockSeismicCube } from "@ikhmalputra/subsurface-core/sandbox";\n<WebGpuSeismicCanvas cube={cube} store={store} amplitudeLimit={1} threshold={0.4} opacity={0.2} onError={reportError} />'} />
    <WebGpuSandbox />
  </DemoPage>;
}
