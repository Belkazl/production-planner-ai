import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=process.argv[2];
if(!root)throw Error("GA_PROGRESS_PATCH_ROOT_REQUIRED");
const file=resolve(root,"baselines/2026-10-10/aps-setup-bridge/index.ts");
let source=readFileSync(file,"utf8");
const old="async function progress(req){";
const tail="  data.objective=goal;\n  data.aps_setup_bridge=REV;";
if(source.split(old).length!==2||source.split(tail).length!==2)throw Error("GA_PROGRESS_PATCH_SOURCE_DRIFT");
if(source.includes("ppReconcileSetupAwareTerminal"))throw Error("GA_PROGRESS_PATCH_ALREADY_PRESENT");
const helper="function ppReconcileSetupAwareTerminal(data,model){\n if(!data?.success||data.running||!Array.isArray(data.result?.operations)||\n    !data.result.operations.length||!Array.isArray(model?.setup_rules)||\n    !model.setup_rules.length)return false;\n const native=data.result,selected=data.best_preview;\n if(!selected||selected.valid===false||selected.partial===true||\n    !Array.isArray(selected.operations)||!selected.operations.length)return false;\n const isSetup=op=>op?.is_setup===true||\n    String(op?.phase||\"\").toLowerCase()===\"setup\"||\n    String(op?.type||\"\").toLowerCase()===\"setup\";\n const production=native.operations.filter(op=>!isSetup(op)).length;\n const selectedProduction=selected.operations.filter(op=>!isSetup(op)).length;\n const nativeSetup=native.operations.filter(isSetup).length;\n const completeSetup=selected.operations.filter(isSetup).length;\n if(nativeSetup!==0||completeSetup<1||selectedProduction!==production)return false;\n if(!ppAccountPlanBelongsToModel(selected,model))return false;\n const resume=native.resume_state??selected.resume_state??null;\n const final={...native,...selected,valid:true,\n    resume_state:resume,setup_operation_count:completeSetup,\n    optimization_termination_reason:\"reconciled_setup_aware_final\",\n    optimization_account_check_recovered:true};\n data.result=final;\n data.best_preview=final;\n if(resume!=null)data.resume_state=resume;\n console.warn(\"PP_GA_FINAL_SETUP_OPERATIONS_RECONCILED\",\n    \"production=\"+production,\"setups=\"+completeSetup);\n return true;\n}";
source=source.replace(old,helper+"\n"+old);
source=source.replace(tail,"  ppReconcileSetupAwareTerminal(data,model);\n"+tail);
if(source.split("function ppReconcileSetupAwareTerminal(").length!==2||
   source.split("ppReconcileSetupAwareTerminal(data,model);").length!==2)
  throw Error("GA_PROGRESS_PATCH_POSTCONDITION");
writeFileSync(file,source);
console.log("PP_GA_PROGRESS_FINAL_RECONCILIATION_PATCHED",source.length);
