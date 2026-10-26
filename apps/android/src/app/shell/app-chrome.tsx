import { Settings, Link2, Grid2X2, type LucideIcon } from "lucide-react";
import { DepthCard } from "../../depth-card";

export interface NavigationItem { id: string; label: string; icon: LucideIcon }
export function AppHeader({ scope, updated, settings, connection, indicator }: { scope: string; indicator: { tone: string; label: string }; updated: boolean; settings: () => void; connection: () => void }) {
  return <DepthCard elevation="base"><header className="brand"><img src="/kaiden-logo.png" alt="" width="34" height="34" />
    <span>KAIDEN <b>Orion</b></span>
    <button className="local-label" aria-label="Связь" aria-describedby="connection-indicator-label" title={indicator.label} data-connection={indicator.tone} onClick={connection}><span className="connection-dot" aria-hidden="true" /><Link2 size={16} /><span>{scope}<small id="connection-indicator-label">{indicator.label}</small></span></button>
    <button className="icon-button settings-shortcut" aria-label="Настройки" onClick={settings}><Settings size={21} />{updated && <span className="update-dot" aria-label="Доступно обновление" />}</button>
  </header></DepthCard>;
}
export function BottomNavigation({ items, selected, navigate }: { items: readonly NavigationItem[]; selected: string; navigate: (id: string) => void }) {
  return <nav className="navigation" aria-label="Разделы">{[...items.slice(0, 4), { id: "more", label: "Ещё", icon: Grid2X2 }].map(({ id, label, icon: Icon }) =>
    <button key={id} aria-label={label} title={label} aria-current={selected === id ? "page" : undefined} onClick={() => navigate(id)}><span className="nav-icon"><Icon size={23} /></span><span>{label}</span></button>)}</nav>;
}
