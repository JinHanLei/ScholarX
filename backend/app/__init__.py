import os
from flask import Flask, jsonify
from flask_cors import CORS

from .db import ensure_schema
from .routes import api


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = int(os.getenv("MAX_UPLOAD_MB", "50")) * 1024 * 1024
    app.config["UPLOAD_FOLDER"] = os.getenv("UPLOAD_FOLDER", "/app/uploads")
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", "*")}})
    app.register_blueprint(api, url_prefix="/api")
    try:
        ensure_schema()
    except Exception as exc:
        app.logger.warning("Database schema migration skipped: %s", exc)

    @app.get("/health")
    def health():
        return jsonify({"status": "ok"})

    return app
