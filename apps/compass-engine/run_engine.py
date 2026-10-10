"""Запуск движка Compass под управлением ORION: `python run_engine.py`.

Параметры — только окружением (их задаёт apps/api/src/markets/compass-engine.service.ts):
COMPASS_DATA_DIR, COMPASS_PORT, COMPASS_SESSION_TOKEN. Слушает 127.0.0.1; API защищён токеном сессии
(куки HttpOnly), как и в самостоятельном Compass.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from compass.__main__ import build_services  # noqa: E402
from compass.api.app import create_app  # noqa: E402
from compass.config import Config  # noqa: E402


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    token = os.environ.get("COMPASS_SESSION_TOKEN")
    if not token:
        raise SystemExit("COMPASS_SESSION_TOKEN обязателен: движок без токена не запускается под ORION")
    cfg = Config.from_env()
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    uvicorn.run(create_app(build_services(cfg), session_token=token), host=cfg.host, port=cfg.port, log_level="warning")


if __name__ == "__main__":
    main()
