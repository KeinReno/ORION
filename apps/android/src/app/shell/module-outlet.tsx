import { Component, type ReactNode } from "react";
import type { MobileModuleDefinition } from "../runtime/module-registry";
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <section className="empty"><h2>Не удалось открыть раздел</h2><p>Записи не удалены. Другие разделы остаются доступны.</p><button onClick={() => this.setState({ failed: false })}>Повторить открытие раздела</button></section> : this.props.children;
  }
}
export function ModuleOutlet({ definition, scope }: { definition: MobileModuleDefinition | undefined; scope: string }) {
  if (!definition) return <section className="empty"><h2>Раздел недоступен</h2><p>Этот экран не входит в установленную версию приложения. Другие разделы доступны в нижнем меню.</p></section>;
  return <ScreenBoundary key={scope + ":" + definition.id}><ModuleContent definition={definition} /></ScreenBoundary>;
}
function ModuleContent({ definition }: { definition: MobileModuleDefinition }) { return <>{definition.render()}</>; }
