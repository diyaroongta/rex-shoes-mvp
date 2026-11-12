import React, {useEffect,useState} from "react";
import * as api from "./lib/client.js";
import { RECOMMENDED_USER_COUNTS, ROLE_DEFS, ROLES, rolesOf } from "../shared/permissions.js";

/* An account may hold several roles and does whatever any of them may do. */
const EMPTY={display_name:"",username:"",roles:[],password:""};
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
  async function update(username,change,done){
    setBusy(true);setMessage("");
    try{await api.updateProfile(username,change);await load();setMessage(done);return true;}
    catch(e){setMessage(e.message||String(e));return false;}finally{setBusy(false);}
  }
  const set=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const activeByRole=profiles.filter(profile=>profile.active).reduce((out,profile)=>{
    for(const role of rolesOf(profile.role)) out[role]=(out[role]||0)+1;
    return out;
  },{});
  const recommendedTotal=Object.values(RECOMMENDED_USER_COUNTS).reduce((sum,count)=>sum+count,0);
  const filled=Object.entries(RECOMMENDED_USER_COUNTS)
    .reduce((sum,[role,target])=>sum+Math.min(target,activeByRole[role]||0),0);
  return <div className="space-y-4">
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-slate-800">Profiles & access</div>
        <p className="text-xs text-slate-500 mt-1">Create the factory's named logins and tick every access role each one needs. A login with several roles can do whatever any of them allows.</p></div>
        <div className="rounded-lg bg-indigo-50 text-indigo-800 px-3 py-2 text-xs"><b className="mono">{filled} / {recommendedTotal}</b> recommended seats filled</div></div>
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs" style={{minWidth:760}}><thead><tr className="sign text-slate-500">
          <th className="text-left py-2">Recommended role</th><th className="text-left">What this role does</th>
          <th className="text-right">Suggested</th><th className="text-right">Active</th><th className="text-left pl-4">Status</th>
        </tr></thead><tbody>{Object.entries(RECOMMENDED_USER_COUNTS).map(([role,target])=>{
          const active=activeByRole[role]||0,remaining=Math.max(0,target-active);
          return <tr key={role} className="border-t border-slate-100">
            <td className="py-2 font-semibold">{ROLE_DEFS[role].label}</td><td className="text-slate-500 pr-4">{ROLE_DEFS[role].summary}</td>
            <td className="mono text-right">{target}</td><td className="mono text-right">{active}</td>
            <td className={`pl-4 font-semibold ${remaining?'text-amber-700':'text-emerald-700'}`}>{remaining?`${remaining} still to create`:'Complete'}</td>
          </tr>;
        })}</tbody></table>
      </div>
      <div className="border-t border-slate-100 mt-4 pt-4">
        <div className="text-xs font-semibold text-slate-700 mb-2">Create a named login</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 items-end">
        <Field label="Person's name" value={draft.display_name} onChange={v=>set("display_name",v)} />
        <Field label="Username" value={draft.username} onChange={v=>set("username",v.toLowerCase())} />
        <Field label="Temporary password" type="password" value={draft.password} onChange={v=>set("password",v)} />
      </div>
      <div className="text-xs text-slate-600 mt-3">Access roles <span className="text-slate-400">(tick one or more)</span></div>
      <RolePicker value={draft.roles} onChange={v=>set("roles",v)} />
      <div className="flex items-center gap-3 mt-3"><button disabled={busy||!draft.display_name||!draft.username||draft.password.length<8||!draft.roles.length} onClick={create} className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50">{busy?"Saving…":"Create profile"}</button>
        <span className="text-[11px] text-slate-500">The person can change this temporary password after signing in.</span></div>
      {message&&<div className="text-xs text-slate-600 mt-3">{message}</div>}
      </div>
    </section>
    <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm overflow-x-auto">
      <table className="w-full text-xs" style={{minWidth:720}}><thead><tr className="sign text-slate-500">
        <th className="text-left py-2">Name</th><th className="text-left">Username</th><th className="text-left">Access</th><th className="text-left">Last sign-in</th><th className="text-left">Status</th><th></th>
      </tr></thead><tbody>{profiles.map(profile=><ProfileRow key={profile.username} profile={profile} busy={busy}
        onToggle={()=>toggle(profile)} onUpdate={(change,done)=>update(profile.username,change,done)} />)}</tbody></table>
      <p className="text-[11px] text-slate-500 mt-3">Passwords are stored only as a one-way hash, so nobody — a Master included — can read one back. Use <b>Reset password</b> to give a person a new temporary one; it also clears a lockout. A changed role applies at that person's next sign-in.</p>
    </section>
  </div>;
}

function RolePicker({value,onChange}){
  const on=new Set(value);
  const flip=key=>onChange(ROLES.filter(r=>r===key?!on.has(r):on.has(r)));
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">{ROLES.map(key=>
    <label key={key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer ${on.has(key)?"border-indigo-400 bg-indigo-50":"border-slate-200 bg-white"}`}>
      <input type="checkbox" checked={on.has(key)} onChange={()=>flip(key)} className="mt-0.5" />
      <span><b className="text-slate-800">{ROLE_DEFS[key].label}</b><span className="block text-slate-500">{ROLE_DEFS[key].summary}</span></span>
    </label>)}</div>;
}

function ProfileRow({profile,busy,onToggle,onUpdate}){
  const [mode,setMode]=useState(null),[roles,setRoles]=useState([]),[password,setPassword]=useState("");
  const current=rolesOf(profile.role);
  const close=()=>{setMode(null);setPassword("");};
  return <>
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 font-semibold">{profile.display_name||profile.username}</td><td className="mono">{profile.username}</td>
      <td>{current.map(r=><span key={r} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{ROLE_DEFS[r]?.label||r}</span>)}</td>
      <td>{niceDate(profile.last_login_at)}</td>
      <td><span className={profile.active?"text-emerald-700":"text-slate-400"}>{profile.active?"Active":"Inactive"}</span></td>
      <td className="text-right whitespace-nowrap space-x-3">
        <button disabled={busy} onClick={()=>{setRoles(current);setMode(mode==="roles"?null:"roles");}} className="text-indigo-700 font-semibold hover:underline">Change access</button>
        <button disabled={busy} onClick={()=>setMode(mode==="password"?null:"password")} className="text-indigo-700 font-semibold hover:underline">Reset password</button>
        <button disabled={busy} onClick={onToggle} className="text-indigo-700 font-semibold hover:underline">{profile.active?"Deactivate":"Reactivate"}</button>
      </td>
    </tr>
    {mode==="roles"&&<tr><td colSpan={6} className="pb-3">
      <RolePicker value={roles} onChange={setRoles} />
      <div className="flex gap-3 mt-2"><button disabled={busy||!roles.length} onClick={async()=>{if(await onUpdate({roles},`Access changed for ${profile.username}.`))close();}}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50">Save access</button>
        <button onClick={close} className="text-xs text-slate-600">Cancel</button></div>
    </td></tr>}
    {mode==="password"&&<tr><td colSpan={6} className="pb-3">
      <div className="flex items-end gap-3 max-w-md"><Field label={`New temporary password for ${profile.username}`} type="password" value={password} onChange={setPassword} />
        <button disabled={busy||password.length<8} onClick={async()=>{if(await onUpdate({password},`Password reset for ${profile.username}. Give them the new temporary password.`))close();}}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50 whitespace-nowrap">Set password</button>
        <button onClick={close} className="text-xs text-slate-600 pb-2">Cancel</button></div>
    </td></tr>}
  </>;
}

function Field({label,value,onChange,type="text"}){return <label className="text-xs text-slate-600">{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} className="block mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 bg-white text-sm"/></label>;}
