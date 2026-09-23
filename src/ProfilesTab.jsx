import React, {useEffect,useState} from "react";
import * as api from "./lib/client.js";
import { ROLE_DEFS } from "../shared/permissions.js";

const EMPTY={display_name:"",username:"",role:"planner",password:""};
const niceDate=value=>value?new Date(value).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"Never";

export default function ProfilesTab(){
  const [profiles,setProfiles]=useState([]),[draft,setDraft]=useState(EMPTY),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const load=async()=>{try{setProfiles(await api.listProfiles());}catch(e){setMessage(e.message||String(e));}};
  useEffect(()=>{load();},[]);
  async function create(){
    setBusy(true);setMessage("");
    try{await api.createProfile(draft);setDraft(EMPTY);await load();setMessage("Profile created.");}
    catch(e){setMessage(e.message||String(e));}finally{setBusy(false);}
  }
  async function toggle(profile){
    setBusy(true);setMessage("");
    try{await api.setProfileActive(profile.username,!profile.active);await load();}
    catch(e){setMessage(e.message||String(e));}finally{setBusy(false);}
  }
  const set=(key,value)=>setDraft(d=>({...d,[key]:value}));
  return <div className="space-y-4">
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-800">Profiles & access</div>
        <p className="text-xs text-slate-500 mt-1">Create the factory's named logins and give each one an existing access role.</p></div>
        <div className="rounded-lg bg-indigo-50 text-indigo-800 px-3 py-2 text-xs"><b className="mono">{profiles.length} / 11</b> profiles created</div></div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4 items-end">
        <Field label="Person's name" value={draft.display_name} onChange={v=>set("display_name",v)} />
        <Field label="Username" value={draft.username} onChange={v=>set("username",v.toLowerCase())} />
        <label className="text-xs text-slate-600">Access role<select value={draft.role} onChange={e=>set("role",e.target.value)} className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 bg-white text-sm">
          {Object.entries(ROLE_DEFS).map(([key,def])=><option key={key} value={key}>{def.label}</option>)}</select></label>
        <Field label="Temporary password" type="password" value={draft.password} onChange={v=>set("password",v)} />
      </div>
      <div className="flex items-center gap-3 mt-3"><button disabled={busy||!draft.display_name||!draft.username||draft.password.length<8} onClick={create} className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{busy?"Saving…":"Create profile"}</button>
        <span className="text-[11px] text-slate-500">The person can change this temporary password after signing in.</span></div>
      {message&&<div className="text-xs text-slate-600 mt-3">{message}</div>}
    </section>
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
      <table className="w-full text-xs" style={{minWidth:720}}><thead><tr className="sign text-slate-500">
        <th className="text-left py-2">Name</th><th className="text-left">Username</th><th className="text-left">Role</th><th className="text-left">Last sign-in</th><th className="text-left">Status</th><th></th>
      </tr></thead><tbody>{profiles.map(profile=><tr key={profile.username} className="border-t border-slate-100">
        <td className="py-2 font-semibold">{profile.display_name||profile.username}</td><td className="mono">{profile.username}</td><td>{ROLE_DEFS[profile.role]?.label||profile.role}</td><td>{niceDate(profile.last_login_at)}</td>
        <td><span className={profile.active?"text-emerald-700":"text-slate-400"}>{profile.active?"Active":"Inactive"}</span></td>
        <td className="text-right"><button disabled={busy} onClick={()=>toggle(profile)} className="text-indigo-700 font-semibold hover:underline">{profile.active?"Deactivate":"Reactivate"}</button></td>
      </tr>)}</tbody></table>
    </section>
  </div>;
}

function Field({label,value,onChange,type="text"}){return <label className="text-xs text-slate-600">{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 bg-white text-sm"/></label>;}

