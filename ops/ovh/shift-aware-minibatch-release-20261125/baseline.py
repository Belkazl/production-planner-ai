"""Explicitly derive a future native baseline from accepted, deployed UI hashes."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contract import baseline, baseline_from_presentation, read_json


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--presentation-report', type=Path)
    parser.add_argument('--candidate'); parser.add_argument('--verification-run', type=int)
    parser.add_argument('--deployed-commit'); parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        if args.check:
            if any((args.presentation_report, args.candidate, args.verification_run, args.deployed_commit, args.output)):
                raise ValueError()
            baseline()
            print('SHIFT_AWARE_BASELINE_READY')
        else:
            if not all((args.presentation_report, args.candidate, args.verification_run, args.deployed_commit, args.output)):
                raise ValueError()
            result = baseline_from_presentation(read_json(args.presentation_report), args.candidate,
                                                args.verification_run, args.deployed_commit)
            args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
            print('SHIFT_AWARE_EXPLICIT_BASELINE_WRITTEN')
    except Exception:
        print('SHIFT_AWARE_BASELINE_NOT_READY')
        raise SystemExit(6)
