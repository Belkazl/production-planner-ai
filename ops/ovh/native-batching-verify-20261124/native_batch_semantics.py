"""Pure AST metadata for two known native batching functions.

No files, environments, code decoding, imports of native modules, execution,
source rendering or literal values. Call only on already decoded owned code.
"""


def summarize_native_batch_semantics(decoded_source, source_label):
    import ast
    import json
    import re

    targets = frozenset({'_pp_optimize_generic', '_pp_expand_capacity_batches'})
    identifier = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,70}$')
    label = re.compile(r'^[A-Za-z0-9_.:-]{1,100}$')
    technical_keys = frozenset({
        'batch', 'batches', 'batching', 'batch_id', 'batch_count', 'batch_counts',
        'batch_quantity', 'batch_quantities', 'batch_size', 'batch_sizes', 'batch_capacity',
        'batch_unit', 'batch_policy', 'batch_mode', 'batch_plan', 'batch_gene', 'batch_genes',
        'batch_factor', 'batch_factors', 'batch_ratio', 'batch_ratios', 'batch_limits',
        'min_batch_size', 'max_batch_size', 'min_batch_quantity', 'max_batch_quantity',
        'min_batch_count', 'max_batch_count', 'per_order_batch_sizes', 'per_order_batch_counts',
        'minibatch_size', 'minibatch_sizes', 'minibatch_count', 'minibatch_counts',
        'mini_batch_size', 'mini_batch_sizes', 'mini_batch_count', 'mini_batch_counts',
        'split', 'splits', 'split_size', 'split_sizes', 'split_count', 'split_counts',
        'split_quantity', 'split_quantities', 'split_gene', 'split_genes', 'split_factor',
        'split_factors', 'split_ratio', 'split_ratios', 'split_mode', 'split_policy',
        'lot_size', 'lot_sizes', 'lot_count', 'lot_counts', 'min_lot_size', 'max_lot_size',
        'chunk_size', 'chunk_sizes', 'chunk_count', 'chunk_counts',
        'quantity', 'area', 'capacity', 'order_ids', 'order_sequence', 'sequence',
        'best_order', 'best_batches', 'parts', 'partitions', 'genome', 'genes',
        'best_genome', 'best_partition', 'best_partitions', '_batch_sizes', '_batch_plan',
    })
    builtin_names = frozenset({'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int',
        'isinstance', 'len', 'list', 'max', 'min', 'range', 'round', 'set', 'sorted', 'str',
        'sum', 'tuple', 'zip', 'Exception', 'RuntimeError', 'ValueError', 'TypeError'})
    dynamic_names = frozenset({'eval', 'exec', 'compile', '__import__', 'getattr', 'globals', 'locals', 'vars'})
    max_calls = 96
    max_sites = 64
    output = {'version': 'native-batch-semantic-metadata-v1',
              'source_label': source_label if isinstance(source_label, str) and label.fullmatch(source_label) else 'invalid_label',
              'status': 'ok', 'functions': [], 'functions_truncated': False, 'output_truncated': False,
              'scope': 'two_function_ast_metadata_only'}
    if not isinstance(decoded_source, str) or len(decoded_source) > 4 * 1024 * 1024:
        output['status'] = 'unsupported_source_size_or_type'
        return output
    try:
        tree = ast.parse(decoded_source, filename='<owned-native-batch-metadata>')
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        output['status'] = 'unparseable_source'
        return output

    def safe_name(value):
        return value if isinstance(value, str) and identifier.fullmatch(value) else None

    def dotted(node, depth=0):
        if depth > 4:
            return None
        if isinstance(node, ast.Name):
            return safe_name(node.id)
        if isinstance(node, ast.Attribute):
            base, attribute = dotted(node.value, depth + 1), safe_name(node.attr)
            return base + '.' + attribute if base and attribute else None
        return None

    def known_key(node):
        return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in technical_keys else None

    def shape(node, depth=0):
        if node is None:
            return {'kind': 'absent'}
        if isinstance(node, ast.Name):
            return {'kind': 'name', 'name': safe_name(node.id)}
        if isinstance(node, ast.Constant):
            key = known_key(node)
            if key:
                return {'kind': 'known_technical_key', 'name': key}
            value = node.value
            kind = 'null' if value is None else 'boolean' if isinstance(value, bool) else 'number' if isinstance(value, (int, float, complex)) else 'string' if isinstance(value, str) else 'other'
            return {'kind': kind + '_literal'}
        if isinstance(node, ast.Attribute):
            return {'kind': 'attribute', 'name': dotted(node)}
        if depth >= 2:
            return {'kind': type(node).__name__.lower()}
        if isinstance(node, ast.Subscript):
            return {'kind': 'subscript', 'base': shape(node.value, depth + 1), 'index': shape(node.slice, depth + 1)}
        if isinstance(node, ast.Slice):
            return {'kind': 'slice', 'lower': shape(node.lower, depth + 1), 'upper': shape(node.upper, depth + 1), 'step': shape(node.step, depth + 1)}
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            return {'kind': type(node).__name__.lower(), 'items': [shape(item, depth + 1) for item in node.elts[:4]], 'items_truncated': len(node.elts) > 4}
        if isinstance(node, ast.Dict):
            return {'kind': 'dict', 'known_keys': sorted({known_key(key) for key in node.keys if known_key(key)}), 'unknown_key_count': sum(known_key(key) is None for key in node.keys)}
        if isinstance(node, ast.Call):
            return {'kind': 'call', 'callee': dotted(node.func), 'argument_kinds': [type(argument).__name__.lower() for argument in node.args[:8]]}
        if isinstance(node, ast.Starred):
            return {'kind': 'starred', 'value': shape(node.value, depth + 1)}
        if isinstance(node, ast.BinOp):
            return {'kind': 'binary', 'operator': type(node.op).__name__, 'left': shape(node.left, depth + 1), 'right': shape(node.right, depth + 1)}
        return {'kind': type(node).__name__.lower()}

    all_source_functions = {node.name for node in ast.walk(tree)
                            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and safe_name(node.name)}
    definitions = [node for node in ast.walk(tree)
                   if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in targets]
    output['matching_definition_count'] = len(definitions)
    output['functions_truncated'] = len(definitions) > 8

    for definition in definitions[:8]:
        parameters = list(definition.args.posonlyargs) + list(definition.args.args) + list(definition.args.kwonlyargs)
        if definition.args.vararg:
            parameters.append(definition.args.vararg)
        if definition.args.kwarg:
            parameters.append(definition.args.kwarg)
        result = {'name': definition.name, 'first_line': definition.lineno,
                  'parameters': [argument.arg for argument in parameters if safe_name(argument.arg)][:24],
                  'calls': [], 'call_names': [], 'call_count': 0, 'calls_truncated': False,
                  'decoder_calls': [], 'technical_key_reads': [], 'technical_key_writes': [],
                  'constructed_technical_keys': [], 'dynamic_call_count': 0,
                  'dynamic_call_kinds': [], 'mutation_kinds': [], 'mutation_sites': [],
                  'mutation_sites_truncated': False, 'assignments': [], 'assignments_truncated': False,
                  'other_calls_requiring_review': [], 'local_functions': [],
                  'definition_time_expressions_omitted': bool(definition.decorator_list or definition.args.defaults or definition.args.kw_defaults),
                  'absence_of_batch_search_proven': False}
        calls = {}
        names, reads, writes, constructed, dynamic, mutation_kinds, unresolved = set(), set(), set(), set(), set(), set(), set()
        local_functions = {node.name for node in ast.walk(definition)
                           if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and safe_name(node.name)}
        result['local_functions'] = sorted(local_functions - {definition.name})[:24]

        class Visitor(ast.NodeVisitor):
            def __init__(self):
                self.scope = [definition.name]

            def add_site(self, node, kind, receiver=None):
                mutation_kinds.add(kind)
                if len(result['mutation_sites']) < max_sites:
                    result['mutation_sites'].append({'scope': '.'.join(self.scope), 'line': node.lineno,
                                                     'kind': kind, 'receiver': receiver})
                else:
                    result['mutation_sites_truncated'] = True

            def visit_FunctionDef(self, node):
                self.scope.append(safe_name(node.name) or 'other')
                for statement in node.body:
                    self.visit(statement)
                self.scope.pop()

            visit_AsyncFunctionDef = visit_FunctionDef

            def visit_Call(self, node):
                result['call_count'] += 1
                callee = dotted(node.func)
                if callee:
                    names.add(callee)
                root = callee.split('.', 1)[0] if callee else None
                if not callee or callee in dynamic_names:
                    result['dynamic_call_count'] += 1
                    dynamic.add(callee or type(node.func).__name__.lower() + '_callable')
                resolution = ('builtin' if callee in builtin_names else 'local_function'
                              if callee in local_functions else 'source_function_unanalysed'
                              if callee in all_source_functions else 'external_or_attribute' if callee else 'dynamic')
                if resolution in ('source_function_unanalysed', 'external_or_attribute', 'dynamic'):
                    unresolved.add(callee or '<dynamic>')
                entry = {'scope': '.'.join(self.scope), 'callee': callee, 'line': node.lineno,
                         'resolution_hint': resolution, 'args': [shape(arg) for arg in node.args[:8]],
                         'args_truncated': len(node.args) > 8,
                         'keywords': [{'name': safe_name(item.arg) if item.arg else None, 'shape': shape(item.value)} for item in node.keywords[:8]],
                         'keywords_truncated': len(node.keywords) > 8}
                signature = json.dumps({key: value for key, value in entry.items() if key != 'line'}, sort_keys=True)
                if signature in calls:
                    calls[signature]['occurrences'] += 1
                elif len(calls) < max_calls:
                    calls[signature] = {**entry, 'occurrences': 1}
                else:
                    result['calls_truncated'] = True
                if callee and callee.split('.')[-1] in ('_pp_schedule_sequence', '_pp_schedule_sequence_unbatched', '_pp_expand_capacity_batches'):
                    if len(result['decoder_calls']) < 24:
                        result['decoder_calls'].append(entry)
                if isinstance(node.func, ast.Attribute):
                    method, receiver = node.func.attr, dotted(node.func.value)
                    key = known_key(node.args[0]) if node.args else None
                    if key and method in ('get', 'setdefault', 'pop'):
                        reads.add(key)
                        if method != 'get':
                            writes.add(key)
                    if method == 'update':
                        writes.update(item.arg for item in node.keywords if item.arg in technical_keys)
                        for argument in node.args:
                            if isinstance(argument, ast.Dict):
                                writes.update(known_key(key) for key in argument.keys if known_key(key))
                    if method in ('shuffle', 'sample', 'choice', 'choices'):
                        self.add_site(node, 'random_' + method, receiver)
                    elif method in ('append', 'extend', 'insert', 'pop', 'remove', 'clear', 'update', 'sort', 'reverse'):
                        self.add_site(node, 'container_' + method, receiver)
                self.generic_visit(node)

            def visit_Subscript(self, node):
                key = known_key(node.slice)
                if key:
                    (writes if isinstance(node.ctx, (ast.Store, ast.Del)) else reads).add(key)
                if isinstance(node.ctx, (ast.Store, ast.Del)):
                    self.add_site(node, 'slice_store' if isinstance(node.slice, ast.Slice) else 'subscript_store', dotted(node.value))
                elif isinstance(node.slice, ast.Slice):
                    self.add_site(node, 'slice_read', dotted(node.value))
                self.generic_visit(node)

            def visit_Dict(self, node):
                constructed.update(known_key(key) for key in node.keys if known_key(key))
                self.generic_visit(node)

            def visit_Assign(self, node):
                if len(result['assignments']) < max_sites:
                    result['assignments'].append({'scope': '.'.join(self.scope), 'line': node.lineno,
                        'targets': [shape(target) for target in node.targets[:4]], 'value_shape': shape(node.value)})
                else:
                    result['assignments_truncated'] = True
                if (len(node.targets) == 1 and isinstance(node.targets[0], (ast.Tuple, ast.List))
                        and isinstance(node.value, (ast.Tuple, ast.List))
                        and len(node.targets[0].elts) == len(node.value.elts) == 2):
                    left, right = node.targets[0].elts, node.value.elts
                    if all(isinstance(item, ast.Subscript) for item in left + right):
                        same = dotted(left[0].value)
                        if same and all(dotted(item.value) == same for item in left + right):
                            first = ast.dump(left[0].slice, include_attributes=False) == ast.dump(right[1].slice, include_attributes=False)
                            second = ast.dump(left[1].slice, include_attributes=False) == ast.dump(right[0].slice, include_attributes=False)
                            if first and second:
                                self.add_site(node, 'subscript_swap_same_container', same)
                self.generic_visit(node)

            def visit_AugAssign(self, node):
                self.add_site(node, 'augmented_assignment_' + type(node.op).__name__, dotted(node.target))
                self.generic_visit(node)

            def visit_BinOp(self, node):
                if isinstance(node.op, ast.Add) and (isinstance(node.left, (ast.Subscript, ast.List, ast.Tuple))
                                                    or isinstance(node.right, (ast.Subscript, ast.List, ast.Tuple))):
                    self.add_site(node, 'slice_or_container_concatenation')
                self.generic_visit(node)

        visitor = Visitor()
        try:
            for statement in definition.body:
                visitor.visit(statement)
        except (RecursionError, MemoryError):
            result['analysis_incomplete'] = True
        result.update(calls=list(calls.values()), call_names=sorted(names)[:128],
                      call_names_truncated=len(names) > 128, technical_key_reads=sorted(reads),
                      technical_key_writes=sorted(writes), constructed_technical_keys=sorted(constructed),
                      dynamic_call_kinds=sorted(dynamic), mutation_kinds=sorted(mutation_kinds),
                      other_calls_requiring_review=sorted(unresolved)[:128],
                      other_calls_truncated=len(unresolved) > 128)
        output['functions'].append(result)
    # A caller can safely add two summaries to the existing bounded audit log.
    # Keep all call-name sets where possible; remove detailed examples first.
    while len(json.dumps(output, ensure_ascii=True, separators=(',', ':')).encode()) > 32768:
        output['output_truncated'] = True
        choices = []
        for row in output['functions']:
            for field, flag in (('calls', 'calls_truncated'), ('assignments', 'assignments_truncated'),
                                ('mutation_sites', 'mutation_sites_truncated'), ('decoder_calls', 'decoder_calls_truncated'),
                                ('other_calls_requiring_review', 'other_calls_truncated'), ('call_names', 'call_names_truncated')):
                if row[field]:
                    choices.append((len(json.dumps(row[field])), row, field, flag))
        if choices:
            _, row, field, flag = max(choices, key=lambda item: item[0])
            row[field] = row[field][:len(row[field]) // 2]
            row[flag] = True
        elif output['functions']:
            output['functions'].pop()
            output['functions_truncated'] = True
        else:
            break
    return output
