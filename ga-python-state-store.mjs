// Private QA PostgreSQL state API client. No production fallback and no credentials in code.
export function createGAStateStore({enabled=false,origin="",token="",fetchImpl=fetch}={}){
 if(!enabled)return null;
 if(!/^http:\/\/[a-z0-9-]+\.railway\.internal:\d+$/.test(String(origin)))throw Error("qa_state_private_origin_required");
 if(typeof token!=="string"||token.length<32)throw Error("qa_state_token_required");
 const req=async(path,method="GET",body)=>{
  const r=await fetchImpl(origin+path,{method,
   headers:{"authorization":"Bearer "+token,"accept":"application/json",...(body?{"content-type":"application/json"}:{})},
   body:body?JSON.stringify(body):undefined,redirect:"manual",cache:"no-store",
   signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>({}));
  if(r.status!==200||!data.ok)throw Error("qa_state_api_unavailable");
  return data;
 };
 return {
  async load(accountId){
   if(!/^[0-9a-f-]{36}$/.test(String(accountId)))throw Error("qa_state_account_required");
   return (await req("/internal/ga-state?account_id="+encodeURIComponent(accountId))).state;
  },
  async save(accountId,state){
   if(!/^[0-9a-f-]{36}$/.test(String(accountId)))throw Error("qa_state_account_required");
   if(!state||!/^[0-9a-f]{32}$/.test(String(state.id)))throw Error("qa_state_job_required");
   return req("/internal/ga-state","POST",{account_id:accountId,job_id:state.id,
     model_hash:state.modelKey,status:state.state,progress:state.progress||0,
     best_preview:state.best||null,result:state.result||null,
     resume_state:state.resume_state||null,error:state.error||null});
  }
 };
}
