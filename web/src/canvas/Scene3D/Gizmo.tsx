// Selection gizmo drawn around the selected item: outline, rotate ring (with a front marker) and
// four top-corner scale handles. Handles keep a constant on-screen size in the orthographic view.
import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ItemInstance } from "../../lib/types";
import { BoxOutline } from "./Items";

interface Props {
  item: ItemInstance;
  color: string;
  warnColor: string;
  warning: boolean;
  showHandles: boolean;
  onRotateStart: (e: ThreeEvent<PointerEvent>) => void;
  onScaleStart: (e: ThreeEvent<PointerEvent>) => void;
}

const HANDLE_PX = 7;

export default function Gizmo({ item, color, warnColor, warning, showHandles, onRotateStart, onScaleStart }: Props) {
  const { w, d, h } = item.dims;
  const radius = Math.hypot(w, d) / 2 + 0.18;
  const handles = useRef<THREE.Group>(null);
  const knob = useRef<THREE.Mesh>(null);

  useFrame(({ camera }) => {
    const s = HANDLE_PX / Math.max((camera as THREE.OrthographicCamera).zoom || 1, 1e-3);
    handles.current?.children.forEach((c) => c.scale.setScalar(s));
    knob.current?.scale.setScalar(s * 1.2);
  });

  const ring = useMemo(() => new THREE.RingGeometry(radius - 0.025, radius + 0.025, 96), [radius]);
  const ringHit = useMemo(() => new THREE.TorusGeometry(radius, 0.14, 6, 64), [radius]);
  const lineColor = warning ? warnColor : color;
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  const stop = (fn: (e: ThreeEvent<PointerEvent>) => void) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    fn(e);
  };

  return (
    <group position={item.position} rotation={[0, item.rotationY, 0]}>
      <BoxOutline dims={item.dims} color={lineColor} />
      {showHandles && (
        <>
          <mesh geometry={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={11}>
            <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
          {/* Wide invisible torus = comfortable hit area for the ring */}
          <mesh
            geometry={ringHit}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.02, 0]}
            onPointerDown={stop(onRotateStart)}
            onPointerOver={() => (document.body.style.cursor = "grab")}
            onPointerOut={() => (document.body.style.cursor = "")}
          >
            <meshBasicMaterial visible={false} />
          </mesh>
          {/* Front marker (+Z is the model's front) */}
          <mesh ref={knob} position={[0, 0.02, radius]} renderOrder={12}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial color={color} depthTest={false} />
          </mesh>
          <group ref={handles}>
            {corners.map(([sx, sz]) => (
              <mesh
                key={`${sx}${sz}`}
                position={[(sx * w) / 2, h, (sz * d) / 2]}
                renderOrder={12}
                onPointerDown={stop(onScaleStart)}
                onPointerOver={() => (document.body.style.cursor = "nwse-resize")}
                onPointerOut={() => (document.body.style.cursor = "")}
              >
                <boxGeometry args={[1.6, 1.6, 1.6]} />
                <meshBasicMaterial color={color} depthTest={false} />
              </mesh>
            ))}
          </group>
        </>
      )}
    </group>
  );
}
