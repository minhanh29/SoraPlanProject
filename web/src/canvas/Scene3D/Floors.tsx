import { useMemo } from "react";
import * as THREE from "three";
import type { Palette, SceneRoom } from "../../lib/types";

interface Props {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  rooms: SceneRoom[];
  palette: Palette;
}

function RoomFloor({ room, color }: { room: SceneRoom; color: string }) {
  const geometry = useMemo(() => {
    if (room.polygon.length < 3) return null;
    // Shape lives in XY; rotating -90° about X maps (x, y) → (x, 0, -y), so feed (x, -z).
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

export default function Floors({ bounds, rooms, palette }: Props) {
  const w = Math.max(bounds.maxX - bounds.minX, 0.1);
  const d = Math.max(bounds.maxZ - bounds.minZ, 0.1);
  return (
    <group>
      <mesh position={[(bounds.minX + bounds.maxX) / 2, -0.03, (bounds.minZ + bounds.maxZ) / 2]} receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        <meshStandardMaterial color={palette.floor} roughness={0.82} />
      </mesh>
      {rooms
        .filter((r) => r.floorColor)
        .map((r) => (
          <RoomFloor key={r.id} room={r} color={r.floorColor || palette.floor} />
        ))}
    </group>
  );
}
