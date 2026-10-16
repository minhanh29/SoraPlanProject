import { useEffect, useState } from "react";
import { doc, onSnapshot, type DocumentReference, type Query } from "firebase/firestore";
import { db, fromFirestore } from "../lib/firebase";

/** Live document; `undefined` while loading, `null` when missing. */
export function useDoc<T>(path: string | null): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!path) {
      setValue(null);
      return;
    }
    setValue(undefined);
    const ref = doc(db, path) as DocumentReference;
    return onSnapshot(
      ref,
      (snap) => setValue(snap.exists() ? fromFirestore<T>(snap.id, snap.data()) : null),
      (err) => {
        console.warn("[firestore]", path, err.message);
        setValue(null);
      },
    );
  }, [path]);
  return value;
}

/** Live query; re-subscribes when `key` changes. */
export function useQuery<T>(key: string | null, build: () => Query | null): T[] | undefined {
  const [value, setValue] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    const q = key ? build() : null;
    if (!q) {
      setValue([]);
      return;
    }
    setValue(undefined);
    return onSnapshot(
      q,
      (snap) => setValue(snap.docs.map((d) => fromFirestore<T>(d.id, d.data()))),
      (err) => {
        console.warn("[firestore]", key, err.message);
        setValue([]);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return value;
}
