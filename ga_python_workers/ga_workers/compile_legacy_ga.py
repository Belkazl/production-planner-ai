"""Rebuild owner-supplied GA runtime from Railway code-only variables.

No credentials or database connections are accepted or required. This file
contains only a deterministic replay recipe; original private source remains
exclusively in Railway variables, never in GitHub.
"""
import ast
import base64
import gzip
import hashlib
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

SOURCE = Path('/tmp/production_planner.py')
DERIVED = Path('/tmp/pp_ga_runtime_patch_build')
COUNT_MAX = 64
DATA_KEYS = [
    'PP_GENERIC_CORE_B64','PP_REGEX_FIX_B64','PP_CAPACITY_GANTT_PATCH_B64',
    'PP_PARTIAL_MATERIAL_PATCH_B64','PP_PARSE_RESOURCE_REPAIR_B64',
    'PP_CLIENT_PROJECT_REPAIR_B64','PP_FREEZE_HOTFIX_B64',
    'PP_TECH_PROCESS_PATCH_B64','PP_ORDER_PROCESS_LINK_B64',
    'PP_REMOVE_LEGACY_DURATION_B64','PP_TIMING_PROFILE_V1_INSTALL',
    'PP_CAPACITY_BATCHING_PATCH_CODE','PP_CURRENT_FEATURES_PATCH_V1',
    'PP_GENERIC_GANTT_UI_B64','PP_SAVED_PLAN_RESUME_PATCH_CODE',
    'PP_SETUP_FINAL_PATCH_B64','PP_CAP_BATCH_BOOT_V2','PP_RESTORE_ETALON_BOOT_V1',
    'PP_START_CMD_GOOD'
]


def raw(name):
    value=os.getenv(name, '')
    if not value or value.startswith('${{'):
        raise RuntimeError('ga_missing_or_unresolved_code_variable:' + name)
    return value


def decode(name):
    value=raw(name)
    if name.endswith('_B64'):
        try:
            data=base64.b64decode(value,validate=True)
            try: data=gzip.decompress(data)
            except OSError: pass
            return data.decode('utf-8')
        except (ValueError,UnicodeDecodeError) as ex:
            raise RuntimeError('ga_invalid_code_variable:'+name) from ex
    return value


def verify_source():
    count=int(raw('PP_RUNTIME_SRC_COUNT'))
    if not 1<=count<=COUNT_MAX: raise RuntimeError('ga_source_count_invalid')
    fragments=[raw('PP_RUNTIME_SRC_%02d'%i) for i in range(1,count+1)]
    if any(not re.fullmatch(r'[A-Za-z0-9+/=]+',x) for x in fragments):
        raise RuntimeError('ga_invalid_source_chunk')
    data=base64.b64decode(''.join(fragments),validate=True)
    expected=raw('PP_PY_GA_SOURCE_SHA256').lower()
    actual=hashlib.sha256(data).hexdigest()
    if expected!=actual or not re.fullmatch(r'[0-9a-f]{64}',expected):
        raise RuntimeError('ga_source_hash_mismatch')
    if len(data)>3_000_000 or len(data)<100_000:
        raise RuntimeError('ga_source_size_invalid')
    data.decode('utf-8')
    ast.parse(data,filename='<recovered-base-ga>')
    SOURCE.write_bytes(data)


def code_env():
    # Never pass DATABASE_URL, secret API keys, host tokens or accounts to a
    # compilation process. All code runs in disposable file-only processes.
    return {'PATH':os.environ.get('PATH','/usr/bin:/bin'),
            'HOME':'/tmp','LANG':'C.UTF-8','PYTHONUNBUFFERED':'1',
            'PP_SELFTEST':'0','PP_AI_SMOKE':'0','AI_BOOT_SMOKE':'0',
            'PP_GENERIC_CORE_B64':raw('PP_GENERIC_CORE_B64'),
            'PP_PARTIAL_MATERIAL_PATCH_B64':raw('PP_PARTIAL_MATERIAL_PATCH_B64'),
            'PP_PARSE_RESOURCE_REPAIR_B64':raw('PP_PARSE_RESOURCE_REPAIR_B64'),
            'PP_CLIENT_PROJECT_REPAIR_B64':raw('PP_CLIENT_PROJECT_REPAIR_B64')}


def run_patch(name,script,*,cut=None,env=None):
    if cut:
        if cut not in script: raise RuntimeError('ga_patch_test_boundary_missing:'+name)
        script=script[:script.index(cut)]
    DERIVED.mkdir(mode=0o700,exist_ok=True)
    file=DERIVED/(name+'.py')
    file.write_text(script,encoding='utf-8')
    # Do not expose patch contents, even on an exception.
    cp=subprocess.run([sys.executable,'-I',str(file)],env=env or code_env(),
                      capture_output=True,text=True,timeout=45,cwd='/tmp')
    if cp.returncode:
        raise RuntimeError('ga_rebuild_patch_failed:'+name+':exit_'+str(cp.returncode)+
                           ':reason_'+re.sub(r'[^A-Za-z0-9_-]','_',(cp.stderr or cp.stdout)[-90:]))


def assemble_active_patch_chain():
    # The owner's active gateway transforms this boot template before
    # running it. Execute ONLY its string assembly (never its deploy command).
    config=code_env()
    config.update({
      'D_TIMING_INSTALL':raw('PP_TIMING_PROFILE_V1_INSTALL'),
      'CAP_BATCH_PATCH':raw('PP_CAPACITY_BATCHING_PATCH_CODE'),
      'PP_FREEZE_HOTFIX_B64':raw('PP_FREEZE_HOTFIX_B64'),
      'PP_TECH_PROCESS_PATCH_B64':raw('PP_TECH_PROCESS_PATCH_B64'),
      'PP_ORDER_PROCESS_LINK_B64':raw('PP_ORDER_PROCESS_LINK_B64'),
      'PP_REMOVE_LEGACY_DURATION_B64':raw('PP_REMOVE_LEGACY_DURATION_B64'),
      'PP_CURRENT_FEATURES_PATCH_V1':raw('PP_CURRENT_FEATURES_PATCH_V1'),
      'PP_ETALON_GENERIC_GANTT_UI_B64':raw('PP_GENERIC_GANTT_UI_B64'),
      'PP_ETALON_SAVED_PLAN_RESUME_PATCH_CODE':raw('PP_SAVED_PLAN_RESUME_PATCH_CODE')+'\n'+decode('PP_SETUP_FINAL_PATCH_B64'),
      'D_START_GOOD':raw('PP_START_CMD_GOOD'),
      'PP_CAP_BATCH_BOOT_V2':raw('PP_CAP_BATCH_BOOT_V2')
    })
    restore=raw('PP_RESTORE_ETALON_BOOT_V1')
    stop='exec(compile(x,"<pp_restore_etalon_v1>"'
    if stop not in restore: raise RuntimeError('ga_restoration_assembly_format_mismatch')
    # This source fragment only assembles strings in memory, and must not run
    # the real startup command, which would touch the legacy database.
    assembler=restore[:restore.index(stop)]
    # Run in a subprocess so its environment never contaminates our supervisor.
    prep='import os\n'+assembler+'\nprint("---SAFE_ASSEMBLY_START---")\nprint(x)\n'
    DERIVED.mkdir(mode=0o700,exist_ok=True)
    path=DERIVED/'compose_runtime.py'
    path.write_text(prep,encoding='utf-8')
    cp=subprocess.run([sys.executable,'-I',str(path)],env=config,
                      capture_output=True,text=True,timeout=20,cwd='/tmp')
    if cp.returncode:raise RuntimeError('ga_restore_assembly_failed')
    marker='---SAFE_ASSEMBLY_START---\n'
    if marker not in cp.stdout:raise RuntimeError('ga_assembly_output_missing')
    active=cp.stdout.split(marker,1)[1]
    stop='argv=shlex.split'
    if stop not in active:raise RuntimeError('ga_runtime_launcher_anchor_missing')
    active=active[:active.index(stop)]
    run_patch('compose_patch_scripts',active,env=config)
    timing=Path('/tmp/pp_timing_install.py')
    batches=Path('/tmp/pp_capacity_batching.py')
    if not timing.exists() or not batches.exists():raise RuntimeError('ga_derived_patch_missing')
    return timing.read_text(),batches.read_text()


def build():
    verify_source()
    # Never execute apt-get, psql, the old singleton HTTP listener, or tests
    # which read the shared database. Only replay deterministic source patches.
    argv=shlex.split(raw('PP_START_CMD_GOOD'))
    if argv[:2]!=['sh','-lc']:raise RuntimeError('ga_old_launcher_unexpected')
    blocks=argv[2].split(' && ')
    if len(blocks)<15:raise RuntimeError('ga_old_launcher_too_short')
    inline=shlex.split(blocks[4])
    if inline[:2]!=['python3','-c']:raise RuntimeError('ga_inline_patch_invalid')
    run_patch('01_base_inline',inline[2])
    run_patch('02_regex',decode('PP_REGEX_FIX_B64'))
    run_patch('03_material_and_repairs',decode('PP_CAPACITY_GANTT_PATCH_B64'))
    run_patch('04_freeze',decode('PP_FREEZE_HOTFIX_B64'),cut='os.environ["PP_SELFTEST"]="0"')
    run_patch('05_process',decode('PP_TECH_PROCESS_PATCH_B64'),cut='os.environ["PP_SELFTEST"]="0"')
    run_patch('06_order_process',decode('PP_ORDER_PROCESS_LINK_B64'),cut='os.environ["PP_SELFTEST"]="0"')
    run_patch('07_legacy_duration',decode('PP_REMOVE_LEGACY_DURATION_B64'),cut='core=base64.b64decode')
    run_patch('08_generic_core',decode('PP_GENERIC_CORE_B64'),cut='os.environ["PP_SELFTEST"]="0"')
    timing,batching=assemble_active_patch_chain()
    run_patch('09_timing',timing)
    run_patch('10_batches_and_setup',batching)
    # AST-based verification, not fragile string matching on embedded scripts.
    src=SOURCE.read_text(encoding='utf-8')
    tree=ast.parse(src,filename='<assembled-ga>')
    defs={x.name for x in tree.body if isinstance(x,ast.FunctionDef)}
    required={'_pp_optimize_generic','_pp_setup_generic_apply','_pp_schedule_sequence',
              'canonicalize_model','optimize','install_model','validate_plan_v2'}
    if not required.issubset(defs):raise RuntimeError('ga_compiled_capabilities_missing')
    if len(src)<360_000:raise RuntimeError('ga_compiled_source_too_small')
    actual=hashlib.sha256(src.encode()).hexdigest()
    expected=os.environ.get('PP_PY_GA_ASSEMBLED_SHA256','')
    if expected and expected!=actual:raise RuntimeError('ga_compiled_hash_mismatch')
    # Do not log source or any model/credential.
    print('LIFTORBIT_GA_REBUILD_OK',len(src),'sha256',actual,flush=True)
    return actual

if __name__=='__main__': build()