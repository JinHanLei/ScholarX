#!/usr/bin/env python3
"""Simple weekly scheduler for DBLP refresh jobs."""

import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


SCRIPT_DIR = Path(__file__).resolve().parent


def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def next_run(now):
    # Python Monday=0 ... Sunday=6.
    weekday = int(os.getenv("SCHEDULE_DBLP_WEEKDAY", "6"))
    hour = int(os.getenv("SCHEDULE_DBLP_HOUR", "23"))
    minute = int(os.getenv("SCHEDULE_DBLP_MINUTE", "30"))
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    days = (weekday - now.weekday()) % 7
    candidate = candidate + timedelta(days=days)
    if candidate <= now:
        candidate = candidate + timedelta(days=7)
    return candidate


def run_job():
    command = [sys.executable, str(SCRIPT_DIR / "init_data.py")]
    if env_bool("SCHEDULE_DBLP_SKIP_CCF", True):
        command.append("--skip-ccf")

    print(f"[scheduler] Running: {' '.join(command)}", flush=True)
    exit_code = subprocess.call(command, cwd=str(SCRIPT_DIR.parent))
    print(f"[scheduler] Job finished with exit code {exit_code}", flush=True)


def main():
    if not env_bool("SCHEDULE_DBLP_ENABLED", True):
        print("[scheduler] Disabled by SCHEDULE_DBLP_ENABLED=false", flush=True)
        while True:
            time.sleep(3600)

    tz = ZoneInfo(os.getenv("TZ", "Asia/Shanghai"))
    print("[scheduler] DBLP weekly scheduler started.", flush=True)
    while True:
        now = datetime.now(tz)
        target = next_run(now)
        seconds = max(1, int((target - now).total_seconds()))
        print(f"[scheduler] Next DBLP refresh: {target.isoformat()}", flush=True)
        time.sleep(seconds)
        run_job()


if __name__ == "__main__":
    main()
