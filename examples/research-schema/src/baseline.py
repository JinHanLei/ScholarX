"""Synthetic integration fixture, not a scientific result."""
import json
from pathlib import Path
values = [1, 2, 3, 4]
Path("results.json").write_text(json.dumps({"count": len(values), "mean": sum(values)/len(values)}), encoding="utf-8")
print("TEST DATA: computed mean of four integers")
