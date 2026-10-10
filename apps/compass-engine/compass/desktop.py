"""Десктопное окно: движок в фоновом потоке + нативное окно WebView2 (pywebview).

Запуск: `python -m compass.desktop`. Один процесс, один порт (случайный свободный,
если не задан COMPASS_PORT) — интерфейс раздаётся тем же сервером, что и API.

Фоновый режим: закрытие окна прячет его в трей, движок продолжает искать сигналы;
выход — через меню значка. Экземпляр один: повторный запуск показывает уже
работающее окно, иначе два сканера слали бы одни и те же уведомления.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn

from compass.__main__ import build_services
from compass.api.app import create_app, static_dir
from compass.api.guard import COOKIE
from compass.autostart import TRAY_FLAG
from compass.config import Config

log = logging.getLogger("compass.desktop")
START_TIMEOUT_S = 20.0
INSTANCE_FILE = "instance.json"
TRAY_HINT = "Compass продолжает следить за сигналами. Открыть окно или выйти — через этот значок."


def write_instance(data_dir: Path, port: int, token: str) -> None:
    """Адрес работающего экземпляра для повторного запуска. Токен лежит в профиле пользователя:
    защита API — от чужих сайтов, а не от программ этого же пользователя (см. api/guard.py)."""
    tmp = data_dir / (INSTANCE_FILE + ".tmp")
    tmp.write_text(json.dumps({"pid": os.getpid(), "port": port, "token": token}), encoding="utf-8")
    tmp.replace(data_dir / INSTANCE_FILE)


def clear_instance(data_dir: Path) -> None:
    (data_dir / INSTANCE_FILE).unlink(missing_ok=True)


def show_running_instance(data_dir: Path, host: str = "127.0.0.1", timeout: float = 2.0) -> bool:
    """True — другой экземпляр жив и показал своё окно. Файл от упавшего процесса не мешает запуску."""
    try:
        info = json.loads((data_dir / INSTANCE_FILE).read_text(encoding="utf-8"))
        port, token = int(info["port"]), str(info["token"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    req = urllib.request.Request(
        f"http://{host}:{port}/api/app/show",
        data=b"{}",
        method="POST",
        headers={"Content-Type": "application/json", "Cookie": f"{COOKIE}={token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


def tray_image(size: int = 64) -> Any:
    """Значок рисуется кодом (тот же рисунок — в packaging/compass.ico для exe)."""
    from PIL import Image, ImageDraw

    k = size / 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((2 * k, 2 * k, size - 2 * k, size - 2 * k), fill=(37, 99, 235, 255))
    d.ellipse((10 * k, 10 * k, size - 10 * k, size - 10 * k), outline=(255, 255, 255, 255), width=round(3 * k))
    # стрелка компаса: светлая половина — «север»
    d.polygon([(42 * k, 22 * k), (36 * k, 36 * k), (28 * k, 28 * k)], fill=(255, 255, 255, 255))
    d.polygon([(22 * k, 42 * k), (36 * k, 36 * k), (28 * k, 28 * k)], fill=(147, 197, 253, 255))
    return img


class Shell:
    """Окно и значок в трее. Закрытие окна в фоновом режиме прячет его, а не останавливает движок."""

    def __init__(self, settings: Any) -> None:
        self._settings = settings
        self.window: Any | None = None
        self.icon: Any | None = None
        self._quitting = False
        self._minimized = False
        self._hinted = False

    @property
    def tray(self) -> bool:
        return self.icon is not None

    def attach(self, window: Any) -> None:
        self.window = window
        window.events.closing += self._on_closing
        window.events.minimized += lambda: setattr(self, "_minimized", True)
        window.events.restored += lambda: setattr(self, "_minimized", False)
        window.events.maximized += lambda: setattr(self, "_minimized", False)

    def start_tray(self) -> None:
        """Без pystray/Pillow или при сбое трея приложение работает по-старому: закрыл окно — вышел."""
        try:
            import pystray

            icon = pystray.Icon(
                "compass",
                tray_image(),
                "Compass",
                menu=pystray.Menu(
                    pystray.MenuItem("Открыть Compass", lambda: self.show(), default=True),
                    pystray.MenuItem("Выход", lambda: self.quit()),
                ),
            )
            icon.run_detached()
        except Exception:
            log.exception("Значок в трее не создан: фоновый режим выключен")
            return
        self.icon = icon

    def stop_tray(self) -> None:
        icon, self.icon = self.icon, None
        if icon is not None:
            try:
                icon.stop()
            except Exception:
                log.exception("Значок в трее не остановился")

    def show(self) -> None:
        if self.window is None:
            return
        self.window.show()
        if self._minimized:
            self.window.restore()

    def quit(self) -> None:
        self._quitting = True
        if self.window is not None:
            self.window.destroy()

    def keeps_running(self) -> bool:
        return self.tray and not self._quitting and bool(self._settings.get("background_mode"))

    def _on_closing(self) -> bool | None:
        if not self.keeps_running():
            return None
        # прячем после выхода из обработчика: он выполняется в потоке окна
        threading.Timer(0.05, self._hide).start()
        return False  # отмена закрытия

    def _hide(self) -> None:
        if self.window is None:
            return
        self.window.hide()
        if not self._hinted and self.icon is not None:
            self._hinted = True
            try:
                self.icon.notify(TRAY_HINT, "Compass")
            except Exception:
                log.debug("Подсказка трея не показана", exc_info=True)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_started(server: uvicorn.Server, thread: threading.Thread, timeout: float = START_TIMEOUT_S) -> None:
    """Ждём готовности сервера; если поток умер (порт занят, сбой БД) — не ждём вхолостую."""
    deadline = time.monotonic() + timeout
    while not server.started:
        if not thread.is_alive():
            raise RuntimeError("Движок Compass не запустился (см. сообщения выше)")
        if time.monotonic() > deadline:
            raise RuntimeError(f"Движок Compass не ответил за {timeout:.0f} с")
        time.sleep(0.05)


def _message(text: str) -> None:
    log.error(text)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, text, "Compass", 0x10)


def webview2_ready() -> bool:
    """Edge WebView2 нужен окну. На Windows 11 он обычно уже есть."""
    if sys.platform != "win32":
        return True
    import winreg

    guid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    paths = (
        rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{guid}",
        rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{guid}",
    )
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for path in paths:
            try:
                with winreg.OpenKey(hive, path) as key:
                    version, _ = winreg.QueryValueEx(key, "pv")
            except OSError:
                continue
            if version and version != "0.0.0.0":
                return True
    return False


def main() -> None:
    import webview  # импорт здесь: без pywebview остальное приложение (`python -m compass`) работает

    cfg = Config.from_env()
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(cfg.data_dir / "compass.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )
    try:
        if not static_dir().is_dir():
            raise RuntimeError("В сборке нет интерфейса. Переустановите Compass.")
        if not webview2_ready():
            raise RuntimeError(
                "Не найден Microsoft Edge WebView2. Установите его с сайта Microsoft "
                "(Evergreen Bootstrapper) и запустите Compass снова."
            )
        if show_running_instance(cfg.data_dir, cfg.host):
            log.info("Compass уже запущен: показано его окно")
            return
        port = cfg.port if "COMPASS_PORT" in os.environ else free_port()
        # одноразовый токен сессии: только окно приложения получает доступ к API
        token = secrets.token_urlsafe(32)
        services = build_services(cfg)
        shell = Shell(services.settings)
        services.shell = shell
        app = create_app(services, session_token=token)
        server = uvicorn.Server(uvicorn.Config(app, host=cfg.host, port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, name="compass-engine", daemon=True)
        thread.start()
        wait_started(server, thread)
        log.info("Compass слушает http://%s:%s", cfg.host, port)
        try:
            write_instance(cfg.data_dir, port, token)
            shell.start_tray()
            # автозапуск с Windows: стартуем значком в трее; без трея окно прятать нельзя — его нечем вернуть
            hidden = TRAY_FLAG in sys.argv and shell.tray
            window = webview.create_window(
                "Compass",
                f"http://{cfg.host}:{port}/?token={token}",
                width=1360,
                height=860,
                min_size=(960, 640),
                hidden=hidden,
            )
            shell.attach(window)
            webview.start()
        finally:
            shell.stop_tray()
            clear_instance(cfg.data_dir)
            server.should_exit = True  # lifespan остановит фоновый сканер
            thread.join(timeout=5)
    except Exception as exc:
        _message(f"{exc}\n\nПодробности: {cfg.data_dir / 'compass.log'}")
        log.error("%s", traceback.format_exc())
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
