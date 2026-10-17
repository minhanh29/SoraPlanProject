import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, Timestamp } from "firebase/firestore";
import { config } from "./config";

export const firebaseApp = initializeApp(config.firebase);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

/** Convert Firestore Timestamps (recursively) to Dates so components never see Timestamp objects. */
export function fromFirestore<T>(id: string, data: Record<string, any>): T {
  return { id, ...convert(data) } as T;
}

function convert(value: any): any {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(convert);
  if (value && typeof value === "object" && value.constructor === Object) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return out;
  }
  return value;
}
