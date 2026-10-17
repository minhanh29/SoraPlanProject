import { useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { Palette, SceneOpening, SceneWall } from "../../lib/types";
import { wallPieces } from "./geometry";

interface Props {
  walls: SceneWall[];
  openings: SceneOpening[];
  palette: Palette;
  /** Clip height for the cutaway view (null = full height). */
  cutHeight: number | null;
  /** Realistic render: glass in window openings. */
  realistic?: boolean;
}

/** Thin glass pane filling a window opening (wall-local coordinates). */
function WindowGlass({ opening, length, cutHeight }: { opening: SceneOpening; length: number; cutHeight: number | null }) {
  const y0 = opening.sillHeight;
  const y1 = Math.min(opening.sillHeight + opening.height, cutHeight ?? Infinity);
  if (y1 - y0 < 0.05) return null;
  return (
    <mesh position={[opening.offset - length / 2, (y0 + y1) / 2, 0]} renderOrder={2}>
      <boxGeometry args={[Math.max(0.05, opening.width - 0.04), y1 - y0, 0.015]} />
      <meshPhysicalMaterial color="#dfe9ee" transparent opacity={0.16} roughness={0.04} metalness={0} envMapIntensity={1.4} depthWrite={false} />
    </mesh>
  );
}

function Wall({
  wall,
  openings,
  color,
  cutHeight,
  realistic,
}: {
  wall: SceneWall;
  openings: SceneOpening[];
  color: string;
  cutHeight: number | null;
  realistic: boolean;
}) {
  const [x1, z1] = wall.start;
  const [x2, z2] = wall.end;
  const length = Math.hypot(x2 - x1, z2 - z1);
  const angle = Math.atan2(z2 - z1, x2 - x1);
  const pieces = useMemo(
    () => wallPieces(length, wall.height, wall.thickness, openings, cutHeight ?? undefined),
    [length, wall.height, wall.thickness, openings, cutHeight],
  );
  if (length < 0.01) return null;
  return (
    <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, -angle, 0]}>
      {pieces.map((p, i) => (
        <mesh
          key={i}
          position={[(p.u0 + p.u1) / 2 - length / 2, (p.y0 + p.y1) / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[p.u1 - p.u0, p.y1 - p.y0, wall.thickness]} />
          <meshStandardMaterial color={color} roughness={0.92} metalness={0} />
        </mesh>
      ))}
      {realistic &&
        openings
          .filter((o) => o.type === "window")
          .map((o) => <WindowGlass key={o.id} opening={o} length={length} cutHeight={cutHeight} />)}
    </group>
  );
}

export default function Walls({ walls, openings, palette, cutHeight, realistic = false }: Props) {
  const byWall = useMemo(() => {
    const m = new Map<string, SceneOpening[]>();
    for (const o of openings) m.set(o.wallId, [...(m.get(o.wallId) || []), o]);
    return m;
  }, [openings]);
  return (
    <group>
      {walls.map((w) => (
        <Wall key={w.id} wall={w} openings={byWall.get(w.id) || EMPTY} color={w.color || palette.wall} cutHeight={cutHeight} realistic={realistic} />
      ))}
    </group>
  );
}

const EMPTY: SceneOpening[] = [];

/**
 * Tour walls: the cutaway on aerial shots (the opening and closing views look down into the rooms), full walls on
 * interior shots. Both stay mounted and are switched per frame from `interiorRef`, like the tour's ceilings, so a
 * cut needs no React re-render (and the video export, which drives frames itself, gets the same walls).
 */
export function TourWalls({ interiorRef, cutHeight, ...props }: Props & { interiorRef: MutableRefObject<boolean>; cutHeight: number }) {
  const full = useRef<THREE.Group>(null);
  const cut = useRef<THREE.Group>(null);
  useFrame(() => {
    const inside = interiorRef.current;
    if (full.current) full.current.visible = inside;
    if (cut.current) cut.current.visible = !inside;
  });
  return (
    <>
      <group ref={full} visible={false}>
        <Walls {...props} cutHeight={null} />
      </group>
      <group ref={cut}>
        <Walls {...props} cutHeight={cutHeight} />
      </group>
    </>
  );
}
