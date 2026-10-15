# Второй срез — свидетельства

- `runtime-before.json` / `runtime-after.json`: 7 реальных панелей на 1280/390 px,
  доступные действия, overflow и timing до network idle. Это dev timing, не production TTI.
- `pixel-comparison.json`: 16 пар панелей/shell, 10 совпали целиком.
- `tasks-before-390.png` / `tasks-after-390.png`: одинаковое отображение текущего UI.
- `action-baseline-comparison.json`: 9 устаревших эталонов. Actual inventories
  исходной ревизии 6da3c12 совпали побайтово с actual inventories нового UI.
- `scoped-dialog-precision.png`: настоящие компоненты через portal в браузере.
- `scoped-dialog-cancelled.png`: тот же диалог и тот же несохранённый текст после отмены темы.
- `scoped-dialog-mobile.png`: геометрия на 390 px после повторного открытия.
- `scoped-dialog-browser.json`: проверенные вычисленные цвета и условия сценария.

Все данные синтетические. Для иллюстрации portal использован временный test route,
удалённый до коммита. Постоянные регрессии — `apps/web/lib/theme-portals.test.ts`
и `e2e/theme-foundation.spec.ts`; общий action smoke — `e2e/panels.spec.ts`.
Два профиля проверены на всех 21 панели, финальный browser run: 43 passed.
