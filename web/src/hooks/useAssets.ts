import { useEffect, useMemo, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { api } from "../lib/api";
import type { Asset } from "../lib/types";
import { useQuery } from "./useFirestore";
import { useAuth } from "./useAuth";

/** System catalog (public URLs stored on the docs). */
export function useSystemAssets() {
  return useQuery<Asset>("assets:system", () => query(collection(db, "assets"), where("isSystem", "==", true)));
}

/**
 * The user's own assets. Docs stream from Firestore (status/progress live); signed URLs are refreshed once
 * through the API, which re-signs URLs that expire within a day and writes them back to the docs.
 */
export function useMyAssets() {
  const { user } = useAuth();
  const live = useQuery<Asset>(user ? `assets:mine:${user.uid}` : null, () =>
    query(collection(db, "assets"), where("ownerUid", "==", user!.uid), orderBy("createdAt", "desc")),
  );
  const [refreshed, setRefreshed] = useState(false);
  useEffect(() => {
    if (!user || refreshed) return;
    setRefreshed(true);
    api.listAssets("mine").catch(() => undefined);
  }, [user, refreshed]);
  return useMemo(() => live?.filter((a) => !a.isSystem), [live]);
}

/** id → asset for everything the user can place (system + own). */
export function useAssetIndex(): Record<string, Asset> {
  const system = useSystemAssets();
  const mine = useMyAssets();
  return useMemo(() => {
    const out: Record<string, Asset> = {};
    for (const a of system || []) out[a.id] = a;
    for (const a of mine || []) out[a.id] = a;
    return out;
  }, [system, mine]);
}

/** Best URL to load in WebGL: optimized web GLB first, original as fallback. */
export function assetModelUrls(a: Asset | null | undefined): string[] {
  if (!a) return [];
  return [a.glbWebUrl, a.glbUrl].filter((u): u is string => Boolean(u));
}
