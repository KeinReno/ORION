import { useEffect, useState } from "react";
import { Check, Eye, Orbit, Sparkles } from "lucide-react";
import type { Task } from "@orion/shared-types";

export type CosmosMode = "off" | "quiet" | "expressive";
const STORAGE_KEY = "orion.cosmos.mode.v1";
const CHANGE_EVENT = "orion-cosmos-mode";
function readMode(): CosmosMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "off" || value === "quiet" || value === "expressive" ? value : "quiet";
  } catch { return "quiet"; }
}
function chooseMode(mode: CosmosMode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Optional visual preference. */ }
  document.documentElement.dataset.cosmosMode = mode;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function useCosmosMode() {
  const [mode, setMode] = useState<CosmosMode>(readMode);
  useEffect(() => {
    const refresh = () => setMode(readMode());
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => window.removeEventListener(CHANGE_EVENT, refresh);
  }, []);
  return mode;
}

interface BatteryLike {
  level: number; charging: boolean;
  addEventListener: (name: "levelchange" | "chargingchange", callback: () => void) => void;
  removeEventListener: (name: "levelchange" | "chargingchange", callback: () => void) => void;
}

export function LivingCosmos() {
  const mode = useCosmosMode();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.cosmosMode = mode;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let alive = true;
    let lowBattery = false;
    let cleanBattery = () => {};
    const update = () => {
      if (!alive) return;
      const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
      root.dataset.cosmosPaused = document.hidden || reduced.matches || root.dataset.motion === "reduced" || lowBattery || saveData ? "true" : "false";
    };
    const observe = new MutationObserver(update);
    observe.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    document.addEventListener("visibilitychange", update);
    reduced.addEventListener("change", update);
    const nativeBattery = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    void nativeBattery.getBattery?.().then((battery) => {
      if (!alive) return;
      const changed = () => { lowBattery = battery.level < 0.15 && !battery.charging; update(); };
      battery.addEventListener("levelchange", changed);
      battery.addEventListener("chargingchange", changed);
      cleanBattery = () => {
        battery.removeEventListener("levelchange", changed);
        battery.removeEventListener("chargingchange", changed);
      };
      changed();
    }).catch(() => { /* Browser battery API is optional. */ });
    update();
    return () => {
      alive = false; observe.disconnect(); cleanBattery();
      document.removeEventListener("visibilitychange", update);
      reduced.removeEventListener("change", update);
      delete root.dataset.cosmosPaused;
    };
  }, [mode]);
  if (mode === "off") return null;
  return <div aria-hidden="true" className={"living-cosmos living-cosmos--" + mode}>
    <div className="living-cosmos__halo living-cosmos__halo--one" />
    <div className="living-cosmos__halo living-cosmos__halo--two" />
    <div className="living-cosmos__planet" />
    <div className="living-cosmos__waves" />
    <div className="living-cosmos__spark living-cosmos__spark--one" />
    <div className="living-cosmos__spark living-cosmos__spark--two" />
  </div>;
}

const COSMOS_OPTIONS: readonly { id: CosmosMode; name: string; detail: string }[] = [
  { id: "off", name: "Выключено", detail: "Чистый фон без декоративных слоёв" },
  { id: "quiet", name: "Тихое движение", detail: "Мягкие орбиты, спокойный свет" },
  { id: "expressive", name: "Выразительное", detail: "Заметнее глубина, но неподвижные элементы управления" },
];

export function CosmosControls() {
  const mode = useCosmosMode();
  return <section id="cosmos-mode" className="cosmos-settings" aria-labelledby="cosmos-settings-title">
    <h2 id="cosmos-settings-title"><Orbit size={18} aria-hidden="true" /> Живой фон</h2>
    <p className="helper">Living Cosmos: спокойные орбиты позади интерфейса и матовые графитовые поверхности в тёмной теме. Текст, кнопки и зоны касаний не движутся.</p>
    <div className="cosmos-settings__options" role="group" aria-label="Интенсивность живого фона">
      {COSMOS_OPTIONS.map((option) => <label key={option.id} className="cosmos-settings__option">
        <input type="radio" name="cosmosMode" value={option.id} checked={mode === option.id} onChange={() => chooseMode(option.id)} />
        <span><strong>{option.name}</strong><small>{option.detail}</small></span>
        {mode === option.id && <Check size={18} aria-hidden="true" />}
      </label>)}
    </div>
    <p className="helper cosmos-settings__note"><Eye size={16} aria-hidden="true" /> Анимация останавливается при системном сокращении движения, в фоне, при экономии трафика или низком заряде, если Android предоставляет состояние батареи.</p>
  </section>;
}

export function LivingFocusCard({ task, onOpen, onDone }: { task: Task; onOpen: () => void; onDone: () => void }) {
  const priority = task.priority === "high" ? "Высокий" : task.priority === "low" ? "Низкий" : "Обычный";
  const due = task.dueAt ? new Date(task.dueAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "Без срока";
  return <section className="living-focus-card" aria-label="Задача в фокусе">
    <div className="living-focus-card__eyebrow"><span><Sparkles size={15} aria-hidden="true" /> В ФОКУСЕ</span><span>ORION</span></div>
    <h2>{task.title}</h2>
    <div className="living-focus-card__meta"><span>{priority}</span><span>{due}</span></div>
    <div className="living-focus-card__actions">
      <button className="primary" onClick={onDone}><Check size={17} aria-hidden="true" /> Завершить</button>
      <button className="living-focus-card__secondary" onClick={onOpen}>Открыть задачу</button>
    </div>
  </section>;
}
