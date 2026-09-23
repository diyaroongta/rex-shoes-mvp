import React,{useState} from "react";
import * as api from "./lib/client.js";

/* Available to every signed-in person. The server requires the current
   password, so an unattended logged-in workstation cannot silently take over
   the account. */
export default function ChangePassword(){
  const [open,setOpen]=useState(false);
  const [current,setCurrent]=useState(""),[next,setNext]=useState(""),[confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");

  function close(){setOpen(false);setCurrent("");setNext("");setConfirm("");setError("");}
  async function save(e){
    e.preventDefault();setError("");setMessage("");
    if(next.length<8){setError("The new password must be at least 8 characters.");return;}
    if(next!==confirm){setError("The two new-password entries do not match.");return;}
    if(current===next){setError("Choose a password different from the temporary password.");return;}
    setBusy(true);
    try{await api.changePassword(current,next);close();setMessage("Password changed");}
    catch(e){setError(String(e.message||e).replace(/^\d{3}\s*—\s*/,""));}
    finally{setBusy(false);}
  }

  return <>
    <button onClick={()=>{setOpen(true);setMessage("");}} title="Change your password"
      style={{padding:"5px 10px",fontSize:12,fontWeight:600,color:"#33465C",background:"#fff",
              border:"1px solid #CBD5E1",borderRadius:7,cursor:"pointer"}}>
      {message||"Change password"}
    </button>
    {open&&<div role="dialog" aria-modal="true" aria-label="Change password"
      style={{position:"fixed",inset:0,zIndex:80,background:"rgba(15,34,51,.46)",display:"grid",placeItems:"center",padding:20}}>
      <form onSubmit={save} style={{width:"100%",maxWidth:420,background:"#fff",borderRadius:14,padding:22,
                                    boxShadow:"0 20px 60px rgba(15,34,51,.3)"}}>
        <div style={{fontSize:17,fontWeight:700,color:"#0F2233"}}>Change password</div>
        <div style={{fontSize:12,color:"#6B7C90",marginTop:4,marginBottom:16}}>
          Replace the temporary password with one only you know.
        </div>
        <PasswordField label="Current or temporary password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error&&<div role="alert" style={{fontSize:12,color:"#9F1239",background:"#FFF1F2",border:"1px solid #FECDD3",
                                          padding:"8px 10px",borderRadius:7,marginTop:12}}>{error}</div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16}}>
          <button type="button" disabled={busy} onClick={close}
            style={{padding:"7px 12px",fontSize:12,fontWeight:600,border:"1px solid #CBD5E1",borderRadius:7,background:"#fff"}}>Cancel</button>
          <button type="submit" disabled={busy||!current||!next||!confirm}
            style={{padding:"7px 12px",fontSize:12,fontWeight:600,border:"none",borderRadius:7,background:"#0B6BCB",color:"#fff",
                    opacity:(busy||!current||!next||!confirm)?0.55:1}}>{busy?"Changing…":"Change password"}</button>
        </div>
      </form>
    </div>}
  </>;
}

function PasswordField({label,value,onChange,autoComplete}){
  return <label style={{display:"block",fontSize:12,fontWeight:600,color:"#33465C",marginTop:11}}>{label}
    <input type="password" value={value} onChange={e=>onChange(e.target.value)} autoComplete={autoComplete}
      style={{display:"block",width:"100%",boxSizing:"border-box",marginTop:5,padding:"8px 10px",fontSize:13,
              border:"1px solid #CBD5E1",borderRadius:7}} />
  </label>;
}
