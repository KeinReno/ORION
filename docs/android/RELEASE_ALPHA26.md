# Android alpha.26 — поиск прежнего ПК после сетевого сбоя

Статус: HISTORICAL, 26.10.2026. Базовый HEAD 36946e4 плюс изменения этого
отчёта; точная исходная ревизия указана в GitHub release.
Текущий статус — [STATUS](../STATUS.md), направление — [PLATFORM](../PLATFORM.md).

## Реализация

После network/offline результата foreground sync выполняет ограниченный поиск
прежнего узла. Совпасть должны nodeId, certificate fingerprint и userId текущей
remote scope. До и после discovery заново читается native binding. Результаты
после ухода в фон, смены учётной записи или cleanup отбрасываются; revoked/error
не запускает восстановление. Поиск не чаще раза в минуту, без overlap, максимум
8 matching hints на попытку с дедупликацией endpoint. После успешного native
reconnect тот же MobileRemoteClient повторяет обмен со своей прежней очередью.
Автоматического pairing/login/workspace selection и очистки кэша здесь нет.

Native reconnect использует прежний pinned certificate и проверяет nodeId перед
сохранением адреса. Discovery — недоверенные подсказки, не выдача доверия.
Из нескольких адресов того же узла прежний проверенный маршрут пробуется первым;
при отказе кандидат не скрывает альтернативы. Таймауты native HTTPS сохранены.

На реальном OPPO найден дефект прежней NSD-реализации: `getHost()` давал один
адрес недоступного интерфейса. Ручной pinned probe на известный LAN-адрес с тем же
новым портом работал. На API34+ теперь читается `getHostAddresses()`; сохраняются
все пригодные IPv4 без дублей, loopback/unspecified/multicast отбрасываются.
Общий лимит 32 hints сохранён; для старого Android оставлен getHost fallback.
[Android API: getHostAddresses](https://developer.android.com/reference/android/net/nsd/NsdServiceInfo#getHostAddresses()).

Файлы: foreground-sync.ts/test, use-lan.ts, remembered-host-recovery.ts/test,
native LanDiscovery.java, LanAddresses.java/test, Android versions, этот отчёт.

## Проверки

- 120 JS/TS tests /21 files: Android, mobile-core, core sync. Новые сценарии:
  strict node/fingerprint/user isolation, revalidation после discovery,
  concurrent recovery и cooldown, background cancellation, несколько маршрутов,
  продолжение durable replica после восстановления, отсутствие поиска при revoke.
- 11 JVM tests, включая новый all-IPv4 filter/dedupe test, прошли.
- Workspace typecheck, scoped lint, architecture,11 plugin-contract tests,
  module-docs/platform-map и settings/update browser smoke прошли.
- Web build, cap sync, assembleDebug, assembleRelease, lintDebug,
  testDebugUnitTest прошли после финального native/TS изменения.
- На OPPO Reno8 5G / Android15 alpha.26 установлена поверх alpha.25 без uninstall.
  Реальный Windows beta.25 временно переведён с4443 на4444 с тем же node/cert.
  Первая проверка до исправления all-address NSD не прошла: announcement находился,
  но единственный адрес не подключался. В диагностике известный LAN-адрес:4444
  прошёл native pinning; binding телефона стал4444. Это ручная диагностика,
  не успешная автоматическая приёмка первой сборки.
- Исходный lan-node.json восстановлен byte-identical; host запущен на4443,
  PostgreSQL не останавливался. Телефон со stale binding4444 после установки
  окончательной сборки автоматически нашёл4443 без ручного reconnect/pairing.
  Получено свежее подтверждение обмена. Полные native local snapshot, node card
  и user совпали с private baseline; новые пользовательские данные не создавались.
  Никаких изменений firewall/VPN/сетевых адаптеров не выполнялось.

## Пакет

0.1.25 / alpha.26 / code26, `io.kaiden.orion.android`.
APK4731822 байт, SHA-256:
`f11f283c84a21bc34f0594f56af71a98af71aa6b870bc3c9a699cdc4a2041505`.
Сертификат SHA-256:
`5154216cb718e2d66a6811ce8168fd571ecfcacd7c15fd6e39d2e0ad29023b39`.
Release-helper проверил code25→26, signer continuity, package/UI/native и hash.
Это test/debug signed APK. Unsigned release build проверен отдельно.
[Публичный релиз](https://github.com/KeinReno/ORION-Android-Releases/releases/tag/v0.1.25-android-alpha.26).

## Границы / финансы

Проверена реальная смена endpoint/порта и восстановление доверенной связи.
Переключение Wi-Fi и VPN-туннеля на телефоне не выполнялось. Если VPN или роутер
блокирует LAN/mDNS, автоматический поиск не обходит запрет; ручной адрес остаётся.
IPv6-only сети и all-address discovery до API34 требуют отдельной приёмки.
Постоянного фонового сервиса нет.

Finance offline sync всё ещё не реализован. Изучены Finance MODULE/AI_CONTEXT,
accounts/transactions и текущий hybrid protocol. Обычный transaction POST не
даёт device receipt, update не имеет CAS revision, поэтому повторять их как
денежную очередь небезопасно. Подготовлен обязательный
[Extension Proposal](../extensions/FINANCE_DEVICE_SYNC.md): отдельная capability,
Finance-owned replication SDK, receipt/CAS/change feed, RLS, private defaults,
явный mapping локальных счетов и сценарии приёмки. Нынешние деньги не меняются.
Следующий кодовый срез — versioned Finance contract + ledger/CAS на сервере,
затем Android replica/UI; не выдавать этот проект за рабочую синхронизацию денег.
