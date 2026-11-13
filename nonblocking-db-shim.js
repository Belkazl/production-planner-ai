// LiftOrbit — queue for the original planner's localStorage persistence shim.
// Runs INSIDE the original shim's IIFE and uses its snap()/initializing vars.
// All writes are asynchronous, serialized, coalesced and server-confirmed.
var ppPendingSave=false,ppSaving=false,ppSaveTimer=null,ppSaveRetries=0;
var ppNativeFetch=window.fetch.bind(window);
var ppWriteQueue=Promise.resolve(),ppCurrentSave=Promise.resolve();

function ppEnqueueWrite(callback){
  var job=ppWriteQueue.then(callback);
  // A failed write must not permanently break the queue.
  ppWriteQueue=job.then(()=>{},()=>{});
  return job;
}
function ppScheduleSave(delay){
  if(ppSaveTimer||ppSaving||!ppPendingSave)return;
  ppSaveTimer=setTimeout(()=>{
    ppSaveTimer=null;
    ppFlushSave().catch(()=>{});
  },delay);
}
function sync(){
  if(initializing)return;
  ppPendingSave=true;
  ppScheduleSave(250);
}
function ppFlushSave(){
  if(ppSaveTimer){clearTimeout(ppSaveTimer);ppSaveTimer=null;}
  if(ppSaving)return ppCurrentSave;
  if(!ppPendingSave)return Promise.resolve();
  ppPendingSave=false;
  ppSaving=true;
  // Snapshot is captured at start; later edits mark the queue dirty again.
  var payload=JSON.stringify({storage:snap()});
  var permanentlyUnauthorized=false;
  var save=ppEnqueueWrite(()=>
    ppNativeFetch("/api/db-storage",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json"},body:payload
    })
  ).then(r=>{
    if(!r.ok){
      permanentlyUnauthorized=r.status===401||r.status===403;
      throw Error("db_storage_save_"+r.status);
    }
    ppSaveRetries=0;
  }).catch(e=>{
    if(!permanentlyUnauthorized){
      ppPendingSave=true;
      ppSaveRetries=Math.min(ppSaveRetries+1,5);
    }
    console.error("DB asynchronous persistence failed",e);
    throw e;
  }).finally(()=>{
    ppSaving=false;
    if(ppPendingSave)ppScheduleSave(ppSaveRetries?Math.min(15000,1000*Math.pow(2,ppSaveRetries)):200);
  });
  ppCurrentSave=save;
  // Automatic writes have no caller to await; keep the promise handled.
  save.catch(()=>{});
  return save;
}
async function ppWaitForSaves(){
  if(ppSaveTimer){clearTimeout(ppSaveTimer);ppSaveTimer=null;}
  if(ppSaving)await ppCurrentSave;
  if(ppPendingSave)await ppFlushSave();
  await ppWriteQueue;
}

// Read-after-write confirmation and explicit POSTs must stay in order.
window.fetch=function(input,options){
  var url;
  try{
    url=new URL(typeof input==="string"?input:input.url,location.href);
  }catch(_){return ppNativeFetch(input,options);}
  if(url.origin!==location.origin)return ppNativeFetch(input,options);
  var method=String((options&&options.method)||(input&&typeof input==="object"&&input.method)||"GET").toUpperCase();
  if(url.pathname==="/api/db-storage"){
    if(method==="GET")return ppWaitForSaves().then(()=>ppNativeFetch(input,options));
    if(method==="POST")return ppWaitForSaves().then(()=>ppEnqueueWrite(()=>ppNativeFetch(input,options)));
  }
  if(url.pathname==="/api/auth/logout"&&method==="POST"){
    return ppWaitForSaves().then(()=>ppNativeFetch(input,options));
  }
  return ppNativeFetch(input,options);
};
window.__PP_ASYNC_DB_SYNC__=true;