import json
import os
from datetime import datetime
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
SKILL_ROOT = Path(os.getenv("SKILL_ROOT", str(BACKEND_ROOT / "skills")))
SKILL_STATE_PATH = Path(os.getenv("SKILL_STATE_PATH", str(BACKEND_ROOT / "data" / "installed_skills.json")))
CATALOG_PATH = Path(os.getenv("SKILL_CATALOG_PATH", str(SKILL_ROOT / "catalog.json")))


def _read_json(path, default):
    try:
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return default
    return default


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def _catalog():
    data = _read_json(CATALOG_PATH, {"skills": []})
    return data.get("skills", []) if isinstance(data, dict) else []


def _state():
    data = _read_json(SKILL_STATE_PATH, {"installed": {}})
    installed = data.get("installed", {})
    return installed if isinstance(installed, dict) else {}


def list_skills():
    installed = _state()
    skills = []
    for skill in _catalog():
        skill_id = skill.get("id")
        if not skill_id:
            continue
        skills.append(
            {
                **skill,
                "installed": skill_id in installed,
                "installed_at": installed.get(skill_id, {}).get("installed_at"),
            }
        )
    return skills


def get_skill(skill_id):
    return next((skill for skill in list_skills() if skill.get("id") == skill_id), None)


def install_skill(skill_id):
    skill = get_skill(skill_id)
    if not skill:
        return None
    installed = _state()
    installed[skill_id] = {"installed_at": datetime.utcnow().isoformat()}
    _write_json(SKILL_STATE_PATH, {"installed": installed})
    return get_skill(skill_id)


def uninstall_skill(skill_id):
    installed = _state()
    installed.pop(skill_id, None)
    _write_json(SKILL_STATE_PATH, {"installed": installed})
    return True


def resolve_installed_skills(skill_ids):
    requested = set(skill_ids or [])
    return [
        skill
        for skill in list_skills()
        if skill.get("installed") and skill.get("id") in requested
    ]
