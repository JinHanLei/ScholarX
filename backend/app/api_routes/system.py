import os
import subprocess
import sys
from datetime import datetime

from .common import api, body, ok
from ..services.llm import list_available_models
from ..services.skills import install_skill, list_skills, uninstall_skill


@api.get("/llm/models")
def llm_models_route():
    try:
        return ok(list_available_models())
    except Exception as exc:
        fallback_model = os.getenv("LLM_MODEL", "")
        return ok({
            "default_model": fallback_model,
            "models": [{"id": fallback_model, "name": fallback_model}] if fallback_model else [],
            "error": str(exc),
        })


@api.get("/skills")
def skills():
    return ok({"skills": list_skills()})


@api.post("/skills/<skill_id>/install")
def install_skill_route(skill_id):
    skill = install_skill(skill_id)
    if not skill:
        return ok({"error": "skill not found"}, 404)
    return ok({"skill": skill})


@api.post("/skills/<skill_id>/uninstall")
def uninstall_skill_route(skill_id):
    uninstall_skill(skill_id)
    return ok({"removed": True})


@api.post("/admin/data-init")
def run_data_init():
    payload = body()
    command = [sys.executable, "/app/scripts/init_data.py"]
    if payload.get("skip_download"):
        command.append("--skip-download")
    if payload.get("skip_dblp_insert"):
        command.append("--skip-dblp-insert")
    if payload.get("skip_ccf"):
        command.append("--skip-ccf")
    if payload.get("dblp_dir"):
        command.extend(["--dblp-dir", payload["dblp_dir"]])
    if payload.get("ccf_csv"):
        command.extend(["--ccf-csv", payload["ccf_csv"]])

    started = datetime.utcnow().isoformat()
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return ok({"pid": proc.pid, "started_at": started, "command": command})

