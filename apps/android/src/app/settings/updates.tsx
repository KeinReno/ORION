import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { DepthCard } from "../../depth-card";
import { ANDROID_RELEASE_LABEL, ANDROID_VERSION } from "../../updates";
import type { useUpdates } from "../../use-updates";
import type { SettingControlProps } from "./types";
export function UpdateSettings({ settings, pending, patch, updates }: SettingControlProps & { updates: ReturnType<typeof useUpdates> }) {
  const { state, phase, error, message, percent } = updates;
  const busy = phase !== "idle";
  return <DepthCard><section className="settings-section">
      <p>Установлена {state?.installedVersion ?? ANDROID_VERSION} · {ANDROID_RELEASE_LABEL}</p>
      <label className="switch-row"><span><strong>Проверять автоматически</strong><small>При открытии приложения, не чаще раза за 6 часов</small></span>
        <input type="checkbox" role="switch" id="auto-check-updates" checked={settings.autoCheckUpdates} disabled={Boolean(pending.autoCheckUpdates)}
          onChange={(e) => void patch({ autoCheckUpdates: e.target.checked })} /></label>
      <label className="switch-row"><span><strong>Загружать по Wi-Fi</strong><small>После проверки, если есть новая версия и Wi-Fi без лимита трафика</small></span>
        <input type="checkbox" role="switch" id="download-updates-wifi" checked={settings.downloadUpdatesOnWifi} disabled={Boolean(pending.downloadUpdatesOnWifi)}
          onChange={(e) => void patch({ downloadUpdatesOnWifi: e.target.checked })} /></label>
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
    </section></DepthCard>;
}
