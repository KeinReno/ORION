"use client";

import type { BackgroundEffectSettings, UserPreference } from "@orion/shared-types";
import { SegmentedControl, Switch } from "@orion/ui";

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col items-start gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void }): React.ReactElement {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-ui-button"
    />
  );
}

function ColorField({ label, value, fallbackHex, onChange }: { label: string; value: string | null; fallbackHex: string; onChange: (value: string | null) => void }): React.ReactElement {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? fallbackHex}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
        />
        {value ? (
          <button type="button" className="text-2xs text-accent-text hover:underline" onClick={() => onChange(null)}>
            По акценту
          </button>
        ) : (
          <span className="text-2xs text-subtle-foreground">По акценту</span>
        )}
      </div>
    </Field>
  );
}

export interface BackgroundEffectSettingsFormProps {
  variant: UserPreference["backgroundStyle"] & keyof BackgroundEffectSettings;
  settings: BackgroundEffectSettings;
  accentHex: string;
  onChange: (settings: BackgroundEffectSettings) => void;
}

/**
 * The per-effect tuning block shown under Settings → Внешний вид → Фон when
 * a WebGL variant is selected — one full reactbits.dev-style prop set per
 * effect (see `backgroundEffectSettingsSchema` in shared-types), not a
 * generic speed/density/color triple shared across all four.
 */
export function BackgroundEffectSettingsForm({ variant, settings, accentHex, onChange }: BackgroundEffectSettingsFormProps): React.ReactElement | null {
  const grid = "grid gap-4 rounded-lg border border-border p-3 [@container(min-width:576px)]:grid-cols-3";

  if (variant === "liquid-ether") {
    const cfg = settings["liquid-ether"];
    const set = (patch: Partial<typeof cfg>): void => onChange({ ...settings, "liquid-ether": { ...cfg, ...patch } });
    return (
      <div className={grid}>
        <Field label={`Скорость: ${cfg.speed.toFixed(1)}×`}><Slider value={cfg.speed} min={0.1} max={3} step={0.1} onChange={(speed) => set({ speed })} /></Field>
        <Field label={`Плотность: ${cfg.density.toFixed(1)}×`}><Slider value={cfg.density} min={0.2} max={2} step={0.1} onChange={(density) => set({ density })} /></Field>
        <Field label={`Сила курсора: ${Math.round(cfg.mouseForce * 100)}%`}><Slider value={cfg.mouseForce} min={0} max={1} step={0.05} onChange={(mouseForce) => set({ mouseForce })} /></Field>
        <ColorField label="Цвет" value={cfg.color} fallbackHex={accentHex} onChange={(color) => set({ color })} />
        <ColorField label="Второй цвет" value={cfg.colorSecondary} fallbackHex={accentHex} onChange={(colorSecondary) => set({ colorSecondary })} />
        <Field label="Авто-анимация">
          <div className="flex items-center gap-2 pt-1.5">
            <Switch checked={cfg.autoDemo} onChange={(autoDemo) => set({ autoDemo })} />
            <span className="text-2xs text-subtle-foreground">Течёт сама, а не только от курсора</span>
          </div>
        </Field>
      </div>
    );
  }

  if (variant === "light-pillar") {
    const cfg = settings["light-pillar"];
    const set = (patch: Partial<typeof cfg>): void => onChange({ ...settings, "light-pillar": { ...cfg, ...patch } });
    return (
      <div className={grid}>
        <Field label={`Скорость: ${cfg.speed.toFixed(1)}×`}><Slider value={cfg.speed} min={0.1} max={3} step={0.1} onChange={(speed) => set({ speed })} /></Field>
        <Field label={`Плотность: ${cfg.density.toFixed(1)}×`}><Slider value={cfg.density} min={0.2} max={2} step={0.1} onChange={(density) => set({ density })} /></Field>
        <ColorField label="Цвет" value={cfg.color} fallbackHex={accentHex} onChange={(color) => set({ color })} />
        <Field label={`Ширина столба: ${Math.round(cfg.pillarWidth * 100)}%`}><Slider value={cfg.pillarWidth} min={0.02} max={0.3} step={0.01} onChange={(pillarWidth) => set({ pillarWidth })} /></Field>
        <Field label={`Яркость лучей: ${Math.round(cfg.rayIntensity * 100)}%`}><Slider value={cfg.rayIntensity} min={0} max={1} step={0.05} onChange={(rayIntensity) => set({ rayIntensity })} /></Field>
        <Field label={`Мерцание: ${Math.round(cfg.flicker * 100)}%`}><Slider value={cfg.flicker} min={0} max={1} step={0.05} onChange={(flicker) => set({ flicker })} /></Field>
      </div>
    );
  }

  if (variant === "dark-veil") {
    const cfg = settings["dark-veil"];
    const set = (patch: Partial<typeof cfg>): void => onChange({ ...settings, "dark-veil": { ...cfg, ...patch } });
    return (
      <div className={grid}>
        <Field label={`Скорость: ${cfg.speed.toFixed(1)}×`}><Slider value={cfg.speed} min={0.1} max={3} step={0.1} onChange={(speed) => set({ speed })} /></Field>
        <Field label={`Плотность: ${cfg.density.toFixed(1)}×`}><Slider value={cfg.density} min={0.2} max={2} step={0.1} onChange={(density) => set({ density })} /></Field>
        <ColorField label="Цвет" value={cfg.color} fallbackHex={accentHex} onChange={(color) => set({ color })} />
        <Field label={`Сдвиг оттенка: ${Math.round(cfg.hueShift)}°`}><Slider value={cfg.hueShift} min={0} max={360} step={5} onChange={(hueShift) => set({ hueShift })} /></Field>
        <Field label={`Турбулентность: ${cfg.warpAmount.toFixed(1)}×`}><Slider value={cfg.warpAmount} min={0} max={2} step={0.1} onChange={(warpAmount) => set({ warpAmount })} /></Field>
        <Field label={`Скан-линии: ${Math.round(cfg.scanlineIntensity * 100)}%`}><Slider value={cfg.scanlineIntensity} min={0} max={1} step={0.05} onChange={(scanlineIntensity) => set({ scanlineIntensity })} /></Field>
      </div>
    );
  }

  const cfg = settings["shape-waves"];
  const set = (patch: Partial<typeof cfg>): void => onChange({ ...settings, "shape-waves": { ...cfg, ...patch } });
  return (
    <div className={grid}>
      <Field label={`Скорость: ${cfg.speed.toFixed(1)}×`}><Slider value={cfg.speed} min={0.1} max={3} step={0.1} onChange={(speed) => set({ speed })} /></Field>
      <Field label={`Плотность: ${cfg.density.toFixed(1)}×`}><Slider value={cfg.density} min={0.2} max={2} step={0.1} onChange={(density) => set({ density })} /></Field>
      <ColorField label="Цвет" value={cfg.color} fallbackHex={accentHex} onChange={(color) => set({ color })} />
      <Field label={`Зазор: ${Math.round(cfg.gap * 100)}%`}><Slider value={cfg.gap} min={0} max={0.4} step={0.02} onChange={(gap) => set({ gap })} /></Field>
      <Field label={`Амплитуда волны: ${Math.round(cfg.waveAmplitude * 100)}%`}><Slider value={cfg.waveAmplitude} min={0} max={1} step={0.05} onChange={(waveAmplitude) => set({ waveAmplitude })} /></Field>
      <Field label="Форма">
        <SegmentedControl<"circle" | "square">
          value={cfg.shape}
          onChange={(shape) => set({ shape })}
          size="sm"
          options={[{ value: "circle", label: "Круг" }, { value: "square", label: "Квадрат" }]}
        />
      </Field>
    </div>
  );
}
