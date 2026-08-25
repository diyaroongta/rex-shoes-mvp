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
    // Production must never continue on a different, bundled article master:
    // it can accept an order with yesterday's BOM or packing rule. Let startup
    // show a blocking error instead of turning a database outage into bad PIs.
    source = "error";
    throw new Error(`Could not load the live article master: ${e.message||e}`);
  }
  setReference(REF);        // keep the reader's vocabulary in step
  return REF;
}

export async function reload(){ return hydrate(); }
