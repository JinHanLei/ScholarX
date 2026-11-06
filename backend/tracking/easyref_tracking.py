"""Dependency-free training telemetry. EasyRef supplies EASYREF_TRACKING_DIR.

    from easyref_tracking import log_metrics
    log_metrics({'train/loss': loss, 'validation/loss': val_loss}, step=epoch)

One append-only file per process avoids distributed workers overwriting each
other. This records intermediate measurements, never final test results.
"""
import json
import math
import os
import re
import threading
import time
from pathlib import Path

_lock = threading.Lock()


def log_metrics(metrics, step=0):
    if not isinstance(step, int) or isinstance(step, bool) or step < 0:
        raise ValueError('step must be a non-negative integer')
    if not isinstance(metrics, dict) or not 1 <= len(metrics) <= 100:
        raise ValueError('metrics must contain 1–100 numeric measurements')
    for key, value in metrics.items():
        if not isinstance(key, str) or not re.fullmatch(r'[\w .\-/]{1,180}', key) or key.startswith(('system/', 'final/')):
            raise ValueError('Invalid or reserved metric name: ' + str(key))
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError('Metrics must be finite numbers')
    directory = os.environ.get('EASYREF_TRACKING_DIR')
    if not directory:
        return False  # Standalone validation outside the executor remains usable.
    entry = {'metrics': metrics, 'step': step, 'timestamp': int(time.time() * 1000)}
    with _lock:
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)
        with (path / f'training-{os.getpid()}.jsonl').open('a', encoding='utf8') as stream:
            stream.write(json.dumps(entry, ensure_ascii=False, allow_nan=False) + '\n')
    return True
