// Validation overlay: the plan image and the parsed furniture/fixture boxes drawn on the floor, using the
// scene builder's plan → scene mapping (X = x·k, Z = y·k, rotationY = -deg2rad(rotation)). If the walls and
// models line up with it, the parse and the 3D mapping agree.
import { useEffect, useMemo, useState } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlan, PlanBox } from "../../lib/types";
import { deg2rad, planScale } from "../../lib/units";

export type OverlayImageStatus = "none" | "loading" | "ready" | "error";

interface Props {
  plan: FloorPlan;
  imageUrl: string | null | undefined;
  /** Box color (the 2D editor's furniture blue). */
  color: string;
  opacity?: number;
  onImageStatus?: (s: OverlayImageStatus) => void;
}

// Just above the floor slab (top at y = 0) and room tints (y = 0.003), below every item.
const IMAGE_Y = 0.015;
const BOX_Y = 0.03;

/**
 * Load the plan image as a WebGL texture. WebGL needs a CORS-clean image, and the 2D editor already fetched
 * the same signed URL *without* CORS, so a plain crossOrigin load can hit that cached non-CORS response and
 * fail. Fetch it fresh in CORS mode and hand three.js a same-origin blob URL instead.
 */
function usePlanTexture(url: string | null | undefined, plan: FloorPlan, onStatus?: (s: OverlayImageStatus) => void) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const src = plan.sourceImage;
  useEffect(() => {
    setTexture(null);
    if (!url) {
      onStatus?.("none");
      return;
    }
    onStatus?.("loading");
    let alive = true;
    let tex: THREE.Texture | null = null;
    let blobUrl: string | null = null;
    (async () => {
      try {
        const res = await fetch(url, { mode: "cors", cache: "reload" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blobUrl = URL.createObjectURL(await res.blob());
        tex = await new THREE.TextureLoader().loadAsync(blobUrl);
        if (!alive) return tex.dispose();
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        // Same crop as the 2D editor's reference image (render.ts): image pixels → plan rectangle
        const img = tex.image as { width: number; height: number };
        if (src?.cropWidth && src.cropHeight && img.width && img.height) {
          tex.repeat.set(src.cropWidth / img.width, src.cropHeight / img.height);
          tex.offset.set((src.cropX || 0) / img.width, 1 - ((src.cropY || 0) + src.cropHeight) / img.height);
        }
        setTexture(tex);
        onStatus?.("ready");
      } catch (e) {
        console.warn("[PlanOverlay] plan image could not be loaded", e);
        if (alive) onStatus?.("error");
      }
    })();
    return () => {
      alive = false;
      tex?.dispose();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url, src?.cropX, src?.cropY, src?.cropWidth, src?.cropHeight]); // eslint-disable-line react-hooks/exhaustive-deps
  return texture;
}

function ParsedBox({ box, k, color }: { box: PlanBox; k: number; color: string }) {
  const w = box.width * k;
  const d = box.height * k;
  const outline = useMemo(
    () => [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sz]) => [(sx * w) / 2, 0, (sz * d) / 2] as [number, number, number]),
    [w, d],
  );
  return (
    <group position={[(box.x + box.width / 2) * k, BOX_Y, (box.y + box.height / 2) * k]} rotation={[0, -deg2rad(box.rotation || 0), 0]}>
      {/* Drawn over everything (no depth test) so boxes stay visible through walls and models */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={20}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <Line points={outline} color={color} lineWidth={2.5} depthTest={false} renderOrder={21} toneMapped={false} />
    </group>
  );
}

export default function PlanOverlay({ plan, imageUrl, color, opacity = 0.85, onImageStatus }: Props) {
  const k = planScale(plan);
  const W = plan.width * k;
  const H = plan.height * k;
  const texture = usePlanTexture(imageUrl, plan, onImageStatus);
  const boxes = useMemo(() => [...(plan.furniture || []), ...(plan.fixtures || [])].filter((b) => b.width > 0 && b.height > 0), [plan]);
  return (
    <group>
      {texture && (
        <mesh position={[W / 2, IMAGE_Y, H / 2]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
      )}
      {boxes.map((b) => (
        <ParsedBox key={b.id} box={b} k={k} color={color} />
      ))}
    </group>
  );
}
