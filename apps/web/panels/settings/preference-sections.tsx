"use client";

import type { UserPreference } from "@orion/shared-types";
import { Input, RubberSegment, SegmentedControl, Select, Slider, Switch } from "@orion/ui";
import { useReducedMotion } from "framer-motion";
import { ACCENT_HEX, ACCENT_OPTIONS } from "../../lib/accent-options";
import { BackgroundEffectSettingsForm } from "./background-effect-form";
import { SettingGroup, SettingRow } from "./setting-row";

type FormProps = { form: UserPreference; setForm: (next: UserPreference) => void };

const WEBGL_BACKGROUND_STYLES = new Set<UserPreference["backgroundStyle"]>(["liquid-ether", "light-pillar", "dark-veil", "shape-waves"]);

/** «Уведомления», grouped by what each switch silences. Applied at once by the settings panel. */
export function NotificationSettings({ form, setForm }: FormProps): React.ReactElement {
  return (
    <div className="space-y-5">
      <SettingGroup title="Каналы">
        <SettingRow
          anchor="desktop-notifications"
          label="Уведомления на рабочем столе"
          description="Нативные всплывающие сообщения программы ORION, пока она открыта."
        >
          <Switch label="Уведомления на рабочем столе" checked={form.desktopNotifications} onChange={(desktopNotifications) => setForm({ ...form, desktopNotifications })} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Напоминания" description="Гасят серверные напоминания (Telegram и ленту уведомлений) и тосты в десктопе.">
        <SettingRow anchor="task-reminders" label="О задачах" description="Срок задачи наступил или прошёл.">
          <Switch label="Напоминания о задачах" checked={form.taskReminders} onChange={(taskReminders) => setForm({ ...form, taskReminders })} />
        </SettingRow>
        <SettingRow anchor="event-reminders" label="О событиях" description="За заданное у события время до начала.">
          <Switch label="Напоминания о событиях" checked={form.eventReminders} onChange={(eventReminders) => setForm({ ...form, eventReminders })} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Предупреждения">
        <SettingRow anchor="finance-alerts" label="Финансы" description="Расходы превысили бюджет категории.">
          <Switch label="Предупреждения о финансах" checked={form.financeAlerts} onChange={(financeAlerts) => setForm({ ...form, financeAlerts })} />
        </SettingRow>
        <SettingRow anchor="inventory-alerts" label="Низкий остаток на складе" description="Остаток опустился до порога, заданного у позиции склада.">
          <Switch label="Низкий остаток на складе" checked={form.inventoryAlerts} onChange={(inventoryAlerts) => setForm({ ...form, inventoryAlerts })} />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Тихие часы">
        <SettingRow
          anchor="quiet-hours"
          label="Не беспокоить"
          description="Действует на всё, кроме ручной проверки «Напомнить сейчас». Время — по часовому поясу из вкладки «Дата и время»."
        >
          <div className="flex items-center gap-2">
            <Input
              type="time"
              aria-label="Тихие часы — начало"
              className="w-28"
              value={form.quietHoursStart ?? ""}
              onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value || null })}
            />
            <span className="text-label text-subtle-foreground">—</span>
            <Input
              type="time"
              aria-label="Тихие часы — конец"
              className="w-28"
              value={form.quietHoursEnd ?? ""}
              onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value || null })}
            />
          </div>
        </SettingRow>
      </SettingGroup>
    </div>
  );
}

/**
 * «Внешний вид», in groups: the shell, the layout, background and surfaces (the previous interface
 * only — Precision draws its own calm chrome), motion, and the small display options.
 */
export function AppearanceSettings({ form, setForm }: FormProps): React.ReactElement {
  const precision = form.theme === "kaiden-precision";
  const systemReducesMotion = useReducedMotion();
  return (
    <div className="space-y-5">
      <SettingGroup title="Оболочка">
        <SettingRow
          anchor="shell"
          label="Оформление Orion"
          description={
            precision
              ? "Новая навигация и спокойная палитра. Палитры — на вкладке «Темы»."
              : "Прежний интерфейс: свой акцент, фон и стекло. При переходе на Precision и обратно они сохраняются."
          }
        >
          <Select
            aria-label="Оформление Orion"
            value={form.theme}
            onChange={(event) => setForm({ ...form, theme: event.target.value as UserPreference["theme"] })}
          >
            <option value={precision ? "dark" : form.theme}>Прежний интерфейс</option>
            <option value="kaiden-precision">KAIDEN Precision</option>
          </Select>
        </SettingRow>
        {!precision ? (
          <SettingRow anchor="accent" label="Акцент" description="Цвет выделения, ссылок и активных элементов." stack>
            <SegmentedControl<UserPreference["accent"]> aria-label="Акцент" value={form.accent} onChange={(accent) => setForm({ ...form, accent })} options={ACCENT_OPTIONS} />
          </SettingRow>
        ) : null}
      </SettingGroup>

      <SettingGroup title="Макет">
        <SettingRow anchor="density" label="Плотность" description="Размер текста и отступов во всём приложении.">
          <SegmentedControl<UserPreference["density"]>
            aria-label="Плотность"
            value={form.density}
            onChange={(density) => setForm({ ...form, density })}
            options={[
              { value: "compact", label: "Компактная" },
              { value: "comfortable", label: "Свободная" }
            ]}
          />
        </SettingRow>
        <SettingRow anchor="menu-position" label="Положение меню" description="На телефоне меню всегда выезжает слева.">
          <SegmentedControl<UserPreference["sidebarPosition"]>
            aria-label="Положение меню"
            value={form.sidebarPosition}
            onChange={(sidebarPosition) => setForm({ ...form, sidebarPosition })}
            options={[
              { value: "left", label: "Слева" },
              { value: "right", label: "Справа" },
              { value: "top", label: "Сверху" },
              { value: "bottom", label: "Снизу" }
            ]}
          />
        </SettingRow>
        <SettingRow
          anchor="tabs-mode"
          label="Вкладки сверху"
          description="«Копить» — каждый открытый раздел остаётся вкладкой. «Заменять» — раздел открывается на месте текущей; закрепить другую рядом можно перетаскиванием или через «⋯»."
        >
          <SegmentedControl<UserPreference["openTabsMode"]>
            aria-label="Вкладки сверху"
            value={form.openTabsMode}
            onChange={(openTabsMode) => setForm({ ...form, openTabsMode })}
            options={[
              { value: "accumulate", label: "Копить" },
              { value: "replace", label: "Заменять" }
            ]}
          />
        </SettingRow>
      </SettingGroup>

      {!precision ? (
        <SettingGroup title="Фон и поверхности" description="Только в прежнем интерфейсе.">
          <SettingRow anchor="background" label="Фон" stack>
            <SegmentedControl<UserPreference["backgroundStyle"]>
              aria-label="Фон"
              value={form.backgroundStyle}
              onChange={(backgroundStyle) => setForm({ ...form, backgroundStyle })}
              options={[
                { value: "none", label: "Обычный" },
                { value: "aurora", label: "Аврора" },
                { value: "grid", label: "Сетка" },
                { value: "liquid-ether", label: "Жидкий эфир" },
                { value: "light-pillar", label: "Столб света" },
                { value: "dark-veil", label: "Тёмная вуаль" },
                { value: "shape-waves", label: "Волны" }
              ]}
            />
          </SettingRow>
          {form.backgroundStyle !== "none" ? (
            <SettingRow label="Сила фона">
              <SegmentedControl<UserPreference["backgroundIntensity"]>
                aria-label="Сила фона"
                value={form.backgroundIntensity}
                onChange={(backgroundIntensity) => setForm({ ...form, backgroundIntensity })}
                options={[
                  { value: "low", label: "Слабая" },
                  { value: "medium", label: "Средняя" },
                  { value: "high", label: "Сильная" }
                ]}
              />
            </SettingRow>
          ) : null}
          {WEBGL_BACKGROUND_STYLES.has(form.backgroundStyle) ? (
            <div className="px-4 py-3">
              <BackgroundEffectSettingsForm
                variant={form.backgroundStyle as UserPreference["backgroundStyle"] & keyof UserPreference["backgroundEffectSettings"]}
                settings={form.backgroundEffectSettings}
                accentHex={ACCENT_HEX[form.accent]}
                onChange={(backgroundEffectSettings) => setForm({ ...form, backgroundEffectSettings })}
              />
            </div>
          ) : null}
          <SettingRow
            anchor="surfaces"
            label="Поверхности"
            description={
              form.backgroundStyle !== "none" && form.surfaceStyle === "solid" ? (
                <span className="text-warning">Фон виден только сквозь «Стекло» — со сплошными поверхностями он скрыт.</span>
              ) : (
                "«Стекло» — полупрозрачные панели, сквозь которые виден фон."
              )
            }
          >
            <SegmentedControl<UserPreference["surfaceStyle"]>
              aria-label="Поверхности"
              value={form.surfaceStyle}
              onChange={(surfaceStyle) => setForm({ ...form, surfaceStyle })}
              options={[
                { value: "solid", label: "Сплошные" },
                { value: "glass", label: "Стекло" }
              ]}
            />
          </SettingRow>
          {form.surfaceStyle === "glass" ? (
            <>
              <SettingRow label={`Прозрачность панелей: ${Math.round(form.panelOpacity * 100)}%`}>
                <Slider bare label="Прозрачность панелей" min={0.1} max={1} step={0.05} value={form.panelOpacity} onChange={(panelOpacity) => setForm({ ...form, panelOpacity })} />
              </SettingRow>
              <SettingRow label={`Сила блюра: ${form.panelBlur}px`}>
                <Slider bare label="Сила блюра" min={0} max={40} step={1} value={form.panelBlur} onChange={(panelBlur) => setForm({ ...form, panelBlur })} />
              </SettingRow>
              <SettingRow label="Цвет панелей">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Цвет панелей"
                    value={form.panelAccent ?? "#0d0d11"}
                    onChange={(e) => setForm({ ...form, panelAccent: e.target.value })}
                    className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                  />
                  {form.panelAccent ? (
                    <button type="button" className="text-2xs text-accent-text hover:underline" onClick={() => setForm({ ...form, panelAccent: null })}>
                      Нейтральный
                    </button>
                  ) : (
                    <span className="text-2xs text-subtle-foreground">Нейтральный</span>
                  )}
                </div>
              </SettingRow>
            </>
          ) : null}
        </SettingGroup>
      ) : null}

      <SettingGroup title="Движение">
        <SettingRow
          anchor="motion"
          label="Анимации"
          description={
            systemReducesMotion
              ? "В системе включено уменьшение движения — на этом устройстве анимации выключены, что бы ни было выбрано."
              : "«Спокойные» — короткие переходы без отскока, для долгой работы. «Выразительные» — с пружиной и световыми акцентами."
          }
        >
          <RubberSegment<UserPreference["motionLevel"]>
            label="Анимации"
            value={form.motionLevel}
            onChange={(motionLevel) => setForm({ ...form, motionLevel })}
            options={[
              { value: "off", label: "Выключены" },
              { value: "calm", label: "Спокойные" },
              { value: "expressive", label: "Выразительные" }
            ]}
          />
        </SettingRow>
        <SettingRow anchor="target-cursor" label="Курсор-цель" description="Рамка вокруг кнопки или ссылки под курсором; сам курсор остаётся системным.">
          <Switch label="Курсор-цель" checked={form.targetCursorEnabled} onChange={(targetCursorEnabled) => setForm({ ...form, targetCursorEnabled })} />
        </SettingRow>
        <SettingRow
          anchor="sound"
          label="Звуки"
          description="«Тихо» — только напоминания и предупреждения. «Полностью» — также отметка, сохранение, удаление навсегда, вход и выход."
        >
          <SegmentedControl<UserPreference["soundLevel"]>
            aria-label="Звуки"
            value={form.soundLevel}
            onChange={(soundLevel) => setForm({ ...form, soundLevel })}
            options={[
              { value: "off", label: "Выключены" },
              { value: "quiet", label: "Тихо" },
              { value: "full", label: "Полностью" }
            ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Отображение">
        <SettingRow anchor="note-ids" label="Номера заметок" description="Короткий номер вида N-104 в списке и в заметке — для ссылок; в поиске находится по номеру.">
          <Switch label="Номера заметок" checked={form.showNoteIds} onChange={(showNoteIds) => setForm({ ...form, showNoteIds })} />
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
