import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ProjectFiles } from "../lib/types";

/** Fresh signed URLs for the plan images. Refetches when `version` changes (e.g. after a re-crop). */
export function useProjectFiles(projectId: string | null, version: unknown = 0) {
  const [files, setFiles] = useState<ProjectFiles | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api
      .projectFiles(projectId)
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles({ planOriginalUrl: null, planUrl: null }));
    return () => {
      alive = false;
    };
  }, [projectId, version]);
  return files;
}
