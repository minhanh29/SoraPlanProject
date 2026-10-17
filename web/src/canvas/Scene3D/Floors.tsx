import { useMemo } from "react";
import * as THREE from "three";
import type { Palette, SceneRoom } from "../../lib/types";
import { floorFinish, repeated, woodTexture } from "./materials";

interface Props {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  rooms: SceneRoom[];
  palette: Palette;
  /** Realistic render: wood / tile textures on every room. */
  realistic?: boolean;
}

function RoomFloor({ room, color, realistic }: { room: SceneRoom; color: string; realistic: boolean }) {
  const geometry = useMemo(() => {
    if (room.polygon.length < 3) return null;
    // Shape lives in XY; rotating -90° about X maps (x, y) → (x, 0, -y), so feed (x, -z).
    // ShapeGeometry UVs are those XY coordinates, i.e. meters.
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);
  const finish = useMemo(() => {
    if (!realistic) return null;
    const f = floorFinish(room.type, color);
    return { map: repeated(f.map, 1, 1), roughness: f.roughness }; // UVs are meters: one texture tile per TEXTURE_M
  }, [realistic, room.type, color]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
      {finish ? (
        <meshStandardMaterial map={finish.map} roughness={finish.roughness} metalness={0} />
      ) : (
        <meshStandardMaterial color={color} roughness={0.8} />
      )}
    </mesh>
  );
}

export default function Floors({ bounds, rooms, palette, realistic = false }: Props) {
  const w = Math.max(bounds.maxX - bounds.minX, 0.1);
  const d = Math.max(bounds.maxZ - bounds.minZ, 0.1);
  const slabMap = useMemo(() => (realistic ? repeated(woodTexture(palette.floor), w, d) : null), [realistic, palette.floor, w, d]);
  return (
    <group>
      <mesh position={[(bounds.minX + bounds.maxX) / 2, -0.03, (bounds.minZ + bounds.maxZ) / 2]} receiveShadow>
        <boxGeometry args={[w, 0.06, d]} />
        {slabMap ? (
          <meshStandardMaterial map={slabMap} roughness={0.65} />
        ) : (
          <meshStandardMaterial color={palette.floor} roughness={0.82} />
        )}
      </mesh>
      {rooms
        .filter((r) => realistic || r.floorColor)
        .map((r) => (
          <RoomFloor key={r.id} room={r} color={r.floorColor || palette.floor} realistic={realistic} />
        ))}
    </group>
  );
}
