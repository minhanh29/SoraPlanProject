// Tour-only interior: a ceiling over every room and one warm ceiling light per room. Shown only while an
// interior shot is on screen (aerial shots look down into the house), switched per frame from `interiorRef`
// so the cinematic camera needs no React re-render. Lights stay mounted and only their intensity changes:
// adding/removing lights would recompile every material at each cut.
import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneRoom } from "../../lib/types";

interface Props {
  rooms: SceneRoom[];
  height: number;
  interiorRef: MutableRefObject<boolean>;
}

function centroid(poly: { x: number; z: number }[]): [number, number] {
  return [poly.reduce((s, p) => s + p.x, 0) / poly.length, poly.reduce((s, p) => s + p.z, 0) / poly.length];
}

export default function Interior({ rooms, height, interiorRef }: Props) {
  const ceilingGroup = useRef<THREE.Group>(null);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const ceilings = useMemo(
    () =>
      rooms
        .filter((r) => r.polygon.length >= 3)
        .map((r) => ({
          id: r.id,
          area: r.area || 10,
          center: centroid(r.polygon),
          geometry: new THREE.ShapeGeometry(new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x, -p.z)))),
        })),
    [rooms],
  );
  useFrame(() => {
    const on = interiorRef.current;
    if (ceilingGroup.current) ceilingGroup.current.visible = on;
    ceilings.forEach((c, i) => {
      const l = lights.current[i];
      if (l) l.intensity = on ? 4 + c.area * 0.35 : 0;
    });
  });
  return (
    <group>
      <group ref={ceilingGroup} visible={false}>
        {ceilings.map((c) => (
          // Same mapping as the floors (x, -z) → (x, 0, z), lifted to the ceiling; double-sided to be seen from
          // below. No shadow casting, so the sun through the windows still lights the room.
          <mesh key={c.id} geometry={c.geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} receiveShadow>
            <meshStandardMaterial color="#f4f1ec" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
      {ceilings.map((c, i) => (
        <pointLight
          key={c.id}
          ref={(l) => (lights.current[i] = l)}
          position={[c.center[0], height - 0.35, c.center[1]]}
          color="#ffe2bd"
          intensity={0}
          distance={Math.max(5, Math.sqrt(c.area) * 2.2)}
          decay={1.6}
        />
      ))}
    </group>
  );
}
