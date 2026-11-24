import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import type { SceneGraph } from "../../lib/types";
import { canStand, walkDelta, walkMove, walkSpace, walkStart, type FloorPoint } from "./walkthrough";

export interface WalkMotion { forward: number; right: number }
export interface WalkthroughSetup {
  start: FloorPoint;
  motionRef: MutableRefObject<WalkMotion>;
  onExit: () => void;
}

const movementCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);

export default function FirstPersonCamera({ graph, start, motionRef, onExit, manipulatingRef }: WalkthroughSetup & { graph: SceneGraph; manipulatingRef: MutableRefObject<boolean> }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const canvas = useThree((s) => s.gl.domElement);
  const space = useMemo(() => walkSpace(graph), [graph]);
  const keys = useRef(new Set<string>());
  const angles = useRef({ yaw: 0, pitch: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.set(start[0], space.eyeHeight, start[1]);
    camera.rotation.set(0, 0, 0, "YXZ");
    angles.current = { yaw: 0, pitch: 0 };
    canvas.focus({ preventScroll: true });
  }, [start, space.eyeHeight, canvas]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || manipulatingRef.current || canStand(space, [camera.position.x, camera.position.z])) return;
    // An edit can put a sofa where the visitor stood. Resume from a clear spot.
    const safe = walkStart(space);
    if (safe) camera.position.set(safe[0], space.eyeHeight, safe[1]);
  }, [space, manipulatingRef]);

  useEffect(() => {
    const previousTabIndex = canvas.getAttribute("tabindex");
    const previousTouchAction = canvas.style.touchAction;
    canvas.tabIndex = 0;
    // OrbitControls restores this to "auto" when walk mode replaces it. Keep touch drags
    // on the canvas so the browser does not cancel furniture edits to start scrolling.
    canvas.style.touchAction = "none";
    canvas.focus({ preventScroll: true });
    return () => {
      if (previousTabIndex === null) canvas.removeAttribute("tabindex");
      else canvas.setAttribute("tabindex", previousTabIndex);
      canvas.style.touchAction = previousTouchAction;
    };
  }, [canvas]);

  useEffect(() => {
    const clear = () => {
      keys.current.clear();
      motionRef.current = { forward: 0, right: 0 };
      if (drag.current && canvas.hasPointerCapture(drag.current.id)) canvas.releasePointerCapture(drag.current.id);
      drag.current = null;
    };
    clear();
    canvas.focus({ preventScroll: true });
    const down = (e: KeyboardEvent) => {
      if (document.activeElement !== canvas || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Escape") { e.preventDefault(); onExit(); return; }
      if (!movementCodes.has(e.code)) return;
      e.preventDefault();
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.code); };
    const pointerDown = (e: PointerEvent) => {
      // R3F claims furniture/handle presses first. Right-drag can look around over any object.
      if (e.target !== canvas || manipulatingRef.current || drag.current || (e.button !== 0 && e.button !== 2)) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const pointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId || manipulatingRef.current) return;
      angles.current.yaw -= (e.clientX - d.x) * 0.004;
      angles.current.pitch = THREE.MathUtils.clamp(angles.current.pitch - (e.clientY - d.y) * 0.004, -Math.PI * 0.47, Math.PI * 0.47);
      d.x = e.clientX;
      d.y = e.clientY;
    };
    const pointerUp = (e: PointerEvent) => {
      if (drag.current?.id !== e.pointerId) return;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      drag.current = null;
    };
    const wheel = (e: WheelEvent) => e.preventDefault();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    canvas.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    // Run after the scene's canvas handlers so a furniture press always wins over mouse-look.
    window.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    canvas.addEventListener("lostpointercapture", pointerUp);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      canvas.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
      window.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
      canvas.removeEventListener("lostpointercapture", pointerUp);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [canvas, motionRef, onExit, manipulatingRef]);

  useFrame((_, dt) => {
    const camera = cameraRef.current;
    if (!camera || manipulatingRef.current) return;
    const k = keys.current;
    const forward = Number(k.has("KeyW") || k.has("ArrowUp")) - Number(k.has("KeyS") || k.has("ArrowDown")) + motionRef.current.forward;
    const right = Number(k.has("KeyD") || k.has("ArrowRight")) - Number(k.has("KeyA") || k.has("ArrowLeft")) + motionRef.current.right;
    const delta = walkDelta(forward, right, angles.current.yaw, Math.min(dt, 0.1), k.has("ShiftLeft") || k.has("ShiftRight"));
    const [x, z] = walkMove(space, [camera.position.x, camera.position.z], delta);
    camera.position.set(x, space.eyeHeight, z);
    camera.rotation.set(angles.current.pitch, angles.current.yaw, 0, "YXZ");
  });

  return <PerspectiveCamera ref={cameraRef} makeDefault fov={72} near={0.03} far={1000} />;
}
