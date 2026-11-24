"""Joint order/partition genes evaluated only by the installed native scheduler.

The native capacity expander receives a validated ordered quantity vector at
its existing enumeration point. Its identity, locks, setup and row mapping
remain native. No private source, customer model or gene is logged here.
"""
import ast
import copy
from collections import OrderedDict
from dataclasses import dataclass
import hashlib
import inspect
import json
import math
from pathlib import Path
import random
import sys
import time


VERSION = 'joint-minibatch-v1-20261124'
STATE_KEY = '_PP_JOINT_BATCH_STATE'
EPS = 1e-7
MAX_ORDERS = 256
MAX_PARTS = 128
MAX_TOTAL_PARTS = 1024
MAX_CACHE = 32
MAX_CACHE_ROWS = 20000
MAX_CACHE_BYTES = 32 * 1024 * 1024


class JointContractError(ValueError):
    pass


class InfeasibleCandidate(ValueError):
    pass


def _require(condition, code):
    if not condition:
        raise JointContractError(code)


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise JointContractError('joint_nonfinite_quantity')
    return float(value)


def _unit(value):
    return str(value or '').strip().lower().replace(' ', '').rstrip('.')


def _quantity(order):
    quantity = _number(order.get('quantity', order.get('area')))
    _require(quantity > 0, 'joint_nonpositive_quantity')
    return quantity


@dataclass(frozen=True)
class OrderSpec:
    order_id: str
    quantity: float
    maximum: float
    discrete: bool
    capacities: tuple


@dataclass(frozen=True)
class Genome:
    sequence: tuple
    partitions: tuple

    def mapping(self):
        return dict(self.partitions)

    def json(self):
        partitions = self.mapping()
        return {'version': 1, 'order_sequence': list(self.sequence),
                'partitions': [{'order_id': oid, 'sizes': list(partitions[oid])} for oid in self.sequence]}


def validate_genome(value, specs, frozen=None):
    if isinstance(value, Genome):
        value = value.json()
    _require(isinstance(value, dict) and set(value) == {'version', 'order_sequence', 'partitions'}
             and type(value['version']) is int and value['version'] == 1, 'joint_genome_schema')
    sequence, rows = value['order_sequence'], value['partitions']
    _require(isinstance(sequence, list) and 1 <= len(sequence) <= MAX_ORDERS
             and all(isinstance(oid, str) for oid in sequence)
             and len(set(sequence)) == len(sequence) and set(sequence) == set(specs), 'joint_genome_orders')
    _require(isinstance(rows, list) and len(rows) == len(sequence), 'joint_genome_partitions')
    normalized, count = [], 0
    for oid, row in zip(sequence, rows):
        _require(isinstance(row, dict) and set(row) == {'order_id', 'sizes'} and row['order_id'] == oid,
                 'joint_genome_partition_identity')
        values = row['sizes']
        _require(isinstance(values, list) and 1 <= len(values) <= MAX_PARTS, 'joint_genome_partition_size')
        spec = specs[oid]
        sizes = tuple(_number(value) for value in values)
        _require(all(value > 0 and value <= spec.maximum + EPS * max(1, spec.maximum) for value in sizes),
                 'joint_genome_partition_capacity')
        _require(abs(math.fsum(sizes) - spec.quantity) <= EPS * max(1, spec.quantity), 'joint_genome_conservation')
        if spec.discrete:
            _require(all(value.is_integer() for value in sizes), 'joint_genome_fractional_piece')
        if frozen and oid in frozen:
            _require(len(sizes) == len(frozen[oid]) and all(abs(a - b) <= EPS for a, b in zip(sizes, frozen[oid])),
                     'joint_genome_changes_pinned_partition')
        normalized.append((oid, sizes)); count += len(sizes)
    _require(count <= MAX_TOTAL_PARTS, 'joint_genome_too_many_parts')
    result = Genome(tuple(sequence), tuple(normalized))
    _require(len(json.dumps(result.json(), separators=(',', ':'), allow_nan=False).encode()) <= 65536,
             'joint_genome_too_large')
    return result


def _greedy(quantity, capacities, discrete):
    remaining, sizes, index = quantity, [], 0
    while remaining > EPS * max(1, quantity):
        _require(len(sizes) < MAX_PARTS, 'joint_initial_partition_too_large')
        capacity = capacities[index % len(capacities)]
        value = min(remaining, capacity)
        if discrete:
            value = math.floor(value + EPS)
        _require(value > 0, 'joint_initial_partition_empty')
        sizes.append(value); remaining = quantity - math.fsum(sizes); index += 1
    if remaining:
        sizes[-1] += remaining
    return tuple(sizes)


def seed_genomes(specs, frozen=None):
    sequence = tuple(specs)
    seeds = []
    for mode in ('maximum', 'heterogeneous', 'minimum'):
        partitions = []
        for oid, spec in specs.items():
            if frozen and oid in frozen:
                sizes = frozen[oid]
            else:
                capacities = (spec.maximum,) if mode == 'maximum' else spec.capacities
                if mode == 'minimum':
                    capacities = (min(capacities),)
                try:
                    sizes = _greedy(spec.quantity, capacities, spec.discrete)
                except JointContractError:
                    sizes = _greedy(spec.quantity, (spec.maximum,), spec.discrete)
            partitions.append((oid, sizes))
        genome = validate_genome(Genome(sequence, tuple(partitions)), specs, frozen)
        if genome not in seeds:
            seeds.append(genome)
    return seeds


def mutate(genome, specs, rng, frozen=None, operation=None):
    sequence, parts = list(genome.sequence), genome.mapping()
    choices = ['order', 'split', 'merge', 'transfer', 'part_order']
    operation = operation or rng.choice(choices)
    if operation == 'order':
        if len(sequence) >= 2:
            left, right = rng.sample(range(len(sequence)), 2)
            sequence[left], sequence[right] = sequence[right], sequence[left]
    else:
        mutable = [oid for oid in sequence if not frozen or oid not in frozen]
        if not mutable:
            return genome
        oid = rng.choice(mutable)
        spec, values = specs[oid], list(parts[oid])
        if operation == 'split' and len(values) < MAX_PARTS and sum(len(p) for p in parts.values()) < MAX_TOTAL_PARTS:
            eligible = [i for i, value in enumerate(values) if value >= 2] if spec.discrete else [i for i, value in enumerate(values) if value > EPS * max(1, spec.quantity) * 4]
            if eligible:
                at = rng.choice(eligible); value = values[at]
                cut = rng.randint(1, int(value) - 1) if spec.discrete else value * rng.uniform(.1, .9)
                values[at:at + 1] = [cut, value - cut]
        elif operation == 'merge' and len(values) > 1:
            eligible = [i for i in range(len(values) - 1) if values[i] + values[i + 1] <= spec.maximum + EPS]
            if eligible:
                at = rng.choice(eligible); values[at:at + 2] = [values[at] + values[at + 1]]
        elif operation == 'transfer' and len(values) > 1:
            donor, recipient = rng.sample(range(len(values)), 2)
            minimum = 1 if spec.discrete else EPS * max(1, spec.quantity)
            limit = min(values[donor] - minimum, spec.maximum - values[recipient])
            if limit >= minimum:
                amount = rng.randint(1, int(math.floor(limit + EPS))) if spec.discrete else rng.uniform(minimum, limit)
                values[donor] -= amount; values[recipient] += amount
        elif operation == 'part_order' and len(values) > 1:
            left, right = rng.sample(range(len(values)), 2)
            values[left], values[right] = values[right], values[left]
        parts[oid] = tuple(values)
    try:
        return validate_genome(Genome(tuple(sequence), tuple((oid, parts[oid]) for oid in sequence)), specs, frozen)
    except JointContractError:
        return genome


def crossover(left, right, specs, rng, frozen=None):
    # Preserve each order's full partition while recombining both gene families.
    start = rng.randrange(len(left.sequence) + 1)
    prefix = left.sequence[:start]
    sequence = prefix + tuple(oid for oid in right.sequence if oid not in prefix)
    a, b = left.mapping(), right.mapping()
    return validate_genome(Genome(sequence, tuple((oid, a[oid] if rng.random() < .5 else b[oid]) for oid in sequence)), specs, frozen)


def _install_expansion_hook(ga, choose_sizes, source=None):
    original = ga.get('_pp_expand_capacity_batches')
    _require(callable(original) and getattr(original, '__globals__', None) is ga, 'joint_expansion_namespace_drift')
    if source is None:
        path = Path(str(ga.get('__file__', '')))
        _require(str(path) == '/tmp/production_planner.py' and path.is_file(), 'joint_expansion_source_path')
        source = path.read_bytes()
    _require(isinstance(source, (str, bytes)) and len(source) <= 4000000, 'joint_expansion_source_size')
    tree = ast.parse(source, filename='<joint-native-expansion-contract>')
    matches = [node for node in tree.body if isinstance(node, ast.FunctionDef)
               and node.name == '_pp_expand_capacity_batches' and node.lineno == original.__code__.co_firstlineno]
    _require(len(matches) == 1, 'joint_expansion_definition_drift')
    node = copy.deepcopy(matches[0])
    _require([arg.arg for arg in node.args.args] == ['model', 'order_ids', 'locked_operations']
             and not node.decorator_list and not node.args.posonlyargs and not node.args.kwonlyargs
             and node.args.vararg is None and node.args.kwarg is None, 'joint_expansion_signature_drift')
    calls = [call for call in ast.walk(node) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
             and call.func.id == '_pp_order_batch_capacity']
    _require(len(calls) == 1 and len(calls[0].args) == 2 and not calls[0].keywords
             and isinstance(calls[0].args[0], ast.Name) and calls[0].args[0].id == 'model'
             and isinstance(calls[0].args[1], ast.Name), 'joint_expansion_order_anchor_drift')
    order_name = calls[0].args[1].id
    enumerations = [call for call in ast.walk(node) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
                    and call.func.id == 'enumerate' and call.args and isinstance(call.args[0], ast.Name)
                    and call.args[0].id == 'sizes']
    _require(len(enumerations) == 1, 'joint_expansion_enumeration_drift')
    helper_name = '_pp_joint_selected_sizes'
    _require(helper_name not in ga, 'joint_expansion_helper_collision')
    # Keep native len(sizes)/batch_count expressions consistent inside the same
    # loop while changing only this one enumeration input.
    enumerations[0].args[0] = ast.NamedExpr(target=ast.Name(id='sizes', ctx=ast.Store()),
        value=ast.Call(func=ast.Name(id=helper_name, ctx=ast.Load()),
            args=[ast.Name(id=order_name, ctx=ast.Load()), ast.Name(id='sizes', ctx=ast.Load())], keywords=[]))
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    local = {}
    exec(compile(module, '<joint-native-expansion>', 'exec'), ga, local)
    replaced = local['_pp_expand_capacity_batches']
    ga[helper_name] = choose_sizes
    ga['_pp_expand_capacity_batches'] = replaced
    return original


def _capacity_fits(ga, order, machine):
    if not ga['_pp_batch_equipment_fits'](order, machine):
        return False
    order_unit = _unit(ga['_pp_batch_order_unit'](order))
    equipment_unit = _unit(ga['_pp_batch_unit'](machine.get('capacity_unit')))
    # The existing native predicate decides compatibility. Numeric capacity
    # applies when both quantities have the same native-normalized unit.
    if order_unit and equipment_unit and order_unit == equipment_unit:
        capacity = machine.get('capacity')
        if capacity is None:
            return True
        capacity = _number(capacity)
        return capacity <= 0 or _quantity(order) <= capacity + EPS * max(1, capacity)
    return True


def _install_capacity_eligibility(ga):
    schedule = ga.get('_pp_schedule_operation')
    eligible = ga.get('_pp_eligible_equipment')
    _require(callable(schedule) and callable(eligible), 'joint_equipment_hooks_missing')
    _require(list(inspect.signature(schedule).parameters) == ['ctx', 'order', 'op', 'earliest']
             and list(inspect.signature(eligible).parameters) == ['req', 'equipment'],
             'joint_equipment_signature_drift')
    orders = []

    def filtered(req, equipment):
        rows = eligible(req, equipment)
        _require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
                 'joint_equipment_result_drift')
        if not orders:
            return rows
        return [machine for machine in rows if _capacity_fits(ga, orders[-1], machine)]

    def scheduled(ctx, order, op, earliest):
        orders.append(order)
        try:
            return schedule(ctx, order, op, earliest)
        finally:
            orders.pop()

    ga['_pp_eligible_equipment'] = filtered
    ga['_pp_schedule_operation'] = scheduled
    return schedule, eligible


def _batch_signature(sim, sequence):
    batches = sim.get('batches') if isinstance(sim, dict) else None
    _require(isinstance(batches, list) and 1 <= len(batches) <= MAX_TOTAL_PARTS, 'joint_result_batches')
    partitions = {oid: [] for oid in sequence}
    identities = set()
    for row in batches:
        _require(isinstance(row, dict), 'joint_result_batch_shape')
        oid = str(row.get('order'))
        index = _number(row.get('batch'))
        _require(oid in partitions and index.is_integer() and index >= 1 and (oid, int(index)) not in identities,
                 'joint_result_batch_identity')
        identities.add((oid, int(index)))
        partitions[oid].append((int(index), _number(row.get('quantity', row.get('batch_quantity', row.get('area'))))))
    ordered = []
    for oid in sequence:
        rows = sorted(partitions[oid])
        _require([index for index, _ in rows] == list(range(1, len(rows) + 1)), 'joint_result_batch_numbering')
        ordered.append((oid, tuple(quantity for _, quantity in rows)))
    return Genome(tuple(sequence), tuple(ordered))


def evaluate_feasibility(ga, model, genome, sim, pins=None, verify_constraints=None):
    """Fail closed before a native objective is read or any best is published."""
    if not isinstance(sim, dict) or sim.get('valid') is False or sim.get('partial') is True:
        raise InfeasibleCandidate('joint_native_incomplete')
    try:
        actual = _batch_signature(sim, genome.sequence)
        if actual != genome:
            raise InfeasibleCandidate('joint_native_partition_changed')
        rows = sim.get('operations')
        if not isinstance(rows, list) or not rows:
            raise InfeasibleCandidate('joint_native_operations_missing')
        orders = {str(order['id']): order for order in model['orders']}
        equipment = {str(item['id']): item for item in model.get('equipment') or model.get('autoclaves') or []}
        quantities = {(oid, index): value for oid, values in genome.partitions for index, value in enumerate(values, 1)}
        observed = set()
        for row in rows:
            if row.get('is_setup') or row.get('phase') == 'setup':
                continue
            oid, batch = str(row.get('order')), int(_number(row.get('batch', 1)))
            if (oid, batch) not in quantities:
                raise InfeasibleCandidate('joint_native_unknown_batch')
            quantity = _number(row.get('batch_quantity', quantities[(oid, batch)]))
            if abs(quantity - quantities[(oid, batch)]) > EPS * max(1, quantity):
                raise InfeasibleCandidate('joint_native_row_quantity')
            observed.add((oid, batch))
            order = dict(orders[oid], quantity=quantity, area=quantity)
            for eid in row.get('equipment_ids') or []:
                machine = equipment.get(str(eid))
                if machine is None or not _capacity_fits(ga, order, machine):
                    raise InfeasibleCandidate('joint_equipment_capacity')
        if observed != set(quantities):
            raise InfeasibleCandidate('joint_native_batch_coverage')
        _require(callable(verify_constraints), 'joint_constraint_verifier_missing')
        # The existing full constraint verifier covers native resource windows,
        # setup intervals, fixed operations, material timelines and validation.
        # Its material normalization supports the same schemas as the decoder.
        verify_constraints(model, copy.deepcopy(sim), pins or [], ga)
    except InfeasibleCandidate:
        raise
    except (JointContractError, KeyError, TypeError, ValueError, OverflowError) as error:
        raise InfeasibleCandidate('joint_native_contract') from error
    return True


def _model_specs(ga, model, default_partitions):
    rows = model.get('orders')
    _require(isinstance(rows, list) and 1 <= len(rows) <= MAX_ORDERS, 'joint_model_orders')
    equipment = model.get('equipment') or model.get('autoclaves') or []
    specs = {}
    for order in rows:
        _require(isinstance(order, dict) and isinstance(order.get('id'), (str, int))
                 and not isinstance(order.get('id'), bool), 'joint_model_order_identity')
        oid, quantity = str(order['id']), _quantity(order)
        _require(oid and oid not in specs and oid in default_partitions, 'joint_model_order_identity')
        _require(abs(math.fsum(default_partitions[oid]) - quantity) <= EPS * max(1, quantity),
                 'joint_native_quantity_contract')
        native_unit = ga.get('_pp_batch_order_unit')
        unit = _unit(native_unit(order) if callable(native_unit) else order.get('unit', model.get('quantity_unit')))
        discrete = unit in {'шт', 'pcs', 'piece', 'pieces', 'unit', 'units'}
        _require(not discrete or quantity.is_integer(), 'joint_model_fractional_piece')
        native_maximum = ga['_pp_order_batch_capacity'](model, order)
        maximum = quantity if native_maximum is None else _number(native_maximum)
        if maximum <= 0:
            maximum = quantity
        maximum = min(quantity, math.floor(maximum) if discrete else maximum)
        capacities = {maximum}
        for machine in equipment:
            value = machine.get('capacity')
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                continue
            value = min(maximum, math.floor(value) if discrete else float(value))
            if value <= 0:
                continue
            candidate = dict(order, quantity=value, area=value)
            if ga['_pp_batch_equipment_fits'](candidate, machine):
                capacities.add(value)
        specs[oid] = OrderSpec(oid, quantity, maximum, discrete, tuple(sorted(capacities, reverse=True)))
    return specs


def _pins_accept(genome, pins):
    partitions = genome.mapping()
    for pin in pins or []:
        oid = str(pin.get('order'))
        _require(oid in partitions, 'joint_pin_order')
        batch = pin.get('batch')
        if batch is None:
            _require(len(partitions[oid]) == 1, 'joint_pin_batch_identity_required')
            batch = 1
        batch = _number(batch)
        _require(batch.is_integer() and 1 <= batch <= len(partitions[oid]), 'joint_pin_batch_identity')
        if pin.get('batch_quantity') is not None:
            quantity = _number(pin['batch_quantity'])
            _require(abs(quantity - partitions[oid][int(batch) - 1]) <= EPS * max(1, quantity),
                     'joint_pin_quantity_changed')


def _score(ga, sim, objective):
    value = ga['_pp_obj_key'](sim, objective)
    if isinstance(value, (list, tuple)):
        _require(1 <= len(value) <= 16, 'joint_objective_shape')
        return tuple(_number(item) for item in value)
    return (_number(value),)


def _cache_cost(sim):
    rows = sum(len(sim.get(key) or []) for key in ('operations', 'setup_operations'))
    pending, seen, size = [sim], set(), 0
    while pending and size <= MAX_CACHE_BYTES:
        item = pending.pop()
        identity = id(item)
        if identity in seen:
            continue
        seen.add(identity); size += sys.getsizeof(item)
        if isinstance(item, dict):
            pending.extend(item.keys()); pending.extend(item.values())
        elif isinstance(item, (list, tuple)):
            pending.extend(item)
    return rows, size


def install_joint_minibatch_search(ga, model, objective='duration', pins=None, source=None, verify_constraints=None):
    """Install after native model setup, before pin wrappers and continuation."""
    declared, ready = ga.get('_pp_generic_declared'), ga.get('_pp_generic_ready')
    _require(callable(declared) and callable(ready), 'joint_native_routing_missing')
    if not declared(model) or not ready(model):
        return False
    if isinstance(ga.get(STATE_KEY), dict) and ga[STATE_KEY].get('version') == VERSION:
        return True
    required = ('_pp_optimize_generic', '_pp_schedule_sequence', '_pp_order_batch_capacity',
                '_pp_batch_equipment_fits', '_pp_batch_order_unit', '_pp_batch_unit',
                '_pp_validate_generic', '_pp_obj_key', '_pp_progress_preview',
                '_pp_progress_begin', '_pp_progress_step', '_pp_progress_best', '_pp_progress_candidate',
                '_pp_progress_finish')
    _require(all(callable(ga.get(name)) for name in required), 'joint_native_hooks_missing')
    _require(isinstance(ga.get('_PP_GENERIC_STATE'), dict), 'joint_native_state_missing')
    if verify_constraints is None:
        from .constraints import _verify as verify_constraints
    normalized = copy.deepcopy(model)
    pins = copy.deepcopy(pins or [])
    runtime = {'active': None, 'defaults': {}, 'pending_seed': None, 'incumbents': OrderedDict()}

    def choose_sizes(order, defaults):
        oid = str(order.get('id'))
        if runtime['active'] is None:
            runtime['defaults'][oid] = tuple(_number(value) for value in defaults)
            return defaults
        parts = runtime['active'].mapping()
        _require(oid in parts, 'joint_native_expansion_order_changed')
        return list(parts[oid])

    previous_expansion = _install_expansion_hook(ga, choose_sizes, source)
    previous_equipment = None
    try:
        previous_equipment = _install_capacity_eligibility(ga)
        ga['_pp_expand_capacity_batches'](copy.deepcopy(normalized), [str(row['id']) for row in normalized['orders']], pins)
        specs = _model_specs(ga, normalized, runtime['defaults'])
        default = validate_genome(Genome(tuple(specs), tuple((oid, runtime['defaults'][oid]) for oid in specs)), specs)
    except BaseException:
        ga['_pp_expand_capacity_batches'] = previous_expansion
        ga.pop('_pp_joint_selected_sizes', None)
        if previous_equipment is not None:
            ga['_pp_schedule_operation'], ga['_pp_eligible_equipment'] = previous_equipment
        raise
    pinned_orders = {str(pin.get('order')) for pin in pins}
    frozen = {oid: default.mapping()[oid] for oid in pinned_orders if oid in specs}
    state = {'version': VERSION, 'evaluated': 0, 'feasible': 0, 'rejected': 0,
             'peak_cache_entries': 0, 'peak_cache_rows': 0, 'peak_cache_bytes': 0}

    def load_incumbent(value):
        # Validate the complete candidate before changing any process state.
        candidate = validate_genome(value, specs)
        _pins_accept(candidate, pins)
        new_frozen = {oid: candidate.mapping()[oid] for oid in pinned_orders}
        validate_genome(candidate, specs, new_frozen)
        runtime['pending_seed'] = candidate
        frozen.clear(); frozen.update(new_frozen)
        return candidate.json()

    def export_incumbent(result):
        try:
            sequence = result.get('order_sequence')
            if not isinstance(sequence, list) or set(map(str, sequence)) != set(specs):
                return None
            candidate = validate_genome(_batch_signature(result, tuple(map(str, sequence))), specs, frozen)
            if candidate not in runtime['incumbents']:
                return None
            _pins_accept(candidate, pins)
            return copy.deepcopy(candidate.json())
        except (JointContractError, ValueError, TypeError, KeyError):
            return None

    def optimize(candidate_model, gens=120, pop=80, seed=1729, continue_run=False, objective=objective):
        _require(candidate_model == normalized, 'joint_model_changed_after_install')
        generations, population = max(1, int(gens)), max(2, int(pop))
        _require(generations <= 15000 and population <= 1000, 'joint_search_budget')
        rng = random.Random(seed)
        started = time.perf_counter()
        previous = ga['_PP_GENERIC_STATE']
        run = int(previous.get('run') or 0) + 1 if continue_run else 1
        prior_trials = int(previous.get('total_trials') or 0) if continue_run else 0
        seeds = seed_genomes(specs, frozen)
        if continue_run and runtime['pending_seed'] is not None:
            seeds.insert(0, runtime['pending_seed'])
        elif continue_run and isinstance(previous.get('best_order'), list):
            sequence = tuple(map(str, previous['best_order']))
            if len(sequence) == len(specs) and set(sequence) == set(specs):
                defaults = default.mapping()
                seeds.insert(0, validate_genome(Genome(sequence, tuple((oid, frozen.get(oid, defaults[oid]))
                    for oid in sequence)), specs, frozen))
        for candidate in seeds:
            _pins_accept(candidate, pins)
        individuals = list(dict.fromkeys(seeds))[:population]
        while len(individuals) < population:
            individuals.append(mutate(rng.choice(seeds), specs, rng, frozen))
        cache = OrderedDict()
        cache_rows = cache_bytes = 0
        best = None
        attempts = 0
        history = []
        ga['_pp_progress_begin'](generations * population, 'optimizing')
        try:
            for _generation in range(generations):
                ranked = []
                for genome in individuals:
                    attempts += 1
                    state['evaluated'] += 1
                    if genome in cache:
                        evaluated, _, _ = cache[genome]
                        cache.move_to_end(genome)
                    else:
                        runtime['active'] = genome
                        try:
                            sim = ga['_pp_schedule_sequence'](copy.deepcopy(candidate_model), list(genome.sequence))
                            evaluate_feasibility(ga, normalized, genome, sim, pins, verify_constraints)
                            score = _score(ga, sim, objective)
                            evaluated = (score, sim)
                            state['feasible'] += 1
                        except InfeasibleCandidate:
                            evaluated = None; state['rejected'] += 1
                        except Exception as error:
                            if type(error).__name__ != 'PinConstraintError':
                                raise
                            evaluated = None; state['rejected'] += 1
                        finally:
                            runtime['active'] = None
                        rows, size = _cache_cost(evaluated[1]) if evaluated is not None else (0, 32)
                        if rows <= MAX_CACHE_ROWS and size <= MAX_CACHE_BYTES:
                            while cache and (len(cache) >= MAX_CACHE or cache_rows + rows > MAX_CACHE_ROWS or cache_bytes + size > MAX_CACHE_BYTES):
                                _, (_, old_rows, old_size) = cache.popitem(last=False)
                                cache_rows -= old_rows; cache_bytes -= old_size
                            cached = (evaluated[0], copy.deepcopy(evaluated[1])) if evaluated is not None else None
                            cache[genome] = (cached, rows, size)
                            cache_rows += rows; cache_bytes += size
                            state['peak_cache_entries'] = max(state['peak_cache_entries'], len(cache))
                            state['peak_cache_rows'] = max(state['peak_cache_rows'], cache_rows)
                            state['peak_cache_bytes'] = max(state['peak_cache_bytes'], cache_bytes)
                    if evaluated is not None:
                        score, sim = evaluated
                        ranked.append((score, genome))
                        ga['_pp_progress_candidate'](normalized, sim, objective)
                        if best is None or score < best[0]:
                            best = (score, genome, copy.deepcopy(sim))
                            runtime['incumbents'][genome] = True
                            if len(runtime['incumbents']) > 64:
                                runtime['incumbents'].popitem(last=False)
                            ga['_pp_progress_best'](normalized, sim, objective)
                    ga['_pp_progress_step']()
                ranked.sort(key=lambda pair: pair[0])
                history.append(best[2]['duration_minutes'] if best is not None else None)
                parents = [genome for _, genome in ranked[:max(2, population // 3)]] or seeds
                next_generation = [best[1]] if best is not None else [seeds[0]]
                while len(next_generation) < population:
                    left, right = rng.choice(parents), rng.choice(parents)
                    child = crossover(left, right, specs, rng, frozen)
                    # Mutate both the order and partition dimensions over time.
                    child = mutate(child, specs, rng, frozen)
                    if rng.random() < .35:
                        child = mutate(child, specs, rng, frozen)
                    next_generation.append(child)
                individuals = next_generation
            _require(best is not None, 'joint_no_feasible_solution')
            score, genome, sim = best
            # Reuse the native formatter; only search counters and exact genes
            # are owned by this extension. Native KPI calculations are retained.
            result = ga['_pp_progress_preview'](normalized, copy.deepcopy(sim), objective)
            _require(isinstance(result, dict) and result.get('valid') is True, 'joint_native_formatter_contract')
            result = copy.deepcopy(result)
            result.update(ok=True, order_sequence=list(genome.sequence), optimization_run=run,
                          total_generations=prior_trials + generations, generations=generations, population=population,
                          seed=seed, continued=bool(continue_run), runtime_ms=round((time.perf_counter() - started) * 1000),
                          history_best=history)
            _require(_batch_signature(result, genome.sequence) == genome, 'joint_final_partition_changed')
            result['joint_minibatch'] = {key: state[key] for key in ('version', 'evaluated', 'feasible', 'rejected',
                'peak_cache_entries', 'peak_cache_rows', 'peak_cache_bytes')}
            previous.update(best_order=list(genome.sequence), best_duration=float(sim['duration_minutes']),
                            run=run, total_trials=prior_trials + generations)
            runtime['pending_seed'] = genome
            ga['_pp_progress_finish'](True, None)
            return result
        except BaseException:
            ga['_pp_progress_finish'](False, 'joint_search_failed')
            raise
        finally:
            runtime['active'] = None

    state.update(load_incumbent=load_incumbent, export_incumbent=export_incumbent)
    ga[STATE_KEY] = state
    ga['_pp_optimize_generic'] = optimize
    return True
