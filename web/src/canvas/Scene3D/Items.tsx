// Furniture items: the asset's GLB scaled to the item's real dims, or a translucent placeholder box
// while the asset is missing / still generating / failed.
import { memo, useEffect, useMemo, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { fitScale, loadModel, type LoadedModel } from "../../three/loadModel";
import { assetModelUrls } from "../../hooks/useAssets";
import type { Asset, Dims, ItemInstance } from "../../lib/types";

export function useModel(urls: string[], enabled: boolean): LoadedModel | null | "error" {
  const [model, setModel] = useState<LoadedModel | null | "error">(null);
  const key = urls.join("|");
  useEffect(() => {
    if (!enabled || !urls.length) {
      setModel(null);
      return;
    }
    let alive = true;
    loadModel(urls)
      .then((m) => alive && setModel(m))
      .catch(() => alive && setModel("error"));
    return () => {
      alive = false;
    };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return model;
}

/** Edges of a box of `dims` sitting on y = 0 (selection / warning outline). */
export function BoxOutline({ dims, color, pad = 0.02 }: { dims: Dims; color: string; pad?: number }) {
  const geometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(dims.w + pad * 2, dims.h + pad, dims.d + pad * 2)),
    [dims.w, dims.h, dims.d, pad],
  );
  return (
    <lineSegments geometry={geometry} position={[0, (dims.h + pad) / 2, 0]} renderOrder={10}>
      <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </lineSegments>
  );
}

function Placeholder({ dims, color, label, status, showLabel }: { dims: Dims; color: string; label: string; status: string; showLabel: boolean }) {
  const r = Math.min(0.06, dims.w / 4, dims.d / 4, dims.h / 4);
  return (
    <group>
      <RoundedBox args={[dims.w, dims.h, dims.d]} radius={r} smoothness={3} position={[0, dims.h / 2, 0]} castShadow>
        <meshStandardMaterial color={color} transparent opacity={0.5} roughness={0.6} />
      </RoundedBox>
      {showLabel && (
        <Html position={[0, dims.h + 0.05, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="s3d-tag">
            {label}
            {status && <span className="s3d-tag__status">{status}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

function Model({ model, dims }: { model: LoadedModel; dims: Dims }) {
  const object = useMemo(() => model.scene.clone(true), [model]);
  const scale = useMemo(() => fitScale(model.size, dims), [model, dims.w, dims.d, dims.h]); // eslint-disable-line react-hooks/exhaustive-deps
  return <primitive object={object} scale={scale} />;
}

interface ItemProps {
  item: ItemInstance;
  asset: Asset | undefined;
  /** Load GLBs only once walls are on screen. */
  loadModels: boolean;
  accent: string;
  /** Name tag over placeholder boxes (off during the cinematic tour). */
  showLabel?: boolean;
  onPointerDown: (item: ItemInstance, e: ThreeEvent<PointerEvent>) => void;
  onDoubleClick: (item: ItemInstance) => void;
}

function statusLabel(asset: Asset | undefined, item: ItemInstance): string {
  if (!item.assetId) return "No model";
  if (!asset) return "";
  if (asset.status === "generating_3d" || asset.status === "uploaded") return `Generating 3D ${Math.round(asset.progress || 0)}%`;
  if (asset.status === "failed") return "3D failed";
  return "";
}

export const ItemView = memo(function ItemView({ item, asset, loadModels, accent, showLabel = true, onPointerDown, onDoubleClick }: ItemProps) {
  const ready = asset?.status === "ready";
  const urls = useMemo(() => (ready ? assetModelUrls(asset) : []), [ready, asset?.glbWebUrl, asset?.glbUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useModel(urls, loadModels && ready);
  return (
    <group
      position={item.position}
      rotation={[0, item.rotationY, 0]}
      onPointerDown={(e) => onPointerDown(item, e)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick(item);
      }}
    >
      {/* Invisible bbox: the whole volume is grabbable, not just the mesh (thin legs, gaps between cushions) */}
      <mesh position={[0, item.dims.h / 2, 0]}>
        <boxGeometry args={[item.dims.w + 0.04, item.dims.h, item.dims.d + 0.04]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {model && model !== "error" ? (
        <Model model={model} dims={item.dims} />
      ) : (
        <Placeholder
          dims={item.dims}
          color={accent}
          label={item.label || asset?.name || "Item"}
          status={model === "error" ? "Model unavailable" : ready ? "Loading…" : statusLabel(asset, item)}
          showLabel={showLabel}
        />
      )}
    </group>
  );
});
