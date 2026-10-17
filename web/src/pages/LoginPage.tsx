import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { config } from "../lib/config";
import { useAuth } from "../hooks/useAuth";
import { setTheme, useTheme } from "../lib/theme";
import { Icon } from "../components/ui";
import { Spinner } from "../components/ui";
import "./login.css";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "No account with that email.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Use at least 6 characters.",
  "auth/invalid-email": "That email doesn't look right.",
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
  const dusk = useTheme() === "dark";
  // Each hour's photo loads the first time it is shown
  const [shown, setShown] = useState({ day: !dusk, dusk });
  useEffect(() => setShown((s) => (dusk ? { ...s, dusk: true } : { ...s, day: true })), [dusk]);

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

  return (
    <div className={`login ${dusk ? "login--dusk" : "login--day"}`}>
      {/* Day: the drawing is wiped into the photo on load. Switching theme crossfades the sky between the two
          hours of the same frame. */}
      <div className="login__scene" aria-hidden="true">
        {shown.day && (
          <div className={`login__hour ${dusk ? "" : "is-on"}`}>
            <img className="login__photo" src="/art/hero-day.webp" alt="" />
            <img className="login__photo login__sketch" src="/art/hero-sketch.webp" alt="" />
          </div>
        )}
        {shown.dusk && (
          <div className={`login__hour ${dusk ? "is-on" : ""}`}>
            <img className="login__photo" src="/art/hero-dusk.webp" alt="" />
          </div>
        )}
      </div>
      <div className="login__cols" aria-hidden="true"><span /><span /><span /><span /></div>

      <div className="login__brand">
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <span>SoraPlan</span>
      </div>
      <h1 className="login__headline display" aria-label="From sketch to a home at scale">
        <span><b>From sketch</b></span>
        <span><b>to a home</b></span>
        <span><b>at scale</b></span>
      </h1>

      <div className="login__panel ink" aria-hidden="true">
        <img className="login__plan" src="/art/line-plan.webp" alt="" />
        <div>
          <small>Sora plan</small>
          <strong className="display login__area">86 m²</strong>
          <span>2 bedrooms, 1 bath</span>
        </div>
      </div>
      <button type="button" className="login__theme" onClick={() => setTheme(dusk ? "light" : "dark")}>
        <Icon name={dusk ? "sun" : "moon"} size={16} />
        {dusk ? "Light theme" : "Dark theme"}
      </button>

      <div className="login__card">
        <h2 className="login__title">{mode === "signin" ? "Sign in" : "Create your account"}</h2>

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
