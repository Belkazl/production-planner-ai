// Minimal, source-pinned V4 transition repair. Keeps the native optimizer,
// percent source, Stop handling, manual edits and Gantt intact.
export function patchTransitionV5(source){
 const changes = [
  [`function finishOverlay(number){`,`function showPendingInsideButton(){
 if(!button?.isConnected)return;
 const number=clamp(shown==null?0:shown);
 button.classList.remove("pp-ga-v4-final");
 button.classList.add("pp-ga-v4-busy");
 button.setAttribute("data-pp-ga-v4-label",
  (prefix.trim()||(isRu()?"Оптимизация":"Optimization"))+" "+number+"%");
 button.setAttribute("aria-valuenow",String(number));
}
function finishOverlay(number){`],
  [`  if(button.classList.contains("pp-ga-v4-final")&&!finalDone)restoreButton();`,
   `  if(!finalDone){finishing=false;restoreButton()}`],
  [`  }else if(!finalDone){restoreButton()}`,
   `  }else if(!finalDone){finishing=false;restoreButton()}`],
  [` restoreDisabled=button.disabled;
 if(!instant)button.disabled=true;`,` if(restoreDisabled===null)restoreDisabled=button.disabled;
 if(!instant)button.disabled=true;`],
  [`  if((p.phase==="running"||p.phase==="queued")&&attempts<5&&isContinue()){`,`  if((p.phase==="running"||p.phase==="queued")&&attempts<30&&isContinue()){`],
  [`    retryTimer=setTimeout(()=>{retryTimer=null;void verify(token,instant)},1400*attempts);`,`    retryTimer=setTimeout(()=>{retryTimer=null;void verify(token,instant)},Math.min(3000,1000+attempts*200));`],
  [`function end(){
 if(!wasRunning)return;
 wasRunning=false;
 button?.removeAttribute("aria-busy");
 initialChecked=true;
 const id=++version;
 // Native app may replace its label with Continue before the last
 // worker result is durable. Confirm first; then visibly finish to 100.
 void verify(id,false);
}`,
   `function end(){
 if(!wasRunning)return;
 wasRunning=false;
 button?.removeAttribute("aria-busy");
 initialChecked=true;
 // Cancellation, Stop, or an error is never treated as a completed run.
 if(!isContinue()){reset();initialChecked=true;return}
 const id=++version;
 // Hide the native Continue label immediately, in the very same DOM turn.
 // The button remains blocked until the real terminal status is verified
 // AND the one-percent animation has visibly reached 100.
 finishing=true;finalDone=false;
 restoreDisabled=button.disabled;
 button.disabled=true;
 showPendingInsideButton();
 void verify(id,false);
}`]
 ];
 let output=source;
 for(const [oldValue,newValue] of changes){
  if(output.split(oldValue).length!==2)throw Error("GA_V5_SOURCE_DRIFT_OR_AMBIGUOUS_ANCHOR_"+oldValue.slice(0,45));
  output=output.replace(oldValue,newValue);
 }
 if(!output.includes("showPendingInsideButton()")||!output.includes("if(!isContinue()){reset();initialChecked=true;return}")||!output.includes("attempts<30&&isContinue()"))
  throw Error("GA_V5_GUARD_MISSING");
 return output;
}
