import React, { useState } from "react";
import * as api from "./lib/client.js";

/* The sign-in screen. It is the first thing the app renders and the only
   screen reachable without a session.

   Deliberately plain: the browser's own password manager should recognise the
   fields, so they are a real <form> with the standard autocomplete names. */
export default function Login({ onSignedIn, notice }){
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [setup, setSetup] = useState(false);

  async function submit(e){
    e.preventDefault();
    if(busy) return;
    setBusy(true); setErr(""); setSetup(false);
    try{
      const out = await api.signIn(username, password);
      setPassword("");                       // never left sitting in component state
      onSignedIn(out.user);
    }catch(e){
      /* The server's message is the useful one — it distinguishes a wrong
         password from a locked account from an unconfigured deployment. Strip
         the leading status code the client puts on non-401 errors. */
      const message = String(e.message || e).replace(/^\d{3}\s*—\s*/, "");
      setErr(message);
      /* A setup fault is not a wrong password, and telling them apart is the
         difference between "ask whoever deployed this" and an afternoon spent
         resetting an account that was never broken. */
      setSetup(/AUTH_SECRET|No accounts exist yet|schema/i.test(message));
      setPassword("");
    }finally{ setBusy(false); }
  }

  return (
    <main style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
                  background:"#0F2237",padding:20,
                  fontFamily:"ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"}}>
      <form onSubmit={submit} style={{width:"100%",maxWidth:380,background:"#fff",borderRadius:14,
                                      padding:"30px 28px",boxShadow:"0 18px 50px rgba(0,0,0,.35)"}}>
        <div style={{fontSize:22,fontWeight:700,letterSpacing:"-.01em",color:"#0F2237"}}>Factory OS</div>
        <div style={{fontSize:13,color:"#6B7C90",marginTop:3,marginBottom:22}}>
          {notice || "Sign in to continue"}
        </div>

        <label style={LABEL} htmlFor="username">Username</label>
        <input id="username" name="username" value={username} autoComplete="username"
               autoFocus autoCapitalize="none" autoCorrect="off" spellCheck="false"
               onChange={e=>setUsername(e.target.value)} style={INPUT} />

        <label style={{...LABEL,marginTop:14}} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" value={password}
               autoComplete="current-password"
               onChange={e=>setPassword(e.target.value)} style={INPUT} />

        {err && (
          <div role="alert"
               style={{marginTop:14,padding:"9px 11px",borderRadius:8,fontSize:12.5,
                       background: setup ? "#FFFBEB" : "#FFF1F2",
                       border: `1px solid ${setup ? "#FDE68A" : "#FECDD3"}`,
                       color: setup ? "#92400E" : "#9F1239"}}>
            {setup && <strong style={{display:"block",marginBottom:3}}>This portal is not set up yet</strong>}
            {err}
            {setup && (
              <span style={{display:"block",marginTop:5,opacity:.85}}>
                This is not a problem with your password — nothing you type here will work
                until the person who deployed the app fixes it.
              </span>
            )}
          </div>
        )}

        <button type="submit" disabled={busy || !username || !password}
                style={{...BUTTON, opacity: busy || !username || !password ? .55 : 1}}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div style={{fontSize:11.5,color:"#8A9AAC",marginTop:16,lineHeight:1.5}}>
          Accounts are issued by the administrator. There is no self sign-up and
          no password reset by email — ask for a reset if you are locked out.
        </div>
      </form>
    </main>
  );
}

const LABEL  = {display:"block",fontSize:12,fontWeight:600,color:"#33465C",marginBottom:5};
const INPUT  = {width:"100%",boxSizing:"border-box",padding:"9px 11px",fontSize:14,
                border:"1px solid #CBD5E1",borderRadius:8,outlineColor:"#0B6BCB",background:"#fff"};
const BUTTON = {width:"100%",marginTop:20,padding:"10px 14px",fontSize:14,fontWeight:600,
                color:"#fff",background:"#0B6BCB",border:"none",borderRadius:8,cursor:"pointer"};
