import { DepthCard } from "../../depth-card";
import { DARK_PALETTES } from "../../theme";
import type { MobileSettings } from "@orion/mobile-core";
import type { SettingControlProps } from "./types";
export function AppearanceSettings({ settings, pending, patch }: SettingControlProps) {
  return <DepthCard><section className="settings-section">
      <fieldset id="theme" disabled={Boolean(pending.theme)}><legend>Тема на этом телефоне</legend>
        <div className="segments">{([["system", "Системная"], ["light", "Светлая"], ["dark", "Тёмная"]] as const).map(([theme, label]) =>
          <label key={theme}><input type="radio" name="theme" checked={settings.theme === theme}
            onChange={() => void patch({ theme })} /><span>{label}</span></label>)}</div>
      </fieldset>
      <label className="palette-label">Цвета тёмной темы<select id="dark-theme" value={settings.darkTheme} disabled={Boolean(pending.darkTheme)}
        onChange={(event) => void patch({ darkTheme: event.target.value as MobileSettings["darkTheme"] })}>
        {DARK_PALETTES.map((palette) => <option key={palette.id} value={palette.id}>{palette.name}</option>)}
      </select></label>
      <p className="helper">Общие темы с десктопным Orion. Arctic используется в светлом режиме. Этот выбор действует только на телефоне.</p>
      <button onClick={() => void patch({ theme: "system", darkTheme: "kaiden-precision" })} disabled={Boolean(pending.theme || pending.darkTheme)}>Восстановить оформление</button>
    </section></DepthCard>;
}
