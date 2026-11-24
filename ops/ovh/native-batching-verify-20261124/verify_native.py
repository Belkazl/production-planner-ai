"""Host-local rootless tests of the existing native optimizer; no private-code egress."""
import argparse
import ast
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

# The child uses -I. Only this reviewed public helper directory is added here;
# the separately verified native package is added inside child_verification.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_input_contract import PACKAGE, InputContractError, load_owned_inputs, select_code_fields


EPS = 1e-5
IDENTIFIER = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,70}$')
STATE_NAME = re.compile(r'^_PP_.*(?:STATE|BATCH|JOINT|SPLIT|MINI|GENOME)', re.I)
STATE_FIELDS = frozenset({'best', 'best_order', 'best_duration', 'run', 'total_trials', 'best_genome', 'genome',
    'best_individual', 'individual', 'best_partition', 'best_partitions', 'partition', 'partitions', 'best_batches',
    'batch_sizes', 'batch_counts', 'batch_plan', 'best_batch_plan', 'best_split', 'best_splits', 'splits', 'split',
    'population', 'fitness', 'best_fitness', 'model_hash', 'model_key', 'objective', 'version', 'seed'})


class VerificationError(Exception):
    pass


def witness_model(material=False):
    model = {
        'scheduler_mode': 'resource', 'quantity_unit': 'шт.', 'start': '2026-11-24T08:00:00',
        'equipment': [{'id': 'BIG', 'name': 'Synthetic capacity ten', 'kind': 'test_work', 'capacity': 10,
                       'capacity_unit': 'шт.', 'timing_profile': {'timing_mode': 'fixed', 'duration_min': 10}},
                      {'id': 'SMALL', 'name': 'Synthetic capacity five', 'kind': 'test_work', 'capacity': 5,
                       'capacity_unit': 'шт.', 'timing_profile': {'timing_mode': 'fixed', 'duration_min': 10}}],
        'employees': [], 'materials': [], 'setup_rules': [], 'shifts': {}, 'constraints': [],
        'orders': [{'id': 'SYNTHETIC_ORDER', 'quantity': 30, 'unit': 'шт.', 'technical_process_id': 'SYNTHETIC_PROCESS'}],
        'technical_processes': [{'id': 'SYNTHETIC_PROCESS', 'name': 'Synthetic mixed minibatch witness',
            'operations': [{'id': 'WORK', 'name': 'Fixed ten minute operation', 'sequence': 1, 'duration_min': 10,
                'resource_requirements': [{'resource_type': 'equipment', 'match_mode': 'any',
                    'resource_ref': 'kind:test_work', 'resource_refs': ['kind:test_work'],
                    'quantity': 1, 'unit': 'шт.', 'consumption_rule': 'during_operation'}]}]}],
    }
    if material:
        model['materials'] = [{'id': 'SYNTHETIC_MATERIAL', 'name': 'Synthetic input', 'unit': 'шт.',
            'initial_stock': 15, 'deliveries': [{'at': '2026-11-24T08:15:00', 'quantity': 15}]}]
        model['technical_processes'][0]['operations'][0]['resource_requirements'].append({
            'resource_type': 'material', 'match_mode': 'specific', 'resource_ref': 'SYNTHETIC_MATERIAL',
            'resource_refs': ['SYNTHETIC_MATERIAL'], 'quantity': 1, 'unit': 'шт.', 'consumption_rule': 'per_unit'})
    return model


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise VerificationError('nonfinite_numeric_contract')
    return float(value)


def partition(plan):
    batches = plan.get('batches') if isinstance(plan, dict) else None
    if not isinstance(batches, list) or not 1 <= len(batches) <= 256:
        raise VerificationError('batch_array_contract')
    values = []
    for batch in batches:
        if not isinstance(batch, dict) or str(batch.get('order')) != 'SYNTHETIC_ORDER':
            raise VerificationError('batch_order_contract')
        values.append(number(batch.get('quantity', batch.get('area'))))
    return tuple(sorted(round(value, 8) for value in values))


def check_witness(plan, model, diagnostics):
    if not isinstance(plan, dict) or plan.get('valid') is not True or plan.get('partial') is True:
        raise VerificationError('native_plan_not_valid')
    sizes = partition(plan)
    if abs(sum(sizes) - 30) > EPS or any(value <= 0 or value > 10 + EPS for value in sizes):
        raise VerificationError('batch_quantity_or_capacity')
    rows = plan.get('generic_operations') or plan.get('operations')
    if not isinstance(rows, list):
        raise VerificationError('operation_array_contract')
    production = [row for row in rows if not row.get('is_setup') and str(row.get('phase', '')).lower() != 'setup']
    if len(production) != len(sizes):
        raise VerificationError('operation_coverage')
    capacities = {'BIG': 10, 'SMALL': 5}
    intervals = {key: [] for key in capacities}
    quantities = []
    for row in production:
        if str(row.get('order')) != 'SYNTHETIC_ORDER' or row.get('operation_id') != 'WORK':
            raise VerificationError('foreign_operation')
        equipment = row.get('equipment_ids')
        if not isinstance(equipment, list) or len(equipment) != 1 or equipment[0] not in capacities:
            raise VerificationError('equipment_contract')
        quantity = number(row.get('batch_quantity'))
        start, end = number(row.get('start_min')), number(row.get('end_min'))
        if start < -EPS or abs(end - start - 10) > EPS or quantity <= 0 or quantity > capacities[equipment[0]] + EPS:
            raise VerificationError('native_duration_or_capacity')
        quantities.append(round(quantity, 8))
        intervals[equipment[0]].append((start, end))
        uses = row.get('materials') or []
        if model['materials']:
            material_uses = [use for use in uses if use.get('id') == 'SYNTHETIC_MATERIAL']
            if len(material_uses) != 1 or abs(number(material_uses[0].get('quantity')) - quantity) > EPS:
                raise VerificationError('material_consumption_amount')
        elif uses:
            raise VerificationError('unexpected_material_consumption')
    if tuple(sorted(quantities)) != sizes:
        raise VerificationError('batch_operation_quantities_disagree')
    for events in intervals.values():
        events.sort()
        if any(next_start < end - EPS for (_, end), (next_start, _) in zip(events, events[1:])):
            raise VerificationError('equipment_overlap')
    makespan = max(end for events in intervals.values() for _, end in events)
    if abs(number(plan.get('duration_minutes')) - makespan) > EPS:
        raise VerificationError('makespan_disagrees')
    ledger = diagnostics.material_prefix_summary(model, plan)
    if ledger.get('status') != 'valid':
        raise VerificationError('material_stock_prefix')
    expected = 25 if model['materials'] else 20
    return {'native_valid': True, 'independent_valid': True, 'duration_minutes': makespan,
            'optimal_lower_bound_minutes': expected, 'reached_lower_bound': abs(makespan - expected) <= EPS,
            'batch_count': len(sizes), 'batch_sizes': list(sizes), 'mixed_sizes': len(set(sizes)) > 1,
            'material_prefix': ledger}


def state_metadata(namespace):
    result = []
    for name in sorted(namespace):
        if not IDENTIFIER.fullmatch(name) or not STATE_NAME.search(name):
            continue
        value = namespace[name]
        if callable(value):
            continue
        kind = 'object' if isinstance(value, dict) else 'array' if isinstance(value, (list, tuple)) else 'scalar'
        row = {'binding': name, 'kind': kind}
        if isinstance(value, dict):
            row['known_fields'] = sorted(key for key in value if isinstance(key, str) and key in STATE_FIELDS)
            row['other_field_count'] = len(value) - len(row['known_fields'])
        result.append(row)
        if len(result) >= 40:
            break
    return result


def observed_run(adapter, diagnostics, model, options):
    factory = adapter._namespace
    state = {'decoder_calls': 0, 'partition_observation_errors': 0, 'distinct_partition_vectors': set(),
             'partition_vectors_truncated': False, 'batch_counts': set(), 'partitions': [],
             'native_raw_valid': 0, 'native_raw_invalid': 0, 'native_raw_validator_errors': 0,
             'first_raw_material_prefix': None, 'before_optimize_state': None}
    holder = {}

    def make_namespace():
        ga = factory()
        holder['namespace'] = ga
        holder['functions'] = diagnostics._native_functions(ga)
        original = ga.get('_pp_schedule_sequence')
        validate = ga.get('_pp_validate_generic')
        native_optimize = ga.get('optimize')
        if not callable(original) or not callable(native_optimize):
            raise VerificationError('native_hooks_missing')

        def observed(*args, **kwargs):
            result = original(*args, **kwargs)
            state['decoder_calls'] += 1
            # Observe the entire small native run; retain at most 64 vectors.
            try:
                values = partition(result)
                digest = hashlib.sha256(json.dumps(values).encode()).hexdigest()
                state['batch_counts'].add(len(values))
                if digest not in state['distinct_partition_vectors']:
                    if len(state['distinct_partition_vectors']) < 64:
                        state['distinct_partition_vectors'].add(digest)
                        state['partitions'].append(list(values))
                    else:
                        state['partition_vectors_truncated'] = True
                candidate_model = args[0] if args else kwargs.get('candidate_model', kwargs.get('model'))
                if state['first_raw_material_prefix'] is None:
                    state['first_raw_material_prefix'] = diagnostics.material_prefix_summary(candidate_model, result)
                if callable(validate):
                    try:
                        errors = validate(candidate_model, copy.deepcopy(result))
                        state['native_raw_invalid' if errors else 'native_raw_valid'] += 1
                    except Exception:
                        state['native_raw_validator_errors'] += 1
            except (VerificationError, TypeError, ValueError, KeyError):
                state['partition_observation_errors'] += 1
            return result

        def optimize(*args, **kwargs):
            state['before_optimize_state'] = state_metadata(ga)
            return native_optimize(*args, **kwargs)

        ga['_pp_schedule_sequence'] = observed
        ga['optimize'] = optimize
        return ga

    adapter._namespace = make_namespace
    model_before = copy.deepcopy(model)
    try:
        result = adapter.run({'model': model, 'options': options}, lambda _progress: None)
    finally:
        adapter._namespace = factory
    if model != model_before:
        raise VerificationError('caller_model_mutated')
    report = {key: value for key, value in state.items() if key not in ('distinct_partition_vectors', 'batch_counts')}
    report['distinct_partition_vectors'] = len(state['distinct_partition_vectors'])
    report['observed_batch_counts'] = sorted(state['batch_counts'])
    report['after_optimize_state'] = state_metadata(holder['namespace'])
    report['functions'] = holder['functions']
    report['functions_after_run'] = diagnostics._native_functions(holder['namespace'])
    report['result'] = check_witness(result, model, diagnostics)
    report['resume_field_names'] = sorted(key for key in (result.get('resume_state') or {})
                                         if isinstance(key, str) and IDENTIFIER.fullmatch(key))[:64]
    return result, report


def native_baseline(adapter, diagnostics, model, namespace=None):
    ga = namespace if namespace is not None else adapter._namespace()
    normalized = ga['canonicalize_model'](copy.deepcopy(model))
    if not ga['model_ready'](normalized):
        raise VerificationError('synthetic_model_not_native_ready')
    ga['CURRENT_MODEL'] = normalized
    ga['install_model'](normalized)
    sim = ga['_pp_schedule_sequence'](normalized, [order['id'] for order in normalized['orders']])
    errors = ga['_pp_validate_generic'](normalized, copy.deepcopy(sim))
    sizes = partition(sim)
    return {'kind': 'original_native_default_decoder', 'duration_minutes': number(sim['duration_minutes']),
            'batch_count': len(sizes), 'batch_sizes': list(sizes), 'native_validation_passed': not bool(errors),
            'material_prefix': diagnostics.material_prefix_summary(normalized, sim),
            'capacity_max_reference_minutes': 30, 'mixed_optimal_lower_bound_minutes': 20}


def compiled_function_metadata(source):
    tree = ast.parse(source, filename='<owned-native-compiled-metadata>')
    names = re.compile(r'batch|joint|ppjb|split|mini', re.I)
    found = []
    count = 0
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or not IDENTIFIER.fullmatch(node.name) or not names.search(node.name):
            continue
        count += 1
        if len(found) >= 80:
            continue
        arguments = list(node.args.posonlyargs) + list(node.args.args) + list(node.args.kwonlyargs)
        if node.args.vararg is not None:
            arguments.append(node.args.vararg)
        if node.args.kwarg is not None:
            arguments.append(node.args.kwarg)
        parameters = [argument.arg for argument in arguments if IDENTIFIER.fullmatch(argument.arg)]
        found.append({'name': node.name, 'parameters': parameters[:24], 'first_line': node.lineno,
                      'parameters_truncated': len(parameters) > 24})
    return {'functions': found, 'matching_function_count': count, 'functions_truncated': count > len(found)}


def child_verification(root, report_path):
    report = {'format': 'native-minibatch-verification-v1', 'status': 'started', 'phase': 'imports', 'cases': {}}
    try:
        selected = select_code_fields(json.loads(Path('/input/code-inputs.json').read_text()))
        os.environ.update(selected)
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        sys.path.insert(0, str(root))
        from ga_workers import compile_legacy_ga as compiler
        from ga_workers import full_runtime_adapter as adapter
        from ga_workers import batch_size_diagnostics as diagnostics
        report['phase'] = 'native_build'
        compiler.build()
        compiled = Path('/tmp/production_planner.py').read_bytes()
        report['compiled_sha256'] = hashlib.sha256(compiled).hexdigest()
        report['phase'] = 'compiled_binding_metadata'
        report['compiled_functions'] = compiled_function_metadata(compiled)
        native_namespace = adapter._namespace()
        report['namespace_functions_before_baseline'] = diagnostics._native_functions(native_namespace)
        report['namespace_state_before_baseline'] = state_metadata(native_namespace)
        report['phase'] = 'native_plain_witness'
        options = {'generations': 24, 'population': 24, 'seed': 1729, 'objective': 'duration'}
        plain_model = witness_model()
        report['baseline'] = native_baseline(adapter, diagnostics, plain_model, native_namespace)
        first, plain = observed_run(adapter, diagnostics, plain_model, options)
        report['cases']['plain'] = plain
        report['phase'] = 'native_material_witness'
        _, material = observed_run(adapter, diagnostics, witness_model(True), options)
        report['cases']['material_delivery'] = material
        report['phase'] = 'native_fresh_namespace_continuation'
        resume = first.get('resume_state')
        if not isinstance(resume, dict):
            raise VerificationError('native_resume_state_missing')
        continued, continuation = observed_run(adapter, diagnostics, plain_model,
            {'generations': 3, 'population': 6, 'seed': 1730, 'objective': 'duration', 'continue': True,
             'resume_state': copy.deepcopy(resume)})
        continuation['result']['not_worse_than_first'] = number(continued['duration_minutes']) <= number(first['duration_minutes']) + EPS
        continuation['prior_partition_observed'] = list(partition(first)) in continuation['partitions']
        report['cases']['continue_fresh_namespace'] = continuation
        # The bridge contract is reviewed separately: this directly tests the
        # worker's real exported state, never manufactures batch-state fields.
        report['phase'] = 'complete'
        restored = all(case['result']['reached_lower_bound'] for case in report['cases'].values())
        restored = restored and continuation['result']['not_worse_than_first']
        report['status'] = 'native_witness_pass' if restored else 'native_minibatch_regression'
    except BaseException as error:
        # No traceback, native exception text, source line, or private value is exported.
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        if isinstance(error, VerificationError):
            report['error_code'] = str(error)
    report_path.write_text(json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    os.chmod(report_path, 0o600)
    return 0 if report['status'] == 'native_witness_pass' else 1


def bwrap_base(binary, interpreter):
    # A minimal filesystem has no host /home, /run, /var or Unix service sockets.
    command = [binary, '--unshare-user', '--unshare-pid', '--unshare-net',
               '--unshare-ipc', '--unshare-uts', '--new-session', '--die-with-parent',
               '--clearenv', '--cap-drop', 'ALL']
    for path in ('/usr', '/bin', '/lib', '/lib64'):
        if Path(path).exists():
            command += ['--ro-bind', path, path]
    if not str(Path(interpreter).resolve()).startswith('/usr/'):
        raise VerificationError('existing_python_outside_readonly_system_tree')
    command += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
                '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin',
                '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'PYTHONDONTWRITEBYTECODE', '1',
                '--setenv', 'PYTHONUNBUFFERED', '1', '--chdir', '/tmp']
    return command


def verify_rootless_isolation(binary, interpreter):
    # This harmless public probe runs before any private configuration is read.
    probe = "import json,os;from pathlib import Path;lines=Path('/proc/self/mountinfo').read_text().splitlines();print(json.dumps({'net':os.stat('/proc/self/ns/net').st_ino,'pid':os.stat('/proc/self/ns/pid').st_ino,'tmpfs':any(x.split(' - ',1)[0].split()[4]=='/tmp' and x.split(' - ',1)[1].split()[0]=='tmpfs' for x in lines)}))"
    current_net = os.stat('/proc/self/ns/net').st_ino
    current_pid = os.stat('/proc/self/ns/pid').st_ino
    try:
        result = subprocess.run(bwrap_base(binary, interpreter) + [interpreter, '-I', '-c', probe],
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=12,
                                env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        if result.returncode != 0 or len(result.stdout) > 2048:
            raise VerificationError('rootless_namespace_unavailable')
        observed = json.loads(result.stdout)
        if observed.get('tmpfs') is not True or observed.get('net') == current_net or observed.get('pid') == current_pid:
            raise VerificationError('rootless_isolation_not_confirmed')
    except (OSError, subprocess.TimeoutExpired, ValueError):
        raise VerificationError('rootless_namespace_unavailable')
    return {'method': 'existing_rootless_bwrap', 'private_tmpfs': True,
            'private_network_namespace': True, 'private_pid_namespace': True}


def run_host_local(timeout=360):
    if os.geteuid() == 0:
        raise VerificationError('ordinary_ci_user_required')
    binary = shutil.which('bwrap')
    if binary is None:
        raise VerificationError('rootless_bwrap_unavailable')
    binary = str(Path(binary).resolve())
    binary_info = Path(binary).stat()
    if (not binary.startswith('/usr/') or binary_info.st_uid != 0
            or not stat.S_ISREG(binary_info.st_mode)
            or binary_info.st_mode & (stat.S_ISUID | stat.S_ISGID)):
        raise VerificationError('unprivileged_system_bwrap_required')
    interpreter = str(Path(sys.executable).resolve())
    isolation = verify_rootless_isolation(binary, interpreter)
    # No config/code read occurs before an actual unprivileged isolation probe succeeds.
    fields, manifest, package_files = load_owned_inputs()
    previous_mask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix='pp-native-batching-private-') as scratch:
            root = Path(scratch)
            os.chmod(root, 0o700)
            package = root / 'ga_workers'
            package.mkdir(mode=0o700)
            for relative, data in package_files.items():
                path = root / relative
                with open(path, 'xb') as handle:
                    os.chmod(path, 0o600)
                    handle.write(data)
            selected = root / 'code-inputs.json'
            selected.write_text(json.dumps(fields, separators=(',', ':')))
            os.chmod(selected, 0o600)
            output = root / 'report'
            output.mkdir(mode=0o700)
            report_path = output / 'safe-report.json'
            harness = Path(__file__).resolve().parent
            command = bwrap_base(binary, interpreter) + [
                '--dir', '/native', '--ro-bind', str(package), '/native/ga_workers',
                '--dir', '/verify', '--ro-bind', str(harness), '/verify',
                '--dir', '/input', '--ro-bind', str(selected), '/input/code-inputs.json',
                '--dir', '/report', '--bind', str(output), '/report',
                interpreter, '-I', '/verify/verify_native.py', '--child', '/native',
                '--report', '/report/safe-report.json']
            process = None
            try:
                with open(root / 'private-native-output.log', 'xb') as captured:
                    os.chmod(root / 'private-native-output.log', 0o600)
                    process = subprocess.Popen(command,
                        env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8'},
                        stdin=subprocess.DEVNULL, stdout=captured, stderr=subprocess.STDOUT,
                        start_new_session=True, cwd=root)
                    try:
                        process.wait(timeout=timeout)
                    except subprocess.TimeoutExpired:
                        raise VerificationError('native_verification_timeout')
            finally:
                if process is not None and process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
            if not report_path.is_file() or report_path.stat().st_size > 1024 * 1024:
                raise VerificationError('safe_report_missing_or_too_large')
            report = json.loads(report_path.read_text())
            report['provenance'] = {'compiler_sha256': manifest['compiler_sha256'],
                'adapter_sha256': manifest['source_hashes'].get('ga_workers/full_runtime_adapter.py'),
                'code_fields_count': len(fields), 'native_code_changed': False,
                'private_code_egress': False, 'production_writes': False,
                'host_private_temp_only': True, 'isolation': isolation}
            print('NATIVE_BATCHING_VERIFICATION ' + json.dumps(report, ensure_ascii=False, separators=(',', ':')))
            return process.returncode
    finally:
        os.umask(previous_mask)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--on-host', action='store_true')
    parser.add_argument('--child', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--timeout', type=int, default=360)
    args = parser.parse_args()
    if args.child:
        raise SystemExit(child_verification(args.child, args.report))
    try:
        if not args.on_host:
            raise VerificationError('explicit_host_local_mode_required')
        def interrupted(_signum, _frame):
            raise KeyboardInterrupt()
        signal.signal(signal.SIGTERM, interrupted)
        raise SystemExit(run_host_local(timeout=args.timeout))
    except KeyboardInterrupt:
        print('NATIVE_BATCHING_VERIFICATION_CANCELLED')
        raise SystemExit(130)
    except Exception as error:
        code = str(error) if isinstance(error, (VerificationError, InputContractError)) else type(error).__name__
        print('NATIVE_BATCHING_VERIFICATION_BLOCKED ' + code)
        raise SystemExit(1)
