"""Require exact accepted app bytes and unchanged native/auth sources."""
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
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import capture
from verify import public_hashes
from container_gate import APP_CHECKS, WORKER_CHECKS

REPOSITORY = 'Belkazl/production-planner-ai'
BRANCH = 'fix/gantt-zoom-500-20261124'
WORKFLOW = '.github/workflows/liftorbit-integrated-setup-verify-20261125.yml'
MARKER = 'ops/ovh/integrated-setup-release-20261125/release.json'
SHA = re.compile(r'[0-9a-f]{64}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')
FIELDS = ('app_before', 'app_after', 'protected_hashes', 'worker_hashes',
          'code_inputs_sha256', 'runtime_image', 'public_sources', 'build_fixtures_updated',
          'legacy_build_before_passed', 'legacy_build_after_passed')


def baseline():
    return json.loads((HERE / 'baseline.json').read_bytes())


def validate_marker(value):
    if not isinstance(value, dict) or set(value) != {'schema', 'candidate_commit', 'verification_run_id', *FIELDS} or value.get('schema') != 1:
        raise ValueError('marker_schema')
    if not isinstance(value['candidate_commit'], str) or not COMMIT.fullmatch(value['candidate_commit']):
        raise ValueError('marker_commit')
    if type(value['verification_run_id']) is not int or not 0 < value['verification_run_id'] < 10**16:
        raise ValueError('marker_run')
    fixed = baseline()
    for key, expected in (('protected_hashes', fixed['protected_hashes']),
                          ('worker_hashes', fixed['worker_hashes']), ('code_inputs_sha256', fixed['code_inputs_sha256'])):
        if value[key] != expected:
            raise ValueError('marker_baseline_drift')
    before = value['app_before']
    if (not isinstance(before, dict) or set(before) != set(capture.APP_FILES)
            or any(not isinstance(item, str) or not SHA.fullmatch(item) for item in before.values())
            or any(before.get(name) != sha for name, sha in fixed['app_hashes'].items())):
        raise ValueError('marker_app_baseline')
    if (type(value['legacy_build_before_passed']) is not bool or value['legacy_build_after_passed'] is not True
            or value['build_fixtures_updated'] is not (not value['legacy_build_before_passed'])):
        raise ValueError('marker_build_tests')
    changes = set(capture.WRITE_FILES) | (set(capture.BUILD_TEST_FILES) if value['build_fixtures_updated'] else set())
    after = value['app_after']
    if (not isinstance(after, dict) or set(after) != set(capture.APP_FILES)
            or any(not isinstance(item, str) or not SHA.fullmatch(item) for item in after.values())
            or {name for name in after if after[name] != value['app_before'][name]} != changes):
        raise ValueError('marker_exact_app_overlay')
    if not isinstance(value['runtime_image'], str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', value['runtime_image']):
        raise ValueError('marker_runtime')
    if (not isinstance(value['public_sources'], dict) or value['public_sources'] != public_hashes()):
        raise ValueError('marker_public_sources')
    return value


def validate_report(marker, report):
    if (not isinstance(report, dict) or report.get('format') != 'integrated-setup-acceptance-v1'
            or report.get('status') != 'integrated_setup_pass' or report.get('release_gate_complete') is not True
            or report.get('production_writes') is not False or report.get('native_eleven_verified') is not True
            or type(report.get('native_case_count')) is not int or report['native_case_count'] != 11):
        raise ValueError('acceptance_incomplete')
    if any(report.get(name) != marker[name] for name in FIELDS):
        raise ValueError('acceptance_provenance')
    for key, checks in (('worker_checks', WORKER_CHECKS), ('app_checks', APP_CHECKS)):
        if (not isinstance(report.get(key), dict) or set(report[key]) != set(checks)
                or any(value is not True for value in report[key].values())):
            raise ValueError('acceptance_checks')


def marker_from_report(report, candidate, run):
    value = {'schema': 1, 'candidate_commit': candidate, 'verification_run_id': run,
             **{name: report[name] for name in FIELDS}}
    validate_marker(value); validate_report(value, report)
    return value


def load_marker(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 131072:
        raise ValueError('marker_bound')
    return validate_marker(json.loads(path.read_bytes()))


def report_from_log(data):
    if not isinstance(data, bytes) or len(data) > 8 * 1024 * 1024:
        raise ValueError('verification_log_bound')
    rows = []
    for line in data.decode('utf-8').splitlines():
        match = re.fullmatch(r'(?:[0-9T:.+Z -]+)?INTEGRATED_SETUP_VERIFICATION (.{1,131072})', line)
        if match:
            rows.append(json.loads(match.group(1)))
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


def github_read(path, token, limit=2 * 1024 * 1024):
    request = urllib.request.Request('https://api.github.com/repos/' + REPOSITORY + path,
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=20) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('verification_response_bound')
    return data


def verify(path):
    value = load_marker(path)
    if os.environ.get('GITHUB_REF') != 'refs/heads/' + BRANCH or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ValueError('release_scope')
    head = os.environ.get('GITHUB_SHA', '')
    if not COMMIT.fullmatch(head):
        raise ValueError('release_head')
    subprocess.run(['git', 'merge-base', '--is-ancestor', value['candidate_commit'], head], cwd=REPO,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    changed = subprocess.run(['git', 'diff', '--name-only', value['candidate_commit'], head], cwd=REPO,
                             check=True, capture_output=True, text=True).stdout.splitlines()
    if set(changed) - {MARKER}:
        raise ValueError('release_unverified_diff')
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        raise ValueError('release_read_token')
    run_path = '/actions/runs/' + str(value['verification_run_id'])
    validate_run(value, json.loads(github_read(run_path, token)))
    jobs = json.loads(github_read(run_path + '/jobs?filter=latest&per_page=100', token))
    if not isinstance(jobs, dict) or jobs.get('total_count') != 1 or len(jobs.get('jobs', [])) != 1:
        raise ValueError('verification_job_count')
    job = jobs['jobs'][0]
    if (type(job.get('id')) is not int or job['id'] <= 0 or job.get('name') != 'verify'
            or job.get('status') != 'completed' or job.get('conclusion') != 'success'
            or job.get('head_sha') != value['candidate_commit']):
        raise ValueError('verification_job_mismatch')
    validate_report(value, report_from_log(github_read('/actions/jobs/' + str(job['id']) + '/logs', token, limit=8 * 1024 * 1024)))
    print('INTEGRATED_SETUP_NATIVE_AND_APP_ACCEPTANCE_VERIFIED')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--marker', required=True)
    args = parser.parse_args()
    try:
        verify(args.marker)
    except Exception:
        print('INTEGRATED_SETUP_RELEASE_GUARD_REJECTED')
        raise SystemExit(6)
