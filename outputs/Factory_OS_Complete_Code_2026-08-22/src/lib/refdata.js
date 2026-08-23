/* Live reference data.
   REF starts as a copy of the bundled seed and is MUTATED IN PLACE once the
   database answers. Everything already holding a reference to it — every
   INPUTS.articles[...] read in App.jsx — therefore sees the real data without
   any of those call sites changing. */
import { INPUTS as SEED } from "../../shared/inputs.js";
import { setReference } from "../../shared/bridge.js";
import * as api from "./client.js";

export const REF = JSON.parse(JSON.stringify(SEED));
export let catalogue = {};
export let source = "bundled";     // "bundled" until the database answers

function replace(target, next){
  for(const k of Object.keys(target)) delete target[k];
  Object.assign(target, next);
}

export async function hydrate(){
  try{
    const [ref, cat] = await Promise.all([
      api.getReference(),
      api.getCatalogue().catch(() => ({})),
    ]);
    if(ref && ref.articles && Object.keys(ref.articles).length){
      replace(REF, ref);
      source = "database";
    }
    catalogue = cat || {};
  }catch(e){
    // Offline or the schema isn't applied yet — the bundled seed still works,
    // so the app opens rather than showing a blank screen.
    source = "bundled";
    console.warn("reference data: using the bundled seed —", e.message);
  }
  setReference(REF);        // keep the reader's vocabulary in step
  return REF;
}

export async function reload(){ return hydrate(); }
