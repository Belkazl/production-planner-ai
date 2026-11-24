"""Validate a deliberate release marker and its successful native test run."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
MARKER_PATH = "ops/ovh/joint-minibatch-release-20261124/release.json"
BRANCH = "fix/gantt-zoom-500-20261124"
REPOSITORY = "Belkazl/production-planner-ai"
VERIFY_WORKFLOW = ".github/workflows/liftorbit-native-batching-verify-20261124.yml"
SHA = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
PACKAGE_NAME = re.compile(r"ga_workers/[A-Za-z_][A-Za-z0-9_]*\.py\Z")
CHANGED_PACKAGE = {"ga_workers/full_runtime_adapter.py", "ga_workers/joint_minibatch.py",
                   "ga_workers/joint_continuation.py"}
PUBLIC_PATHS = (
    "ops/ovh/joint-minibatch-release-20261124/prepare_overlay.py",
    "ops/ovh/joint-minibatch-release-20261124/release_guard.py",
    "ops/ovh/joint-minibatch-release-20261124/stage.py",
    "ops/ovh/joint-minibatch-release-20261124/release.sh",
    ".github/workflows/liftorbit-joint-minibatch-release-20261124.yml",
    "ops/ovh/joint-minibatch-search-20261124/joint_minibatch.py",
    "ops/ovh/joint-minibatch-search-20261124/patch.py",
    "ops/ovh/native-batching-continuation-20261124/joint_continuation.py",
    "ops/ovh/native-batching-continuation-20261124/patch_worker.py",
    "ops/ovh/native-batching-continuation-20261124/continuation.mjs",
    "ops/ovh/native-batching-continuation-20261124/patch.mjs",
    "ops/ovh/native-batching-continuation-20261124/selected_genome_ui.mjs",
    "ops/ovh/native-batching-continuation-20261124/patch_ui.mjs",
    "ops/ovh/native-batching-continuation-20261124/test_ui.mjs",
    "ops/ovh/native-batching-verify-20261124/native_input_contract.py",
    "ops/ovh/native-batching-verify-20261124/verify_native.py",
    "ops/ovh/native-batching-verify-20261124/regression_cases.py",
    VERIFY_WORKFLOW,
)
OVERLAY_PUBLIC_PATHS = (
    "ops/ovh/joint-minibatch-release-20261124/prepare_overlay.py",
    "ops/ovh/joint-minibatch-search-20261124/patch.py",
    "ops/ovh/joint-minibatch-search-20261124/joint_minibatch.py",
    "ops/ovh/native-batching-continuation-20261124/patch_worker.py",
    "ops/ovh/native-batching-continuation-20261124/joint_continuation.py",
)


def validate_marker(value):
    keys = {"schema", "candidate_commit", "verification_run_id", "code_inputs_sha256",
            "package_before", "package_after", "public_sources"}
    if not isinstance(value, dict) or set(value) != keys or value.get("schema") != 1:
        raise ValueError("release_marker_schema")
    if not isinstance(value["candidate_commit"], str) or not COMMIT.fullmatch(value["candidate_commit"]):
        raise ValueError("release_candidate_commit")
    if type(value["verification_run_id"]) is not int or not 1 <= value["verification_run_id"] <= 10**16:
        raise ValueError("release_verification_run_id")
    if not isinstance(value["code_inputs_sha256"], str) or not SHA.fullmatch(value["code_inputs_sha256"]):
        raise ValueError("release_code_inputs_hash")
    for name in ("package_before", "package_after"):
        mapping = value[name]
        if (not isinstance(mapping, dict) or not 7 <= len(mapping) <= 64
                or any(not isinstance(key, str) or not PACKAGE_NAME.fullmatch(key)
                       or not isinstance(digest, str) or not SHA.fullmatch(digest) for key, digest in mapping.items())):
            raise ValueError("release_package_hashes")
    before, after = value["package_before"], value["package_after"]
    required = {"ga_workers/__init__.py", "ga_workers/compile_legacy_ga.py", "ga_workers/full_runtime_adapter.py",
                "ga_workers/continuation.py", "ga_workers/constraints.py", "ga_workers/operation_interleave.py",
                "ga_workers/batch_size_diagnostics.py"}
    if not required.issubset(before) or not required.issubset(after) or set(before) - set(after):
        raise ValueError("release_required_worker_file")
    if set(after) - set(before) - (CHANGED_PACKAGE - {"ga_workers/full_runtime_adapter.py"}):
        raise ValueError("release_unexpected_worker_addition")
    if {key for key in after if before.get(key) != after[key]} - CHANGED_PACKAGE:
        raise ValueError("release_unrelated_worker_change")
    if not CHANGED_PACKAGE.issubset(after):
        raise ValueError("release_joint_module_missing")
    public = value["public_sources"]
    if (not isinstance(public, dict) or set(public) != set(PUBLIC_PATHS)
            or any(not isinstance(digest, str) or not SHA.fullmatch(digest) for digest in public.values())):
        raise ValueError("release_public_source_hashes")
    return value


def load_marker(path):
    data = Path(path).read_bytes()
    if len(data) > 128000:
        raise ValueError("release_marker_too_large")
    return validate_marker(json.loads(data))


def public_hashes():
    return {name: hashlib.sha256((REPO / name).read_bytes()).hexdigest() for name in PUBLIC_PATHS}


def validate_run(marker, run):
    if (not isinstance(run, dict) or run.get("id") != marker["verification_run_id"]
            or run.get("status") != "completed" or run.get("conclusion") != "success"
            or run.get("head_sha") != marker["candidate_commit"] or run.get("head_branch") != BRANCH
            or run.get("path") != VERIFY_WORKFLOW
            or run.get("repository", {}).get("full_name") != REPOSITORY):
        raise ValueError("release_native_verification_not_confirmed")


def validate_report(marker, report):
    """A successful diagnostic run alone is not an accepted release gate."""
    if (not isinstance(report, dict) or report.get("format") != "native-minibatch-verification-v1"
            or report.get("status") != "native_witness_pass"
            or report.get("release_gate_complete") is not True
            or report.get("ordered_continuation_verified") is not True):
        raise ValueError("release_native_acceptance_incomplete")
    provenance = report.get("provenance")
    if (not isinstance(provenance, dict)
            or provenance.get("source_hashes") != marker["package_before"]
            or provenance.get("candidate_source_hashes") != marker["package_after"]
            or provenance.get("code_inputs_sha256") != marker["code_inputs_sha256"]
            or provenance.get("native_code_changed") is not True
            or provenance.get("production_writes") is not False):
        raise ValueError("release_native_acceptance_provenance")
    overlay = provenance.get("overlay")
    # The native harness roots its public overlay at ops/ovh. Only our fixed
    # dependency names lose that exact prefix; report paths are never rewritten
    # or normalized, so aliases/traversals/full-prefix keys remain rejected.
    expected_helpers = {name.removeprefix("ops/ovh/"): marker["public_sources"][name]
                        for name in OVERLAY_PUBLIC_PATHS}
    expected_changes = sorted(name for name, digest in marker["package_after"].items()
                              if marker["package_before"].get(name) != digest)
    if (not isinstance(overlay, dict) or overlay.get("format") != "reviewed-public-native-overlay-v1"
            or overlay.get("public_helper_hashes") != expected_helpers
            or overlay.get("changed_package_files") != expected_changes):
        raise ValueError("release_native_acceptance_overlay")


def report_from_job_log(data):
    if not isinstance(data, bytes) or len(data) > 8 * 1024 * 1024:
        raise ValueError("release_native_log_bound")
    prefix = "NATIVE_BATCHING_VERIFICATION "
    records = []
    for line in data.decode("utf-8").splitlines():
        offset = line.find(prefix)
        if offset < 0:
            continue
        # A shell command echoed by Actions is not an emitted report. Permit
        # only its normal timestamp prefix or no prefix at all.
        if line[:offset] and not re.fullmatch(r"[0-9T:.+Z -]+", line[:offset]):
            continue
        payload = line[offset + len(prefix):]
        if len(payload.encode("utf-8")) > 1024 * 1024:
            raise ValueError("release_native_report_bound")
        records.append(json.loads(payload))
    if len(records) != 1:
        raise ValueError("release_native_report_missing_or_duplicate")
    return records[0]


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        if urllib.parse.urlparse(url).scheme != "https":
            raise ValueError("release_api_insecure_redirect")
        redirected = super().redirect_request(request, response, code, message, headers, url)
        if redirected is not None and urllib.parse.urlparse(url).netloc != urllib.parse.urlparse(request.full_url).netloc:
            # Actions log downloads use a short-lived blob URL. Never forward
            # the GitHub API token to that different host.
            redirected.remove_header("Authorization")
        return redirected


def github_read(path, token, limit=2 * 1024 * 1024):
    request = urllib.request.Request("https://api.github.com/repos/" + REPOSITORY + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"})
    opener = urllib.request.build_opener(SafeRedirect())
    with opener.open(request, timeout=20) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("release_verification_response_too_large")
    return data


def verify(path):
    marker = load_marker(path)
    if os.environ.get("GITHUB_REF") != "refs/heads/" + BRANCH or os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise ValueError("release_repository_or_branch")
    head = os.environ.get("GITHUB_SHA", "")
    if not COMMIT.fullmatch(head):
        raise ValueError("release_head_invalid")
    subprocess.run(["git", "merge-base", "--is-ancestor", marker["candidate_commit"], head], cwd=REPO,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    changed = subprocess.run(["git", "diff", "--name-only", marker["candidate_commit"], head], cwd=REPO,
                             check=True, capture_output=True, text=True).stdout.splitlines()
    if set(changed) - {MARKER_PATH}:
        raise ValueError("release_unverified_commit_changes")
    if marker["public_sources"] != public_hashes():
        raise ValueError("release_public_source_drift")
    # The successful same-head workflow must actually select the public repair
    # overlay. A baseline-only run is not evidence for this deployment.
    if "--public-overlay" not in (REPO / VERIFY_WORKFLOW).read_text():
        raise ValueError("release_verifier_has_no_overlay_gate")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("release_readonly_github_token_missing")
    run_path = "/actions/runs/" + str(marker["verification_run_id"])
    validate_run(marker, json.loads(github_read(run_path, token)))
    jobs = json.loads(github_read(run_path + "/jobs?filter=latest&per_page=100", token))
    if not isinstance(jobs, dict) or jobs.get("total_count") != 1 or not isinstance(jobs.get("jobs"), list) or len(jobs["jobs"]) != 1:
        raise ValueError("release_native_job_contract")
    job = jobs["jobs"][0]
    if (not isinstance(job, dict) or type(job.get("id")) is not int or job["id"] < 1
            or job.get("name") != "verify" or job.get("status") != "completed"
            or job.get("conclusion") != "success" or job.get("head_sha") != marker["candidate_commit"]):
        raise ValueError("release_native_job_not_successful")
    log = github_read("/actions/jobs/" + str(job["id"]) + "/logs", token, limit=8 * 1024 * 1024)
    validate_report(marker, report_from_job_log(log))
    print("JOINT_RELEASE_NATIVE_RUN_AND_COMMIT_VERIFIED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--marker", type=Path)
    parser.add_argument("--public-hashes", action="store_true")
    args = parser.parse_args()
    try:
        if args.public_hashes:
            print(json.dumps(public_hashes(), sort_keys=True, separators=(",", ":")))
        elif args.marker:
            verify(args.marker)
        else:
            raise ValueError("release_marker_required")
    except Exception as error:
        # Never print API response bodies, token values, source text or paths.
        print("JOINT_RELEASE_GUARD_FAILED", str(error) if type(error) is ValueError else type(error).__name__)
        raise SystemExit(1)
