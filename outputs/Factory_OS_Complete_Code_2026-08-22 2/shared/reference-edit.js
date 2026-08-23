export const SOLE_TYPES=["PVC","PU","EVA","STUCK-ON"];

/* Changing sole type changes the physical route too. Keeping that invariant in
   one pure helper prevents a catalogue edit from leaving STUCK-ON on a molding
   machine, or a molded sole on the stuck-on assembly line. */
export function routingForSole(routing,soleType){
  const process=soleType==="STUCK-ON"?"ASSEMBLY":"MOLDING";
  const source=Array.isArray(routing)?routing:[];
  const out=[];
  let inserted=false;
  for(const stage of source){
    if(stage==="MOLDING"||stage==="ASSEMBLY"){
      if(!inserted){out.push(process);inserted=true;}
    }else out.push(stage);
  }
  if(!inserted){
    const before=out.indexOf("PACKING");
    out.splice(before>=0?before:out.length,0,process);
  }
  return out;
}
