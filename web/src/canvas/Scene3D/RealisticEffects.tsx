// Post-processing for the realistic render: ambient occlusion (N8AO) for contact depth in corners and under
// furniture, a soft bloom on bright windows/lights, SMAA edges, ACES tone mapping and a light vignette.
// With a composer the renderer draws into a buffer, where three.js skips tone mapping, so it is done here.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type EffectComposer as EffectComposerImpl } from "postprocessing";

interface Props {
  /** Heavier AO (full resolution, more samples) for the exported video. */
  high?: boolean;
}

const RealisticEffects = forwardRef<EffectComposerImpl | null, Props>(function RealisticEffects({ high = false }, ref) {
  const composer = useRef<EffectComposerImpl>(null);
  // No deps: the library recreates the composer when its config changes, so always hand out the current one
  useImperativeHandle(ref, () => composer.current as EffectComposerImpl);
  // The library resizes the composer on CSS size changes only; follow pixel-ratio changes too (video export,
  // moving the window to another screen).
  const dpr = useThree((s) => s.viewport.dpr);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  // postprocessing's composer sets gl.autoClear = false on creation (again whenever it is recreated) and never
  // restores it. With it off, ContactShadows' render target is never cleared, so moved objects smear their shadows.
  // The wrapper already renders the composer with autoClear on, so keep it on every frame and after unmount.
  useFrame(() => {
    gl.autoClear = true;
  });
  useEffect(() => () => void (gl.autoClear = true), [gl]);
  useEffect(() => {
    // CSS size; the composer sizes its buffers from the renderer's drawing buffer (CSS size × pixel ratio)
    composer.current?.setSize(size.width, size.height);
  }, [dpr, size.width, size.height]);
  return (
    <EffectComposer ref={composer} multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={0.6} distanceFalloff={0.6} intensity={2.2} color="black" halfRes={!high} quality={high ? "high" : "medium"} />
      <Bloom intensity={0.18} luminanceThreshold={0.92} luminanceSmoothing={0.2} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.42} />
      <SMAA />
    </EffectComposer>
  );
});

export default RealisticEffects;
