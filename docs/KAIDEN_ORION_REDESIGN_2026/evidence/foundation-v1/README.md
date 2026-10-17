# Свидетельства первого token-среза

Все данные синтетические. Источник: реальный web-клиент и отдельная локальная БД.

- [Tasks до, 390 px](tasks-before-390.png)
- [Tasks после, 390 px](tasks-after-390.png)
- [Фактические компоненты в legacy и Precision, 1280 px](precision-preview-1280.png)
- [Те же компоненты, 390 px](precision-preview-390.png)
- [Попиксельное сравнение 16 пар](pixel-comparison.json)
- [Вычисленные браузером цвета двух областей](precision-preview.json)
- [Runtime observations до](runtime-before.json) и [после](runtime-after.json)

10 пар Tasks/Projects/Calendar/Settings/Opportunities совпали целиком.
В Notes/Dashboard менялись относительное время и динамический текст.
Первый широкий shell capture ещё не содержал готовый Dockview content, поэтому
его большой diff **не используется** как доказательство визуального изменения.
Previews иллюстрируют два мигрированных компонента, не полный новый Shell.

Повторяемый браузерный тест совместимости предпочтений — `e2e/theme-foundation.spec.ts`.
Обычный запуск: `pnpm test:e2e:local theme-foundation.spec.ts` после настройки тестовой БД.
Запуск существующего `test:e2e:local` пересоздаёт отдельную `orion_e2e`, согласно его документации.
Для данной проверки использовалась отдельная копия приложения и кластер на 5547,
а уже запущенная рабочая БД не затрагивалась.
