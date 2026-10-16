// Small self-contained 3D viewer for one asset (asset dialogs, mapping inspector).
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { fitScale, loadModel, type LoadedModel } from "./loadModel";
import type { Dims } from "../lib/types";

interface Props {
  urls: string[];
  /** When given, the model is scaled to these dims (meters) so the preview shows the real proportions. */
  dims?: Dims | null;
  height?: number | string;
  autoRotate?: boolean;
  background?: string;
}

function Model({ model, dims }: { model: LoadedModel; dims?: Dims | null }) {
  const object = useMemo(() => {
    const o = model.scene.clone(true);
    if (dims) o.scale.copy(fitScale(model.size, dims));
    else {
      const s = 1.5 / Math.max(model.size.x, model.size.y, model.size.z, 1e-6);
      o.scale.setScalar(s);
    }
    return o;
  }, [model, dims?.w, dims?.d, dims?.h]); // eslint-disable-line react-hooks/exhaustive-deps
  return <primitive object={object} />;
}

export default function ModelPreview({ urls, dims, height = 220, autoRotate = true, background }: Props) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = urls.join("|");

  useEffect(() => {
    let alive = true;
    setModel(null);
    setError(null);
    if (!urls.length) {
      setError("No 3D model yet");
      return;
    }
    loadModel(urls)
      .then((m) => alive && setModel(m))
      .catch(() => alive && setError("Could not load the 3D model"));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="model-preview" style={{ height, background: background || "var(--surface-sunken)" }}>
      {error && <div className="model-preview__msg">{error}</div>}
      {!error && !model && <div className="model-preview__msg"><span className="spinner" /> Loading model…</div>}
      {model && (
        <Canvas shadows camera={{ position: [2.2, 1.6, 2.2], fov: 40 }} dpr={[1, 2]} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[3, 5, 2]} intensity={1.6} castShadow />
          <Suspense fallback={null}>
            <Environment preset="apartment" />
          </Suspense>
          <Bounds fit clip observe margin={1.25}>
            <Model model={model} dims={dims} />
          </Bounds>
          <ContactShadows position={[0, 0, 0]} opacity={0.35} blur={2.4} scale={6} far={2} />
          <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={1.2} enablePan={false} />
        </Canvas>
      )}
    </div>
  );
}
