// Selection gizmo drawn around the selected item: outline, rotate ring (with a front marker), four top-corner
// handles (uniform scale), four top-edge handles (stretch one side, the opposite side stays put) and a top
// handle (height only). Handles keep a constant on-screen size in either projection.
import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { ItemInstance } from "../../lib/types";
import { BoxOutline } from "./Items";
import { worldPerPixel } from "./cameraScale";

interface Props {
  item: ItemInstance;
  color: string;
  warnColor: string;
  warning: boolean;
  showHandles: boolean;
  onRotateStart: (e: ThreeEvent<PointerEvent>) => void;
  onScaleStart: (e: ThreeEvent<PointerEvent>) => void;
  /** Side handle: stretch along the item's local x ("w") or z ("d"), on the + or − side. */
  onEdgeStart: (axis: "w" | "d", sign: 1 | -1, e: ThreeEvent<PointerEvent>) => void;
  onHeightStart: (e: ThreeEvent<PointerEvent>) => void;
}

const EDGES: { axis: "w" | "d"; sign: 1 | -1 }[] = [
  { axis: "w", sign: 1 },
  { axis: "w", sign: -1 },
  { axis: "d", sign: 1 },
  { axis: "d", sign: -1 },
];

const HANDLE_PX = 7;
/** Invisible pick sphere around each handle (in handle units: ~15 px radius), so small handles are easy to grab. */
const HIT_R = 2.2;

function Hit() {
  return (
    <mesh>
      <sphereGeometry args={[HIT_R, 12, 8]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** Radius of the rotate ring around an item's footprint. */
export const ringRadius = (dims: { w: number; d: number }) => Math.hypot(dims.w, dims.d) / 2 + 0.18;

export default function Gizmo({ item, color, warnColor, warning, showHandles, onRotateStart, onScaleStart, onEdgeStart, onHeightStart }: Props) {
  const { w, d, h } = item.dims;
  const radius = ringRadius(item.dims);
  const handles = useRef<THREE.Group>(null);
  const knob = useRef<THREE.Mesh>(null);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const px = (o: THREE.Object3D) => HANDLE_PX * worldPerPixel(camera, o.getWorldPosition(tmp), size.height);
    handles.current?.children.forEach((c) => c.scale.setScalar(px(c)));
    if (knob.current) knob.current.scale.setScalar(px(knob.current) * 1.2);
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
  const hover = (cursor: string) => ({
    onPointerOver: () => (document.body.style.cursor = cursor),
    onPointerOut: () => (document.body.style.cursor = ""),
  });

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
              <group key={`${sx}${sz}`} position={[(sx * w) / 2, h, (sz * d) / 2]} onPointerDown={stop(onScaleStart)} {...hover("nwse-resize")}>
                <mesh renderOrder={12}>
                  <boxGeometry args={[1.6, 1.6, 1.6]} />
                  <meshBasicMaterial color={color} depthTest={false} />
                </mesh>
                <Hit />
              </group>
            ))}
            {/* Side handles: round, white with a colored ring, so they read differently from the corners */}
            {EDGES.map(({ axis, sign }) => (
              <group
                key={`${axis}${sign}`}
                position={axis === "w" ? [(sign * w) / 2, h, 0] : [0, h, (sign * d) / 2]}
                onPointerDown={stop((e) => onEdgeStart(axis, sign, e))}
                {...hover(axis === "w" ? "ew-resize" : "ns-resize")}
              >
                <mesh renderOrder={13}>
                  <sphereGeometry args={[0.85, 16, 12]} />
                  <meshBasicMaterial color="#ffffff" depthTest={false} />
                </mesh>
                <mesh renderOrder={12}>
                  <sphereGeometry args={[1.15, 16, 12]} />
                  <meshBasicMaterial color={color} depthTest={false} />
                </mesh>
                <Hit />
              </group>
            ))}
            {/* Height handle: diamond floating just above the top centre */}
            <group position={[0, h, 0]} onPointerDown={stop(onHeightStart)} {...hover("ns-resize")}>
              <mesh position={[0, 2.6, 0]} renderOrder={12}>
                <octahedronGeometry args={[1.3]} />
                <meshBasicMaterial color={color} depthTest={false} />
              </mesh>
              <group position={[0, 2.6, 0]}>
                <Hit />
              </group>
              <mesh position={[0, 1.3, 0]} renderOrder={11}>
                <boxGeometry args={[0.25, 2.6, 0.25]} />
                <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.7} />
              </mesh>
            </group>
          </group>
        </>
      )}
    </group>
  );
}
