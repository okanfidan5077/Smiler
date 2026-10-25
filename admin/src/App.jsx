import { useEffect, useState } from "react";
import { supabase, configured } from "./supabase.js";
import Queue from "./Queue.jsx";
import Stats from "./Stats.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(null);
  const [tab, setTab] = useState("queue");

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setIsAdmin(null);
    supabase.from("admins").select("user_id").eq("user_id", session.user.id).then(({ data }) => setIsAdmin(!!data?.length));
  }, [session]);

  if (!configured) {
    return <Centered><h1>Smiler Admin</h1><p>Supabase is not configured. Fill in <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> in the repo-root <code>.env</code>, then restart <code>npm run dev</code>.</p></Centered>;
  }
  if (!session) return <Login />;
  if (isAdmin === false) {
    return (
      <Centered>
        <h1>Not an admin</h1>
        <p>{session.user.email} is signed in but not listed in <code>admins</code>. Set <code>ADMIN_EMAIL</code> in .env and run <code>npm run migrate</code> in <code>server/</code>.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </Centered>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Smiler</strong>
        <nav>
          <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>Text queue</button>
          <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>Stats</button>
        </nav>
        <span className="muted">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {isAdmin === null ? <p className="muted pad">Checking access…</p> : tab === "queue" ? <Queue /> : <Stats />}
    </div>
  );
}

function Centered({ children }) {
  return <main className="centered">{children}</main>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  };
  return (
    <Centered>
      <h1>Smiler Admin</h1>
      <form onSubmit={submit} className="login">
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button type="submit" className="primary">Sign in</button>
        {error && <p className="error">{error}</p>}
      </form>
    </Centered>
  );
}
