---
name: ORION
description: Точная модульная рабочая станция для задач, проектов и личных данных.
colors:
  primary: "#c9a86a"
  primary-hover: "#dec08b"
  accent-foreground: "#16171a"
  canvas: "#0f1012"
  surface: "#16171a"
  elevated: "#1d1e22"
  hover: "#27282d"
  text-primary: "#f2f0ea"
  text-secondary: "#b2b0a9"
  text-subtle: "#a6a49f"
  border: "#414248"
  border-strong: "#66676e"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#fb7185"
  info: "#60a5fa"
typography:
  display:
    fontFamily: "Onest Variable, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Onest Variable, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Onest Variable, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Onest Variable, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  micro:
    fontFamily: "Onest Variable, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "0.06em"
  data:
    fontFamily: "IBM Plex Mono, Cascadia Mono, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  radius-4: "0.25rem"
  radius-6: "0.375rem"
  radius-8: "0.5rem"
  radius-10: "0.625rem"
  radius-12: "0.75rem"
  radius-16: "1rem"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.25rem"
  space-6: "1.5rem"
  space-8: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "rgba(251, 113, 133, 0.1)"
    textColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 16px"
  input-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-6}"
    padding: "8px 12px"
  navigation-active:
    backgroundColor: "rgba(201, 168, 106, 0.1)"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.radius-6}"
    padding: "8px 12px"
  chip-neutral:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.data}"
    rounded: "{rounded.radius-4}"
    padding: "2px 6px"
  card-default:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-8}"
    padding: "16px"
  track-default:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.radius-8}"
    padding: "16px"
---

# Design System: ORION

## Overview

**Creative North Star: "Точная модульная рабочая станция"**

ORION использует дисциплину профессионального нелинейного редактора: рабочие области закреплены, контекст не исчезает между задачами, а иерархия возникает из типографики, линий и выравнивания. Это не буквальная стилизация под видеоредактор и не набор одинаковых карточек. Каждый модуль сохраняет собственную рабочую меру — от компактной формы до широкого календаря или таблицы.

Материал интерфейса спокойный и плоский: graphite, bone text, тонкие seams и редкий акцент пользовательской темы. Светлые и тёмные палитры меняют цвет, но не геометрию. Плотность остаётся рабочей, а не тесной; свободное пространство отделяет смысловые группы, а не заполняется декоративными эффектами.

**Key Characteristics:**
- Закреплённые панели и зарегистрированные tracks вместо свободной card-сетки.
- Тонкие границы, небольшие радиусы и ясные базовые линии.
- Onest для интерфейса и IBM Plex Mono для измерений.
- Акцент только для действия, выбора, фокуса и текущего положения.
- Сохранение поведения, данных и пользовательских конфигураций при смене темы.

## Colors

Палитра строится от нейтральных рабочих поверхностей; пользовательская тема заменяет весь набор семантических токенов, а не только акцентную кнопку.

### Primary
- **Warm Signal Gold**: основное действие, активная вкладка, фокус и текущий раздел. Hover использует более светлый оттенок той же темы.
- **Accent Ink**: текст и иконки на акцентной заливке; выбирается темой вместе с контрастной парой.

### Neutral
- **Graphite Canvas**: фон всей рабочей станции и полей ввода.
- **Panel Graphite**: закреплённые панели, заголовки и сайдбары.
- **Elevated Graphite**: tracks, карточки и рабочие группы.
- **Hover Graphite**: спокойная обратная связь без изменения размеров.
- **Bone / Secondary / Subtle**: три ступени текста; ни одна не используется как декоративный полутон за счёт доступности.
- **Seam / Strong Seam**: обычные и усиленные границы, разделители и focus-adjacent контуры.

### Semantic
- **Success, Warning, Danger, Info**: только состояния и доменные обозначения. Они не становятся дополнительными фирменными акцентами.

**Правило одного сигнала.** Акцент обозначает действие, выбор, фокус или текущее положение; не использовать его как общий фон раздела или декоративную заливку.

**Правило темной независимости.** Новые компоненты читают семантические токены и tint текущей темы; локальные белые подложки и фиксированные dark-only цвета запрещены.

## Typography

**Display Font:** Onest Variable с системными sans-serif fallback.
**Body Font:** Onest Variable с системными sans-serif fallback.
**Label/Mono Font:** IBM Plex Mono с моноширинными fallback.

Onest обеспечивает компактный, спокойный гротеск с полной кириллицей. IBM Plex Mono не имитирует «технический» стиль, а выравнивает числа, даты, время, идентификаторы, код и клавиатурные подсказки.

### Hierarchy
- **Display**: единственный заголовок панели; усилен небольшим отрицательным tracking, а не гигантским кеглем.
- **Headline / Track title**: название рабочей группы; отделяется rule снизу и весом.
- **Title**: карточка, dialog или независимая смысловая секция.
- **Body**: основной текст и действия; длинный prose ограничивается рабочей мерой, а не растягивается на весь dock.
- **Label**: фильтры, метаданные, вторичные действия и плотные строки.
- **Micro**: короткие групповые подписи и uppercase table headers; не использовать для основного содержимого.
- **Data**: моноширинные числа и время с tabular numerals там, где важно сравнение по вертикали.

**Правило двух голосов.** Onest говорит интерфейсом, IBM Plex Mono — данными; моноширинный шрифт не применяется к обычным заголовкам ради стилистики.

## Layout

Основа — docked panels с независимыми scroll regions. Заголовок панели остаётся наверху, действия находятся справа, фильтры образуют второй ряд только при необходимости. Внутренние tracks получают общий panel padding и panel gap; вложенные группы разделяются линиями и ритмом, а не бесконечной вложенностью карточек.

Ширина определяется работой: feed, prose, settings и wide используют существующие меры `PanelBody`; календари, доски, таблицы и канвасы занимают доступную ширину. Dashboard начинается с command strip, затем показывает focus и ближайшие записи без потери контекста рабочего пространства.

На узком экране навигация становится drawer, вторичные chrome-элементы упрощаются, toolbar переносится, а карточки и tracks перестраиваются целиком. Компактная плотность уменьшает root scale и row rhythm, сохраняя читаемый micro text. Проверенные ширины: 390, 768, 1171 и 1440 px; горизонтальный overflow не является способом адаптации.

**Правило рабочей меры.** Не назначать всем разделам одинаковую ширину или одинаковые карточки: форма следует задаче и объёму данных.

## Elevation & Depth

Рабочие поверхности плоские: глубина передаётся последовательностью canvas → panel → elevated, тонкими границами и перекрытием docked regions. Обычные карточки не получают hover-lift или декоративное свечение.

### Shadow Vocabulary
- **Transport shadow**: мягкая offset-тень под глобальными transport controls; отделяет плавающий инструмент от рабочей области.
- **Compact transport shadow**: уменьшенный вариант для mobile; не создаёт нулевой цветной halo.

**Правило плоской основы.** В состоянии покоя достаточно border или тонального слоя; shadow принадлежит плавающим и overlay-элементам, а не каждой карточке.

## Shapes

Базовая геометрия прямоугольная и инструментальная. Маленький радиус смягчает угол, но не превращает контрол в капсулу. Tabs и badges используют самый маленький радиус, buttons и navigation — средний, cards и tracks — следующий шаг. Более крупные существующие радиусы допустимы для overlay и media, но не становятся новым стандартом рабочих карточек.

Активный раздел получает accent seam толщиной 1 px: слева в вертикальной навигации, сверху в dock tab. Круги зарезервированы для status dots, avatar, spinner и кругового прогресса.

**Правило спокойных углов.** Форма показывает функцию: маленькие радиусы для рабочих контролов, pill только там, где круглая геометрия сама является состоянием или метрикой.

## Components

### Buttons
- **Shape:** слегка скруглённый прямоугольник; минимальная высота 32 px, компактный variant сохраняет тот же радиус.
- **Primary:** акцентная заливка и контрастный accent foreground; primary в панели обычно один.
- **Outline:** прозрачный фон и видимая граница для равнозначного или второго действия.
- **Ghost / Subtle:** тихие действия в toolbar и плотных строках; различие создаётся начальным фоном и тоном текста.
- **Danger:** семантическая заливка низкой плотности и danger text.
- **Hover / Focus:** меняются только цвета; focus-visible имеет читаемый ring, active сдвигается на 1 px без scale.
- **Disabled / Pending:** сохраняют геометрию; disabled уменьшает opacity, pending показывает spinner и блокирует повторное действие.

### Chips
- **Style:** компактный bordered rectangle с mono label; цвет зависит от semantic tone.
- **State:** selected фильтр может использовать tonal surface; danger и warning дублируют цвет иконкой.
- **Counts:** числовой badge не получает лишнюю status-иконку.

### Cards / Containers
- **Corner Style:** умеренное скругление, общее для карточек и tracks.
- **Background:** elevated поверхность поверх panel; hover лишь усиливает границу или тон.
- **Shadow Strategy:** без shadow в рабочем потоке.
- **Border:** тонкий seam; активная карточка использует focus/accent outline, а не цветную боковую полосу.
- **Internal Padding:** единый ритм; заголовок track отделяется от строк горизонтальным rule.

### Inputs / Fields
- **Style:** тонкая граница, приглушённый canvas background, спокойный радиус и видимый placeholder.
- **Focus:** accent border плюс тонкий focus ring; command strip сохраняет общий внешний контур.
- **Error / Disabled:** сохраняют размер и читаемость; ошибка объясняет проблему и восстановление существующим product copy.

### Navigation
- **Style:** компактные строки с библиотечной SVG-иконкой, текстом Onest 400 и опциональным count; размер текста не уменьшается ради плотности.
- **Spacing:** 10 px между иконкой и подписью; подпись выравнивается влево, длинное название обрезается с ellipsis и не сдвигает count.
- **Default / Hover:** secondary text; hover использует текущий tint и сдвиг иконки не более 1 px.
- **Active:** tonal track, primary text и accent seam толщиной 1 px.
- **Mobile:** drawer с увеличенной высотой строки; полная, компактная и icon-only плотности остаются пользовательскими настройками.

### Dock Tabs and Transport
- **Tabs:** небольшой верхний радиус, активная вкладка продолжает panel surface и отмечается верхним accent seam.
- **Transport:** квадратные icon controls в общей плавающей рамке; backdrop blur не нужен.
- **Icons:** только Lucide или authored SVG одной толщины; Unicode-символы не заменяют иконки действий.

## Do's and Don'ts

### Do:
- **Do** собирать новые разделы из PanelShell, PanelHeader, PanelBody, общих primitives и семантических токенов.
- **Do** сохранять одинаковую геометрию в Arctic, тёмных presets, пользовательских темах и plugins-off.
- **Do** проверять реальные данные, empty/error/loading/disabled states, клавиатурный фокус и ширины 390, 768, 1171 и 1440 px.
- **Do** использовать mono и tabular numerals для измерений, времени и сравниваемых чисел.
- **Do** оставлять акцент редким и функциональным.

### Don't:
- **Don't** превращать каждую смысловую группу в отдельную одинаковую карточку или вкладывать карточки друг в друга без необходимости.
- **Don't** возвращать glass, декоративный blur, glow, gradient text или hover-lift рабочих карточек.
- **Don't** использовать pill как универсальную форму кнопок, badges и вкладок.
- **Don't** применять scale-анимации, bounce easing или Unicode-глифы вместо иконок.
- **Don't** hardcode белые overlays, dark-only цвета или локальную типографику вне токенов.
