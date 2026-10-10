"""Автозапуск вместе с Windows: запись в раздел Run текущего пользователя (права администратора не нужны).

Источник правды — сам реестр, а не база настроек: запись может убрать и пользователь в диспетчере задач.
Compass стартует свёрнутым в трей (`--tray`) и сразу начинает искать сигналы. Работает только в установленной
сборке: у запуска из исходников нет постоянного пути к программе.
"""

from __future__ import annotations

import sys
from typing import Any

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "Compass"
TRAY_FLAG = "--tray"


def _winreg() -> Any | None:
    if sys.platform != "win32":
        return None
    import winreg

    return winreg


def supported() -> bool:
    return sys.platform == "win32" and bool(getattr(sys, "frozen", False))


def command(executable: str | None = None) -> str:
    return f'"{executable or sys.executable}" {TRAY_FLAG}'


def is_enabled(reg: Any | None = None) -> bool:
    reg = reg or _winreg()
    if reg is None:
        return False
    try:
        with reg.OpenKey(reg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = reg.QueryValueEx(key, VALUE_NAME)
    except OSError:
        return False
    return bool(value)


def set_enabled(enabled: bool, reg: Any | None = None, executable: str | None = None) -> bool:
    """Включает или выключает автозапуск; возвращает новое состояние."""
    reg = reg or _winreg()
    if reg is None:
        raise ValueError("Автозапуск доступен только в Windows")
    with reg.CreateKey(reg.HKEY_CURRENT_USER, RUN_KEY) as key:
        if enabled:
            reg.SetValueEx(key, VALUE_NAME, 0, reg.REG_SZ, command(executable))
        else:
            try:
                reg.DeleteValue(key, VALUE_NAME)
            except OSError:
                pass  # записи и так нет
    return is_enabled(reg)


def status() -> dict:
    ok = supported()
    return {
        "supported": ok,
        "enabled": is_enabled() if ok else False,
        "note": (
            "Compass запускается вместе с Windows свёрнутым в трей и сразу следит за сигналами."
            if ok
            else "Автозапуск работает только в установленной программе (CompassSetup.exe)."
        ),
    }
