import { useEffect } from "react";
import { ArrowLeft, ChevronRight, Link2, Search, Download, Mic } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import type { MobileSnapshot, MobileSettings } from "@orion/mobile-core";
import { SETTINGS_PAGES, SETTINGS_FIELDS, searchSettings } from "./catalog";
import { AppearanceSettings } from "./appearance";
import { MotionSettings } from "./motion";
import { UpdateSettings } from "./updates";
import { RestoreSettings, type RestoreSettingsProps } from "./restore";
import { RouteLink } from "../navigation/route-link";
import type { AppRoute } from "../navigation/routes";
import type { useSettingWrites } from "./use-setting-writes";
import type { useUpdates } from "../../use-updates";
import { ANDROID_VERSION, ANDROID_VERSION_CODE, ANDROID_RELEASE_LABEL } from "../../updates";

const storageKeys: Partial<Record<string, keyof MobileSettings>> = { theme: "theme", "dark-theme": "darkTheme", "depth-effects": "depthEffects", "depth-strength": "depthStrength", "swipe-gestures": "swipeGestures", "auto-check-updates": "autoCheckUpdates", "download-updates-wifi": "downloadUpdatesOnWifi" };
export function SettingsCenter({ route, navigate, replace, data, writes, updates, depth, backup, backupBusy, connection, note, restore }: {
  route: Extract<AppRoute, { kind: "settings" }>; navigate: (route: AppRoute) => void; replace: (route: AppRoute) => void;
  data: MobileSnapshot; writes: ReturnType<typeof useSettingWrites>; updates: ReturnType<typeof useUpdates>;
  depth: { status: string }; backup: () => void; backupBusy: boolean;
  connection: { pending: number; conflicts: number; paired: boolean }; note: () => void;
  restore: Omit<RestoreSettingsProps, "current" | "disabled">;
}) {
  const settings = { ...data.settings, ...writes.drafts };
  const controls = { settings, pending: writes.pending, patch: writes.patch };
  const query = route.query ?? "";
  const page = SETTINGS_PAGES.find((item) => item.id === route.page);
  useEffect(() => {
    if (!route.field) { window.scrollTo(0, 0); return; }
    const timer = setTimeout(() => {
      const field = document.getElementById(route.field!);
      field?.scrollIntoView({ block: "center", behavior: "instant" });
      const control = field?.matches("input,select,button,textarea") ? field : field?.querySelector<HTMLElement>("input,select,button,textarea");
      control?.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [route.page, route.field]);
  if (!page) return <section className="settings-hub">
    <p className="settings-scope">Изменения действуют только на этом телефоне.</p>
    <label className="search"><Search size={20} /><span className="sr-only">Найти настройку</span><input type="search" placeholder="Найти настройку" value={query} onChange={(event) => replace({ kind: "settings", query: event.target.value.slice(0, 100) })} /></label>
    {query.trim() ? <section aria-label="Результаты поиска настроек">
      <p className="helper">Параметры приложения, без поиска по содержимому ваших записей.</p>
      {searchSettings(query).map((field) => <RouteLink key={field.id} className="settings-row" route={{ kind: "settings", page: field.page, field: field.id }} navigate={navigate}>
        <span><strong>{field.label}</strong><small>{SETTINGS_PAGES.find((item) => item.id === field.page)!.label} · На этом телефоне</small></span><ChevronRight size={20} /></RouteLink>)}
      {!searchSettings(query).length && <p className="empty-settings">Ничего не найдено. Попробуйте «тема», «наклон» или «копия».</p>}
    </section> : <>
      {(["device", "help"] as const).map((group) => <section key={group} className="settings-group"><h2>{group === "device" ? "Приложение" : "Справка"}</h2>
        {SETTINGS_PAGES.filter((item) => item.group === group).map(({ id, label, summary, icon: Icon }) => <RouteLink key={id} className="settings-row" route={{ kind: "settings", page: id }} navigate={navigate}>
          <Icon size={21} /><span><strong>{label}</strong><small>{id === "updates" && updates.state?.available ? "Доступно обновление" : summary}</small></span><ChevronRight size={20} /></RouteLink>)}
        {group === "device" && <RouteLink className="settings-row" route={{ kind: "connection" }} navigate={navigate}><Link2 size={21} /><span><strong>Подключение и синхронизация</strong><small>{connection.paired ? `Сопряжение сохранено · в очереди ${connection.pending}` : "Подключить компьютер"}</small></span><ChevronRight size={20} /></RouteLink>}
      </section>)}
    </>}
  </section>;
  return <section className="settings-page">
    <button className="settings-back" onClick={() => { if (history.state?.backHash?.startsWith("#/settings")) history.back(); else replace({ kind: "settings" }); }}><ArrowLeft size={18} />Назад к настройкам</button>
    <p className="settings-scope">{page.group === "help" ? "Сведения об этом телефоне" : "Только на этом телефоне"}</p>
    {page.id === "appearance" && <AppearanceSettings {...controls} />}
    {page.id === "motion" && <MotionSettings {...controls} depth={depth} />}
    {page.id === "updates" && <UpdateSettings {...controls} updates={updates} />}
    {page.id === "data" && <><section className="settings-section" id="backup"><h2>Записи на телефоне</h2>
      <dl className="settings-facts"><div><dt>Задачи</dt><dd>{data.tasks.length}</dd></div><div><dt>Заметки</dt><dd>{data.notes.length}</dd></div><div><dt>Списки</dt><dd>{data.lists.length}</dd></div><div><dt>Финансовые операции</dt><dd>{data.finance?.transactions.length ?? 0}</dd></div></dl>
      <p>Экспорт сохраняет локальные записи, черновики и содержимое открытой копии пространства ПК.</p>
      <p className="helper">Файл не является полным образом приложения: настройки, пароли и ключи подключения не входят. Восстановление возвращает записи на телефон, но не настройки и не копию пространства ПК.</p>
      <button disabled={backupBusy} onClick={backup}><Download size={18} />Сохранить резервную копию</button>
    </section>
      <RestoreSettings {...restore} disabled={backupBusy} current={{
        tasks: data.tasks.length, notes: data.notes.length, lists: data.lists.length,
        transactions: data.finance?.transactions.length ?? 0,
      }} /></>}
    {page.id === "voice" && <section className="settings-section" id="dictation"><h2>Системная диктовка</h2>
      <p>В редакторе задачи или заметки нажмите «Надиктовать». Распознанный текст можно добавить в название или основной текст.</p>
      <p className="helper">Распознаёт системное приложение Android. Язык и работа без интернета зависят от установленного провайдера. Orion пока не сохраняет аудиофайл.</p>
      <button onClick={note}><Mic size={18} />Открыть редактор заметки</button>
      {!Capacitor.isNativePlatform() && <p className="helper">Системная диктовка доступна в установленном Android-приложении.</p>}
    </section>}
    {page.id === "diagnostics" && <section className="settings-section" id="health"><h2>Состояние приложения</h2><dl className="settings-facts">
      <div><dt>Локальное хранилище</dt><dd>Открыто</dd></div><div><dt>Среда</dt><dd>{Capacitor.isNativePlatform() ? "Android" : "Предварительный просмотр"}</dd></div>
      <div><dt>Компьютер</dt><dd>{connection.paired ? "Сопряжение сохранено" : "Не подключён"}</dd></div><div><dt>Очередь копии ПК</dt><dd>{connection.pending}</dd></div><div><dt>Конфликты</dt><dd>{connection.conflicts}</dd></div><div><dt>Наклон</dt><dd>{depth.status}</dd></div>
      </dl><p className="helper">Состояние не подтверждает успешный обмен с ПК. Записи и финансовые данные автоматически не отправляются в диагностику.</p>
      <RouteLink className="settings-row" route={{ kind: "connection" }} navigate={navigate}>Открыть подключение<ChevronRight size={20} /></RouteLink>
    </section>}
    {page.id === "about" && <section className="settings-section" id="version"><h2>KAIDEN Orion</h2><p>{ANDROID_VERSION} · {ANDROID_RELEASE_LABEL} · сборка {ANDROID_VERSION_CODE}</p>
      <p>Задачи, заметки и финансы на телефоне. Задачи и заметки поддерживают ручной обмен с подключённым компьютером. Финансы пока хранятся только здесь.</p>
      <p className="helper">Целевое устройство проверки — OPPO Reno8 5G. Android-клиент развивается отдельно от десктопных окон.</p>
    </section>}
    {SETTINGS_FIELDS.filter((field) => field.page === page.id).map((field) => {
      const key = storageKeys[field.id]; if (!key) return null;
      return <div key={key} className="setting-write-state" role={writes.errors[key] ? "alert" : "status"}>
        {writes.saved[key] && !writes.pending[key] && !writes.errors[key] && <p>Сохранено: {field.label}</p>}
        {writes.pending[key] && <p>Сохраняем: {field.label}…</p>}
        {writes.errors[key] && <><p>{field.label}: {writes.errors[key]}</p><button onClick={() => void writes.patch({ [key]: settings[key] })}>Повторить сохранение</button></>}
      </div>;
    })}
  </section>;
}
