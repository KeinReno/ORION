import { DARK_PALETTES } from "./theme";
import type { MobileSettings } from "@orion/mobile-core";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { ANDROID_RELEASE_LABEL, ANDROID_VERSION } from "./updates";
import type { useUpdates } from "./use-updates";

export function SettingsPage({ settings, saving, save, updates, backup, backupBusy }: {
  settings: MobileSettings;
  saving: boolean;
  save: (settings: MobileSettings) => Promise<unknown>;
  updates: ReturnType<typeof useUpdates>;
  backup: () => void; backupBusy: boolean;
}) {
  const { state, phase, error, message, percent } = updates;
  const busy = phase !== "idle";
  return <section className="settings-page">
    <section className="settings-section">
      <h2>Внешний вид</h2>
      <fieldset disabled={saving}><legend>Тема на этом телефоне</legend>
        <div className="segments">{([["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]] as const).map(([theme, label]) =>
          <label key={theme}><input type="radio" name="theme" checked={settings.theme === theme}
            onChange={() => void save({ ...settings, theme })} /><span>{label}</span></label>)}</div>
      </fieldset>
      <label className="palette-label">Цвета тёмной темы<select value={settings.darkTheme} disabled={saving}
        onChange={(event) => void save({ ...settings, darkTheme: event.target.value as MobileSettings["darkTheme"] })}>
        {DARK_PALETTES.map((palette) => <option key={palette.id} value={palette.id}>{palette.name}</option>)}
      </select></label>
      <p className="helper">Общие темы с десктопным Orion. Светлый режим использует Arctic. Выбор на телефоне пока независим от ПК.</p>
    </section>
    <section className="settings-section" aria-labelledby="updates-heading">
      <h2 id="updates-heading">Обновления</h2>
      <p>Установлена {state?.installedVersion ?? ANDROID_VERSION} · {ANDROID_RELEASE_LABEL}</p>
      <label className="switch-row"><span><strong>Проверять автоматически</strong><small>При открытии приложения, не чаще раза за 6 часов</small></span>
        <input type="checkbox" role="switch" checked={settings.autoCheckUpdates} disabled={saving}
          onChange={(e) => void save({ ...settings, autoCheckUpdates: e.target.checked })} /></label>
      <label className="switch-row"><span><strong>Загружать по Wi-Fi</strong><small>После проверки, если есть новая версия и Wi-Fi без лимита трафика</small></span>
        <input type="checkbox" role="switch" checked={settings.downloadUpdatesOnWifi} disabled={saving}
          onChange={(e) => void save({ ...settings, downloadUpdatesOnWifi: e.target.checked })} /></label>
      <div className="update-state" aria-live="polite">
        {phase === "check" ? <p>Проверяем Android-релиз…</p>
          : state?.available && state.manifest ? <><h3>Доступна версия {state.manifest.versionName}</h3>
            <p>{(state.manifest.apk.size / 1024 / 1024).toFixed(1)} МБ · {state.manifest.tag}</p>
            <details><summary>Что изменилось</summary><p className="release-notes">{state.manifest.notes}</p></details>
          </> : <p>{state?.lastChecked
            ? error ? "По последней успешной проверке новых версий не было." : "Установлена актуальная версия."
            : "Обновления ещё не проверялись."}</p>}
        {phase === "download" && <div><label htmlFor="download-progress">Загрузка APK: {percent}%</label>
          <progress id="download-progress" max={100} value={percent} /></div>}
        {state?.lastChecked ? <p className="helper">Последняя проверка: {new Date(state.lastChecked).toLocaleString("ru-RU")}</p> : null}
        {error && <p className="error" role="alert">{error}</p>}
        {message && <p className="notice">{message}</p>}
      </div>
      <div className="update-actions">
        {state?.available && (state.ready
          ? <button className="primary" disabled={busy} onClick={() => void updates.install()}><ShieldCheck size={20} />Установить обновление</button>
          : <button className="primary" disabled={busy} onClick={() => void updates.download(false)}><Download size={20} />Скачать обновление</button>)}
        <button disabled={busy} onClick={() => void updates.check(false)}><RefreshCw size={18} />Проверить обновления</button>
      </div>
      <p className="helper">Установку подтверждает Android. Обновление устанавливается поверх приложения и сохраняет записи. Не удаляйте Orion перед установкой.</p>
    </section>
    <section className="settings-section"><h2>На этом телефоне</h2>
      <p>Задачи, заметки, финансовые операции и настройки хранятся локально. Проверка обновлений не передаёт их в GitHub.</p>
      <button disabled={backupBusy} onClick={backup}><Download size={18} />Сохранить резервную копию</button>
    </section>
  </section>;
}
