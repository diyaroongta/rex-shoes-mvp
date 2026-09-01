import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Login from "./Login.jsx";
import { hydrate } from "./lib/refdata.js";
import * as api from "./lib/client.js";
import "./index.css";

/* Startup order matters, and it is the reverse of what it used to be.
   Reference data is fetched BEFORE the first render so the app never paints
   with the bundled seed and then jumps to the real article list — but that
   fetch now needs a session, so the sign-in check comes first. */
function Root(){
  const [user, setUser] = useState(null);
  const [phase, setPhase] = useState("checking");   // checking | login | loading | ready | failed
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(async signedInAs => {
    setPhase("loading");
    try{ await hydrate(); setUser(signedInAs); setPhase("ready"); }
    catch(e){
      /* The session can be refused between signing in and loading — an expired
         cookie, or another tab signing out. That is a login prompt, not the
         "could not start safely" screen. */
      if(e && e.name === "NotSignedIn"){ setNotice("Your session has ended. Sign in again."); setPhase("login"); }
      else { setError(e); setPhase("failed"); }
    }
  }, []);

  useEffect(()=>{ (async()=>{
    try{
      const who = await api.whoAmI();
      if(who && who.authenticated) return load(who.user);
      setPhase("login");
    }catch(e){ setError(e); setPhase("failed"); }
  })(); },[load]);

  /* A tab left open past the twelve-hour session shows the login box, not a
     wall of 401s from the one-minute background refresh. */
  useEffect(()=>api.onSignedOut(()=>{
    setUser(null);
    setNotice("Your session has ended. Sign in again.");
    setPhase("login");
  }),[]);

  const signOut = useCallback(async()=>{
    try{ await api.signOut(); }catch(_){ /* the cookie is going either way */ }
    setUser(null); setNotice("You are signed out."); setPhase("login");
  },[]);

  if(phase === "checking" || phase === "loading")
    return <Splash label={phase === "checking" ? "Checking your session…" : "Loading the article master…"} />;

  if(phase === "login")
    return <Login notice={notice} onSignedIn={u=>{ setNotice(""); load(u); }} />;

  if(phase === "failed") return <StartupError error={error} />;

  return <App user={user} onSignOut={signOut} />;
}

function Splash({ label }){
  return (
    <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
                  background:"#0F2237",color:"#9FB3C8",fontFamily:"system-ui",fontSize:13.5}}>
      {label}
    </main>
  );
}

function StartupError({ error }){
  return (
    <main style={{fontFamily:"system-ui",maxWidth:720,margin:"64px auto",padding:24}}>
      <h1 style={{fontSize:22}}>Factory OS could not start safely</h1>
      <p>The live article master, BOM and packing rules could not be loaded. No orders have been opened with fallback data.</p>
      <pre style={{whiteSpace:"pre-wrap",background:"#fff1f2",padding:12,borderRadius:8,color:"#9f1239"}}>
        {String((error && error.message) || error)}
      </pre>
      <button onClick={()=>location.reload()} style={{padding:"8px 14px"}}>Retry</button>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
