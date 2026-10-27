import { Palette, Move3D, Mic, HardDriveDownload, Download, Activity, Info, type LucideIcon } from "lucide-react";
import type { SettingsPageId } from "../navigation/routes";
export interface SettingsPageDefinition { id: SettingsPageId; label: string; summary: string; icon: LucideIcon; group: "device" | "help" }
export const SETTINGS_PAGES: readonly SettingsPageDefinition[] = [
  { id: "appearance", label: "Внешний вид", summary: "Тема и цвета KAIDEN", icon: Palette, group: "device" },
  { id: "motion", label: "Движение и жесты", summary: "Наклон и быстрые действия", icon: Move3D, group: "device" },
  { id: "voice", label: "Голос и ввод", summary: "Системная диктовка", icon: Mic, group: "device" },
  { id: "data", label: "Данные и резервные копии", summary: "Локальные записи и экспорт", icon: HardDriveDownload, group: "device" },
  { id: "updates", label: "Обновления", summary: "Версия и установка APK", icon: Download, group: "device" },
  { id: "diagnostics", label: "Диагностика", summary: "Хранилище, связь и датчик", icon: Activity, group: "help" },
  { id: "about", label: "О приложении", summary: "Версия и возможности", icon: Info, group: "help" },
];
export const SETTINGS_FIELDS = [
  { id: "theme", page: "appearance", label: "Тема на этом телефоне", keywords: "системная светлая тёмная режим" },
  { id: "dark-theme", page: "appearance", label: "Цвета тёмной темы", keywords: "тёмная темная палитра precision obsidian midnight emerald crimson" },
  { id: "depth-effects", page: "motion", label: "Глубина при наклоне", keywords: "датчик параллакс движение эффект" },
  { id: "depth-strength", page: "motion", label: "Сила наклона", keywords: "чувствительность глубина" },
  { id: "cosmos-mode", page: "motion", label: "Живой фон", keywords: "living cosmos графит текстуры орбиты гипноз движение фон" },
  { id: "swipe-gestures", page: "motion", label: "Свайпы по задачам и заметкам", keywords: "свайп вправо влево выполнить закрепить удалить жест" },
  { id: "quick-actions", page: "motion", label: "Быстрые действия", keywords: "удержание холо жест перетаскивание drag" },
  { id: "dictation", page: "voice", label: "Системная диктовка", keywords: "голос микрофон транскрибация распознавание речь" },
  { id: "backup", page: "data", label: "Резервная копия", keywords: "экспорт данные сохранить файл json" },
  { id: "auto-check-updates", page: "updates", label: "Проверять автоматически", keywords: "обновления версия apk" },
  { id: "download-updates-wifi", page: "updates", label: "Загружать по Wi-Fi", keywords: "скачать интернет обновления" },
  { id: "health", page: "diagnostics", label: "Состояние приложения", keywords: "ошибка хранилище датчик связь очередь" },
  { id: "version", page: "about", label: "Версия приложения", keywords: "о программе android kaiden orion" },
] as const;
const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е");
export function searchSettings(query: string) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return SETTINGS_FIELDS.filter((field) => {
    const page = SETTINGS_PAGES.find((item) => item.id === field.page)!;
    const haystack = normalize(field.label + " " + field.keywords + " " + page.label);
    return words.every((word) => haystack.includes(word));
  });
}
