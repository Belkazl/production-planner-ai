import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];if(!root)throw Error("JSONB_GA_STATE_APP_ROOT_REQUIRED");
const path=resolve(root,"ga-python-state-store.mjs");
let s=readFileSync(path,"utf8");
const anchor='   return (await req("/internal/ga-state?account_id="+encodeURIComponent(accountId))).state;';
const replacement=`    const state=(await req("/internal/ga-state?account_id="+encodeURIComponent(accountId))).state;
    if(!state||typeof state!=="object"||Array.isArray(state))return null;
    // Depending on the auth gateway JSONB driver version, large plan
    // objects may be returned as JSON text rather than decoded objects.
    // Decode only bounded objects. Ownership/model validation remains
    // mandatory in the caller; no account identifiers are changed.
    const parsed=(value)=>{
      if(value==null)return null;
      if(typeof value==="object"&&!Array.isArray(value))return value;
      if(typeof value!=="string"||value.length>18000000)return null;
      try{
        const decoded=JSON.parse(value);
        return decoded&&typeof decoded==="object"&&!Array.isArray(decoded)?decoded:null;
      }catch{return null}
    };
    return {...state,best_preview:parsed(state.best_preview),
      result:parsed(state.result),resume_state:parsed(state.resume_state)};`;
if(s.split(anchor).length!==2)throw Error("GA_JSONB_STATE_READ_ANCHOR_CHANGED");
if(!s.includes("qa_state_account_required")||!s.includes("validJob"))throw Error("GA_JSONB_AUTH_GUARD_MISSING");
writeFileSync(path,s.replace(anchor,replacement));
console.log("GA_JSONB_STATE_OBJECT_DECODING_PATCHED");
