import { ChevronRight, Link2, Settings } from "lucide-react";
import type { MobileModuleDefinition } from "../runtime/module-registry";
import type { AppRoute } from "../navigation/routes";
import { RouteLink } from "../navigation/route-link";
export function MorePage({ modules, navigate }: { modules: readonly MobileModuleDefinition[]; navigate: (route: AppRoute) => void }) {
  return <section className="more-page"><section className="settings-group"><h2>Модули на телефоне</h2>
    {modules.map(({ id, label, icon: Icon, summary }) => <RouteLink key={id} className="settings-row" route={{ kind: "module", moduleId: id }} navigate={navigate}><Icon size={21} /><span><strong>{label}</strong><small>{summary}</small></span><ChevronRight size={20} /></RouteLink>)}
    </section><section className="settings-group"><h2>Приложение</h2>
      <RouteLink className="settings-row" route={{ kind: "settings" }} navigate={navigate}><Settings size={21} /><span><strong>Настройки</strong><small>Оформление, данные и обновления</small></span><ChevronRight size={20} /></RouteLink>
      <RouteLink className="settings-row" route={{ kind: "connection" }} navigate={navigate}><Link2 size={21} /><span><strong>Подключение и синхронизация</strong><small>Работа с компьютером</small></span><ChevronRight size={20} /></RouteLink>
    </section><p className="helper">Здесь появляются модули, поддерживаемые установленной версией Android-клиента. Отсутствие экрана не отключает модуль на компьютере.</p></section>;
}
