"""Require one successful exact candidate and a deliberate marker-only commit."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import urllib.request

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from contract import (COMMIT, FIELDS, REPO, baseline, public_hashes, read_json,
                      validate_container_report, validate_worker_change)

REPOSITORY = 'Belkazl/production-planner-ai'
BRANCH = 'fix/gantt-zoom-500-20261124'
WORKFLOW = '.github/workflows/liftorbit-shift-aware-minibatch-verify-20261125.yml'
MARKER = 'ops/ovh/shift-aware-minibatch-release-20261125/release.json'


def validate_marker(value):
    if not isinstance(value, dict) or set(value) != {'schema', 'candidate_commit', 'verification_run_id', *FIELDS} or value.get('schema') != 1:
        raise ValueError('marker_schema')
    if not isinstance(value['candidate_commit'], str) or not COMMIT.fullmatch(value['candidate_commit']):
        raise ValueError('marker_commit')
    if type(value['verification_run_id']) is not int or not 0 < value['verification_run_id'] < 10**16:
        raise ValueError('marker_run')
    fixed = baseline()
    for field in ('app_hashes', 'protected_hashes', 'code_inputs_sha256'):
        if value[field] != fixed[field]:
            raise ValueError('marker_preserved_source_drift')
    if value['worker_before'] != fixed['worker_hashes']:
        raise ValueError('marker_native_baseline')
    validate_worker_change(value['worker_before'], value['worker_after'])
    if not isinstance(value['runtime_image'], str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', value['runtime_image']):
        raise ValueError('marker_runtime')
    if value['public_sources'] != public_hashes():
        raise ValueError('marker_public_sources')
    return value


def validate_report(marker, report):
    if (not isinstance(report, dict) or report.get('format') != 'shift-aware-minibatch-acceptance-v1'
            or report.get('status') != 'shift_aware_minibatch_pass' or report.get('release_gate_complete') is not True
            or report.get('production_writes') is not False):
        raise ValueError('acceptance_incomplete')
    if any(report.get(name) != marker[name] for name in FIELDS):
        raise ValueError('acceptance_provenance')
    validate_container_report(dict(report, format='shift-aware-minibatch-container-v1', all_checks_passed=True))


def marker_from_report(report, candidate, run_id):
    marker = {'schema': 1, 'candidate_commit': candidate, 'verification_run_id': run_id,
              **{name: report[name] for name in FIELDS}}
    validate_marker(marker); validate_report(marker, report)
    return marker


def load_marker(path):
    return validate_marker(read_json(path))


def report_from_log(data):
    if not isinstance(data, bytes) or len(data) > 8 * 1024 * 1024:
        raise ValueError('verification_log_bound')
    rows = []
    for line in data.decode('utf-8').splitlines():
        found = re.fullmatch(r'(?:[0-9T:.+Z -]+)?SHIFT_AWARE_VERIFICATION (.{1,131072})', line)
        if found:
            rows.append(json.loads(found.group(1)))
    if len(rows) != 1:
        raise ValueError('verification_receipt_missing_or_duplicate')
    return rows[0]


def validate_run(marker, run):
    if (not isinstance(run, dict) or run.get('id') != marker['verification_run_id']
            or run.get('status') != 'completed' or run.get('conclusion') != 'success'
            or run.get('head_sha') != marker['candidate_commit'] or run.get('head_branch') != BRANCH
            or run.get('path') != WORKFLOW or run.get('repository', {}).get('full_name') != REPOSITORY):
        raise ValueError('verification_run_mismatch')


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        if urllib.parse.urlparse(url).scheme != 'https':
            raise ValueError('insecure_api_redirect')
        redirected = super().redirect_request(request, response, code, message, headers, url)
        if redirected is not None and urllib.parse.urlparse(url).netloc != urllib.parse.urlparse(request.full_url).netloc:
            redirected.remove_header('Authorization')
        return redirected


def github_read(path, token, maximum=2 * 1024 * 1024):
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=20) as response:
        data = response.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError('verification_response_bound')
    return data


def verify(path):
    marker = load_marker(path)
    if os.environ.get('GITHUB_REF') != 'refs/heads/' + BRANCH or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('release_scope')
    head = os.environ.get('GITHUB_SHA', '')
    if not COMMIT.fullmatch(head):
        raise ValueError('release_head')
    subprocess.run(['git', 'merge-base', '--is-ancestor', marker['candidate_commit'], head], cwd=REPO,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    changed = subprocess.run(['git', 'diff', '--name-only', marker['candidate_commit'], head], cwd=REPO,
                             check=True, capture_output=True, text=True).stdout.splitlines()
    if set(changed) != {MARKER}:
        raise ValueError('release_requires_marker_only_diff')
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        raise ValueError('release_read_token')
    run_path = '/actions/runs/' + str(marker['verification_run_id'])
    validate_run(marker, json.loads(github_read(run_path, token)))
    jobs = json.loads(github_read(run_path + '/jobs?filter=latest&per_page=100', token))
    if not isinstance(jobs, dict) or jobs.get('total_count') != 1 or len(jobs.get('jobs', [])) != 1:
        raise ValueError('verification_job_count')
    job = jobs['jobs'][0]
    if (type(job.get('id')) is not int or job['id'] <= 0 or job.get('name') != 'verify'
            or job.get('status') != 'completed' or job.get('conclusion') != 'success'
            or job.get('head_sha') != marker['candidate_commit']):
        raise ValueError('verification_job_mismatch')
    report = report_from_log(github_read('/actions/jobs/' + str(job['id']) + '/logs', token, 8 * 1024 * 1024))
    validate_report(marker, report)
    print('SHIFT_AWARE_EXACT_NATIVE_ACCEPTANCE_VERIFIED')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--marker', required=True)
    args = parser.parse_args()
    try:
        verify(args.marker)
    except Exception:
        print('SHIFT_AWARE_RELEASE_GUARD_REJECTED')
        raise SystemExit(6)
