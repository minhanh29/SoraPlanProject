import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "../lib/firebase";
import { api } from "../lib/api";
import type { UserProfile } from "../lib/types";

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        setProfile(null);
        if (u) {
          // The API is the only source of the admin role (ADMIN_UIDS)
          try {
            setProfile(await api.me());
          } catch {
            setProfile({ uid: u.uid, email: u.email || "", displayName: u.displayName, photoUrl: u.photoURL, role: "user" });
          }
        }
        setLoading(false);
      }),
    [],
  );

  const value: AuthState = {
    user,
    profile,
    isAdmin: profile?.role === "admin",
    loading,
    signOut: () => signOut(auth),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
