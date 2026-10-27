import { useEffect, useState } from "react";
import { DepthCard } from "../../depth-card";
import type { SettingControlProps } from "./types";
export function MotionSettings({ settings, pending, patch, depth }: SettingControlProps & { depth: { status: string } }) {
  const [strength, setStrength] = useState(settings.depthStrength);
  useEffect(() => setStrength(settings.depthStrength), [settings.depthStrength]);
  const commitStrength = () => { if (strength !== settings.depthStrength) void patch({ depthStrength: strength }); };
  return <DepthCard><section className="settings-section">
      <label className="switch-row"><span><strong>Глубина при наклоне</strong><small>Послойный параллакс: текст, карточки, подложка и фон. При вводе и касании эффект приостанавливается.</small></span>
        <input type="checkbox" role="switch" id="depth-effects" checked={settings.depthEffects} disabled={Boolean(pending.depthEffects)}
          onChange={(event) => void patch({ depthEffects: event.target.checked })} /></label>
      {settings.depthEffects && <div className="depth-controls">
        <label htmlFor="depth-strength">Сила наклона <output htmlFor="depth-strength">{strength}%</output></label>
        <input id="depth-strength" type="range" min="0" max="100" step="5" value={strength} disabled={Boolean(pending.depthStrength)}
          onChange={(event) => setStrength(Number(event.target.value))} onPointerUp={commitStrength} onKeyUp={commitStrength} onBlur={commitStrength} />
        <p className="helper">0% — без движения · 100% — максимальная глубина в пределах 4 пикселей. Отпустите ползунок, чтобы сохранить.</p>
        <div className="depth-preview" aria-hidden="true"><span className="depth-preview-back">ORION</span><span className="depth-preview-front">Объём в движении</span></div>
        <p className="depth-status" role="status">{depth.status}</p>
        <p className="helper">Держите телефон удобно, затем плавно наклоняйте влево и вправо. При касании все слои замирают до завершения жеста. При системном отключении анимаций эффект не работает.</p>
      </div>}
      <section id="quick-actions"><h2>Быстрые действия</h2><p>Удерживайте пустое место или кнопку «+», затем выберите действие. Обычное нажатие на «+» открывает то же меню.</p>
      <p className="helper">Для порядка задач используйте захват или кнопки «Выше» и «Ниже». Жесты не заменяют обычные кнопки.</p></section>
    </section></DepthCard>;
}

