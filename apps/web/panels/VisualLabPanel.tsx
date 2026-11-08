"use client";

import {
  Accordion,
  ActionBar,
  Alert,
  AnimatedList,
  Announcement,
  AspectRatio,
  Avatar,
  BellToggle,
  Bento,
  BlurText,
  BorderGlow,
  BranchedMenu,
  Breadcrumb,
  CALM_BACKGROUNDS,
  CALM_BACKGROUND_LABELS,
  CalendarPicker,
  CardStack,
  Carousel,
  Chart,
  CircularProgress,
  ClickSpark,
  ClipboardButton,
  CodeBlock,
  CodeSlots,
  Collapsible,
  ColorPicker,
  Combobox,
  CometDial,
  Compare,
  CountUp,
  Cover,
  DataList,
  DataTable,
  DateInput,
  DirectionAware,
  Dock,
  DraggableCard,
  Editable,
  ElasticSlider,
  EmptyScene,
  ExpandableCard,
  FadeContent,
  Field,
  FileDrop,
  FlipCard,
  FocusCards,
  FolderCard,
  Frame,
  GlideSelect,
  GlassSurface,
  GradientText,
  Highlight,
  Hitbox,
  HoldButton,
  HoverCard,
  ImageCropper,
  ImageSlider,
  InputGroup,
  JsonTree,
  KeyboardKeys,
  LayoutGrid,
  Lens,
  LineSidebar,
  LinkPreview,
  Listbox,
  MagicBento,
  Magnet,
  Masonry,
  MorphStatus,
  MovingBorder,
  NumberInput,
  Orb,
  OtpInput,
  PanelBody,
  PanelHeader,
  PanelShell,
  PaperPlaneButton,
  PasswordInput,
  PillNav,
  PointerHighlight,
  Presence,
  ProfileCard,
  Progress,
  PromptBar,
  Prose,
  QrCode,
  RadioGroup,
  RubberSegment,
  ScrubField,
  ScrollArea,
  ShinyText,
  SlideCommit,
  SlingButton,
  Sparkles,
  SpecularButton,
  SplitText,
  CursorSpotlight,
  SpringCheck,
  SquishSwitch,
  Stack,
  StatefulButton,
  StatsRow,
  Steps,
  Stepper,
  Swap,
  SwipeToast,
  TabsBar,
  TagsInput,
  TerminalView,
  TextType,
  ThoughtLine,
  Timeline,
  Timer,
  Tour,
  TracingBeam,
  TreeView,
  VanishInput,
  VisualStyle,
  VoicePill,
  WakeSlider,
  WarmTooltip,
  BackgroundSwatch,
  Slider,
  type CalmBackgroundId
} from "@orion/ui";
import { useState } from "react";
import type { PanelComponentProps } from "../lib/panel-registry";

const TABS = ["Формы", "Данные", "Движение", "Сцены", "Фоны"] as const;

export function VisualLabPanel(_props: PanelComponentProps): React.ReactElement {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Формы");
  const [name, setName] = useState("Задача");
  const [amount, setAmount] = useState(1200);
  const [date, setDate] = useState("2026-11-08");
  const [tags, setTags] = useState(["дом"]);
  const [project, setProject] = useState<string | null>("p1");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [hue, setHue] = useState("#c9a86a");
  const [volume, setVolume] = useState(40);
  const [picked, setPicked] = useState<string[]>(["Утро"]);
  const [glide, setGlide] = useState("Список");
  const [radio, setRadio] = useState<"a" | "b">("a");
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(1);
  const [segment, setSegment] = useState<"day" | "week">("day");
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [toast, setToast] = useState(true);
  const [tour, setTour] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [crop, setCrop] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "done">("idle");
  const [swap, setSwap] = useState<"a" | "b">("a");
  const [show, setShow] = useState(true);
  const [announce, setAnnounce] = useState(true);
  const [selected, setSelected] = useState(2);
  const [voice, setVoice] = useState(false);
  const [bell, setBell] = useState(true);
  const [morph, setMorph] = useState<"idle" | "run" | "done">("idle");
  const [sent, setSent] = useState("");
  const [bg, setBg] = useState<CalmBackgroundId>("silk");
  const [hold, setHold] = useState("удержите");

  return (
    <PanelShell>
      <VisualStyle />
      <PanelHeader title="Визуал" />
      <PanelBody className="space-y-4">
        <PillNav tabs={[...TABS]} value={tab} onChange={(value) => setTab(value as (typeof TABS)[number])} />
        {tab === "Формы" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Название" hint="Сохранится вместе с записью" error={name.trim() ? undefined : "Нужно название"}>
              <Editable label="Название" value={name} onChange={setName} />
            </Field>
            <Field label="Проект"><Combobox label="Проект" items={[{ id: "p1", label: "Дом" }, { id: "p2", label: "Работа" }]} value={project} onChange={setProject} /></Field>
            <Field label="Сумма"><InputGroup suffix="₽"><NumberInput label="Сумма" value={amount} min={0} step={100} onChange={setAmount} /></InputGroup></Field>
            <Field label="Срок"><DateInput label="Срок" value={date} onChange={setDate} /></Field>
            <TagsInput label="Теги" value={tags} onChange={setTags} />
            <PasswordInput aria-label="Пароль" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Пароль" />
            <OtpInput value={pin} onChange={setPin} />
            <CodeSlots label="PIN" value={pin} onChange={setPin} />
            <ColorPicker label="Цвет" value={hue} onChange={setHue} />
            <Slider label={`Громкость ${volume}`} value={volume} min={0} max={100} onChange={setVolume} />
            <WakeSlider label="След громкости" value={volume} min={0} max={100} onChange={setVolume} />
            <ElasticSlider label="Упругая громкость" value={volume} min={0} max={100} onChange={setVolume} />
            <ScrubField label="Минуты" value={volume} min={0} max={180} onChange={setVolume} />
            <Listbox label="Когда" options={["Утро", "День", "Вечер"]} value={picked} onChange={setPicked} />
            <GlideSelect label="Вид" options={["Список", "Доска", "Календарь"]} value={glide} onChange={setGlide} />
            <RadioGroup label="Режим" value={radio} options={[{ value: "a", label: "Тихо" }, { value: "b", label: "Подробно" }]} onChange={setRadio} />
            <Frame title="Группа"><VanishInput label="Поиск" placeholders={["Задача…", "Заметка…"]} value={query} onChange={setQuery} /></Frame>
            <CalendarPicker value={date.slice(0, 10)} onChange={setDate} />
          </div>
        ) : null}
        {tab === "Данные" ? (
          <div className="space-y-4">
            <Breadcrumb items={[{ label: "Документы", onClick: () => undefined }, { label: "Дом" }]} />
            <div className="flex items-center gap-3"><Avatar name="Рено" /><ProfileCard name="Рено" role="Владелец" /><Hitbox label="Ещё"><span className="text-label">···</span></Hitbox></div>
            <DataList rows={[{ label: "Срок", value: date }, { label: "Сумма", value: `${amount} ₽` }]} />
            <TreeView nodes={[{ id: "a", label: "Документы", children: [{ id: "b", label: "Договоры" }, { id: "c", label: "Фото" }] }]} />
            <DataTable columns={["Счёт", "Сумма"]} rows={[["Карта", "1 200"], ["Наличные", "400"]]} />
            <Timeline items={[{ time: "09:10", title: "Создана задача", detail: "Дом" }, { time: "12:40", title: "Срок сдвинут" }]} />
            <Progress label="Бюджет" value={62} />
            <CircularProgress label="Привычка" value={75} />
            <Timer />
            <Chart points={[{ label: "пн", value: 2 }, { label: "вт", value: 5 }, { label: "ср", value: 3 }]} />
            <Chart kind="line" points={[{ label: "пн", value: 2 }, { label: "вт", value: 5 }, { label: "ср", value: 3 }, { label: "чт", value: 4 }]} />
            <Steps items={["Связь", "Токен", "Готово"]} current={step} />
            <Stepper items={["Связь", "Токен", "Готово"]} current={step} onChange={setStep} />
            <Alert title="Ключ не сохранён">Проверьте соединение и повторите.</Alert>
            <Alert tone="danger" title="Не удалось записать" />
            {announce ? <Announcement onClose={() => setAnnounce(false)}>Есть обновление оболочки.</Announcement> : null}
            <ActionBar count={selected} onClear={() => setSelected(0)}><button type="button" className="text-label" onClick={() => setSelected(selected + 1)}>Добавить</button></ActionBar>
            <HoverCard trigger={<button type="button" className="text-label underline">Карточка дома</button>}><span>Три открытые задачи</span></HoverCard>
            <ClipboardButton text="orion://home" />
            <Accordion items={[{ title: "Напоминания", body: "Тихие часы с 23:00" }, { title: "Звук", body: "Только чужие события" }]} />
            <Collapsible title="Подробности">Скрытый текст секции.</Collapsible>
            <ScrollArea label="Длинный список">{Array.from({ length: 12 }, (_, index) => <p key={index}>Строка {index + 1}</p>)}</ScrollArea>
            <QrCode text="https://127.0.0.1:4000" />
            <AspectRatio><div className="h-full w-full bg-ui-hover" /></AspectRatio>
            <ImageCropper onCrop={setCrop} />
            {crop ? <img src={crop} alt="Обрезанное" className="h-16" /> : null}
            <JsonTree value={{ panel: "visual", step }} />
            <Prose><p>Абзац заметки и <code>код</code> в одной колонке.</p></Prose>
            <KeyboardKeys keys={["Ctrl", "K"]} />
            <p><Highlight text="Найти задачу дома" query="задач" /></p>
            <CardStack cards={[{ title: "Входящее", body: "Счёт за свет" }, { title: "Позже", body: "Позвонить" }]} />
            <ExpandableCard title="Сегодня" summary="Две задачи"><p>Купить фильтр. Закрыть отчёт.</p></ExpandableCard>
            <TabsBar tabs={["День", "Неделя"]} value={segment === "day" ? "День" : "Неделя"} onChange={(value) => setSegment(value === "День" ? "day" : "week")} />
            <TracingBeam progress={40}><p className="text-body">Ход чтения длинной заметки.</p></TracingBeam>
            <Compare before="linear-gradient(#3a3428,#1b1c1f)" after="linear-gradient(#1b1c1f,#c9a86a)" />
            <ImageSlider />
            <Lens />
            <CodeBlock code={"const greeting = \"ORION\";"} />
            <TerminalView lines={[{ kind: "in", text: "status" }, { kind: "out", text: "агент свободен" }]} />
            <LinkPreview href="https://orion.local" title="Узел дома" description="Локальный адрес этого компьютера" />
            <FileDrop onFiles={(list) => setFiles(list.map((file) => file.name))} />
            {files.length ? <p className="text-label">{files.join(", ")}</p> : null}
            <StatsRow items={[{ label: "Открыто", value: "4" }, { label: "Сегодня", value: "2" }, { label: "Просрочено", value: "0" }]} />
            <Bento><div className="rounded-lg border border-border p-3">Главное</div><div className="rounded-lg border border-border p-3">Рядом</div><div className="rounded-lg border border-border p-3">Ещё</div></Bento>
            <LayoutGrid>{["А", "Б", "В"].map((item) => <div key={item} className="rounded-lg border border-border p-3">{item}</div>)}</LayoutGrid>
            <FocusCards cards={["Сейчас", "Дальше", "Потом"]} />
            <Carousel slides={["Что нового в оболочке", "Тише движение", "Свои компоненты"]} />
            <Masonry items={[{ title: "Короткое" }, { title: "Выше", tall: true }, { title: "Ещё" }]} />
            <Dock items={[{ id: "tasks", label: "Задачи" }, { id: "notes", label: "Заметки" }]} onPick={setSent} />
            <Stack cards={["Разобрать", "Отложить", "Готово"]} />
            <FolderCard title="Дом" notes={["Договор", "Фото"]} />
            <BranchedMenu sections={[{ title: "Работа", items: ["Задачи", "Календарь"] }, { title: "Деньги", items: ["Финансы"] }]} />
            <LineSidebar items={["Дашборд", "Задачи", "Заметки", "Настройки"]} />
            <FlipCard front="Цель" back="Три шага до неё" />
            <DraggableCard title="Перетащите карточку" />
            <EmptyScene title="Пока пусто" description="Создайте первую запись — она появится в этом списке." />
          </div>
        ) : null}
        {tab === "Движение" ? (
          <div className="space-y-4">
            <p className="text-2xl"><CountUp value={12840} /></p>
            <SpringCheck label="Полить цветы" checked={checked} onChange={setChecked} />
            <SquishSwitch label="Напоминания" checked={on} onChange={setOn} />
            <RubberSegment options={[{ value: "day", label: "День" }, { value: "week", label: "Неделя" }]} value={segment} onChange={setSegment} />
            <WarmTooltip label="Срок" tip="Когда задача должна быть закрыта" />
            <ThoughtLine steps={["Смотрю открытые задачи", "Оставляю две на сегодня"]} done />
            <PromptBar value={prompt} onChange={setPrompt} onSend={() => { setSent(prompt); setPrompt(""); }} />
            {sent ? <p className="text-label">{sent}</p> : null}
            {toast ? <SwipeToast text="Сохранено" onClose={() => setToast(false)} /> : <button type="button" className="text-label" onClick={() => setToast(true)}>Показать тост</button>}
            <CursorSpotlight><p>Карточка со светом курсора</p></CursorSpotlight>
            <BorderGlow active><p>Край того, что требует внимания</p></BorderGlow>
            <AnimatedList items={["Новая задача", "Срок сегодня", "Комментарий"]} />
            <HoldButton label={hold} onConfirm={() => setHold("подтверждено")} />
            <SlideCommit label="Удалить" onConfirm={() => setHold("сдвинуто")} />
            <BellToggle on={bell} onChange={setBell} />
            <VoicePill active={voice} onChange={setVoice} />
            <SlingButton label="Отправить" onSend={() => setSent("жест отправки")} />
            <ClickSpark><button type="button" className="rounded border border-border px-3 py-2">Искра</button></ClickSpark>
            <Magnet><SpecularButton>Магнит</SpecularButton></Magnet>
            <FadeContent><p>Панель проявляется.</p></FadeContent>
            <BlurText text="Заголовок" />
            <p><SplitText text="ORION" /></p>
            <p className="text-xl"><ShinyText text="Точность" /></p>
            <p className="text-xl"><GradientText text="ORION" /></p>
            <p><TextType text="Ответ печатается по буквам." /></p>
            <CometDial value={volume / 100} />
            <Sparkles><span>Готово</span></Sparkles>
            <PaperPlaneButton label="Отправить" onClick={() => setSent("улетело")} />
            <StatefulButton status={status} onClick={() => { setStatus("pending"); window.setTimeout(() => setStatus("done"), 600); }}>Сохранить</StatefulButton>
            <Cover><div className="p-4">Накрытие</div></Cover>
            <MovingBorder><p>Бегущий край</p></MovingBorder>
            <DirectionAware label="Сторона входа" />
            <GlassSurface><p>Стекло палитры</p></GlassSurface>
            <p>Шаг <PointerHighlight>подсвечен</PointerHighlight></p>
            <button type="button" className="inline-flex items-center gap-2" onClick={() => setMorph(morph === "idle" ? "run" : morph === "run" ? "done" : "idle")}><MorphStatus state={morph} /> статус</button>
            <span className="inline-flex items-center gap-2"><Orb /> ассистент думает</span>
            <button type="button" className="text-label" onClick={() => setShow((value) => !value)}>{show ? "Скрыть" : "Показать"}</button>
            <Presence show={show}><p>Блок на месте.</p></Presence>
            <Swap mode={swap} a={<span>Первое</span>} b={<span>Второе</span>} />
            <button type="button" className="text-label" onClick={() => setSwap(swap === "a" ? "b" : "a")}>Сменить</button>
            <MagicBento cards={["Сегодня", "Деньги", "Привычки"]} />
          </div>
        ) : null}
        {tab === "Сцены" ? (
          <div className="space-y-3">
            <button type="button" className="rounded border border-border px-3 py-1 text-label" onClick={() => setTour(true)}>Тур</button>
            {tour ? <Tour steps={[{ title: "Сайдбар", body: "Отсюда открываются разделы." }, { title: "Док", body: "Панели живут рядом." }]} onClose={() => setTour(false)} /> : null}
            <EmptyScene title="Нет операций" description="Добавьте первую — график и список появятся здесь." />
          </div>
        ) : null}
        {tab === "Фоны" ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {CALM_BACKGROUNDS.map((id) => (
              <BackgroundSwatch key={id} id={id} label={CALM_BACKGROUND_LABELS[id]} selected={bg === id} onSelect={() => setBg(id)} />
            ))}
          </div>
        ) : null}
      </PanelBody>
    </PanelShell>
  );
}
