import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { config } from "../lib/config";
import { useAuth } from "../hooks/useAuth";
import { Spinner } from "../components/ui";
import "./login.css";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "No account with that email.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Use at least 6 characters.",
  "auth/invalid-email": "That email doesn't look right.",
  "auth/popup-closed-by-user": "The Google window was closed.",
  "auth/too-many-requests": "Too many attempts. Try again in a minute.",
  "auth/invalid-api-key": "Firebase is not configured (missing web API key).",
};

export default function LoginPage() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={(location.state as any)?.from || "/"} replace />;

  const fail = (e: any) => setError(MESSAGES[e?.code] || e?.message || "Something went wrong.");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") await signInWithEmailAndPassword(auth, email.trim(), password);
      else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card card">
        <div className="login__brand">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1>SoraPlan</h1>
            <p className="subtle">From a floor-plan sketch to a real-scale 3D home.</p>
          </div>
        </div>

        <button className="btn btn--block login__google" onClick={google} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Continue with Google
        </button>

        <div className="login__or"><span>or</span></div>

        <form onSubmit={submit}>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          </div>
          {error && <p className="login__error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <Spinner /> : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="login__switch subtle">
          {mode === "signin" ? "New to SoraPlan?" : "Already have an account?"}{" "}
          <button className="linklike" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        {!config.firebase.apiKey && <p className="login__error">Missing Firebase web API key (VITE_FIREBASE_API_KEY).</p>}
      </div>
    </div>
  );
}
