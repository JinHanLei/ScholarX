#!/usr/bin/env python3
"""Run the default EasyRef data initialization pipeline."""

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CCF = ROOT / "ccf_2022_with_dblp_key.csv"
DEFAULT_DBLP_DIR = ROOT / "dblp"
DEFAULT_LOG_DIR = ROOT / "logs"


def main():
    parser = argparse.ArgumentParser(description="Download DBLP, import papers, and load CCF rankings.")
    parser.add_argument("--skip-download", action="store_true", help="Use existing dblp.xml/dblp.dtd.")
    parser.add_argument("--skip-dblp-insert", action="store_true", help="Skip DBLP XML parsing and insertion.")
    parser.add_argument("--skip-ccf", action="store_true", help="Skip CCF CSV insertion.")
    parser.add_argument("--ccf-csv", default=str(DEFAULT_CCF), help="CCF CSV path.")
    parser.add_argument("--dblp-dir", default=str(DEFAULT_DBLP_DIR), help="Directory for DBLP XML/DTD files.")
    parser.add_argument("--log-dir", default=str(DEFAULT_LOG_DIR), help="Log directory.")
    args = parser.parse_args()

    dblp_dir = Path(args.dblp_dir)
    steps = []
    skip_dblp_insert = args.skip_dblp_insert
    if not args.skip_download:
        command = [sys.executable, str(Path(__file__).with_name("download_dblp.py"))]
        print("Running:", " ".join(command), flush=True)
        exit_code = subprocess.call(command, cwd=str(ROOT))
        if exit_code == 2:
            print("DBLP XML is unchanged; skipping insert_dblp.py.", flush=True)
            skip_dblp_insert = True
        elif exit_code != 0:
            raise SystemExit(exit_code)
    if not skip_dblp_insert:
        steps.append(
            [
                sys.executable,
                str(Path(__file__).with_name("insert_dblp.py")),
                "--xml_filename",
                str(dblp_dir / "dblp.xml"),
                "--dtd_filename",
                str(dblp_dir / "dblp.dtd"),
            ]
        )
    if not args.skip_ccf:
        steps.append([sys.executable, str(Path(__file__).with_name("insert_venue.py")), args.ccf_csv])

    for command in steps:
        print("Running:", " ".join(command), flush=True)
        exit_code = subprocess.call(command, cwd=str(ROOT))
        if exit_code != 0:
            raise SystemExit(exit_code)

    print("Initialization complete.", flush=True)


if __name__ == "__main__":
    main()
