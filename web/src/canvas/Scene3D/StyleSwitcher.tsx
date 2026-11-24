import { useEffect, useRef, useState } from "react";
import type { SceneDoc, StyleId } from "../../lib/types";
import { api } from "../../lib/api";
import { Spinner, toast } from "../../components/ui";

interface Props {
  projectId: string;
  style: StyleId;
  version: number;
  disabled: boolean;
  onApplied?: (snapshot: SceneDoc) => void;
}

export default function StyleSwitcher({ projectId, style, version, disabled, onApplied }: Props) {
  const [pending, setPending] = useState<{ style: StyleId; version: number | null } | null>(null);
  const running = useRef(false);

  useEffect(() => {
    if (pending && pending.version !== null && version >= pending.version) {
      setPending(null);
      running.current = false;
    }
  }, [version, pending]);

  const choose = async (next: StyleId) => {
    if (disabled || running.current || next === style) return;
    running.current = true;
    setPending({ style: next, version: null });
    try {
      const result = await api.switchSceneStyle(projectId, next, version);
      if (result.scene) onApplied?.(result.scene);
      setPending({ style: next, version: result.newVersion });
      toast(result.retainedItems
        ? `${next} applied. ${result.retainedItems} item(s) kept their current model because no matching model is available.`
        : `${next} style applied`, "success");
    } catch (error) {
      running.current = false;
      setPending(null);
      toast((error as Error).message || "Could not change the style. Try again.", "error");
    }
  };

  return <div className="s3d-style-switch" role="group" aria-label="Interior style" aria-busy={!!pending}>
    {(["Japandi", "Industrial"] as const).map((option) => <button
      key={option}
      type="button"
      className={`s3d-style-switch__button ${style === option ? "is-active" : ""}`}
      aria-pressed={style === option}
      disabled={disabled || !!pending || style === option}
      title={`Use ${option} furniture and colors; keep your layout and sizes`}
      onClick={() => void choose(option)}
    >{pending?.style === option && <Spinner size={12} />}{option}</button>)}
  </div>;
}
