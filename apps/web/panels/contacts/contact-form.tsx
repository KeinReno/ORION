"use client";

import { CONTACT_BIRTHDAY_NO_YEAR, isValidDayKey, normalizeChannels, normalizeTags, type ContactCard, type ContactChannel, type ContactKind, type CreateContactCardInput } from "@orion/shared-types";
import { Button, CalendarPicker, Combobox, GlideSelect, IconButton, Input, SegmentedControl, Switch, Textarea, cx } from "@orion/ui";
import { Plus, Star, X } from "lucide-react";
import { useId, useState } from "react";
import { EMAIL_LABEL_SUGGESTIONS, LINK_LABEL_SUGGESTIONS, PHONE_LABEL_SUGGESTIONS } from "../../lib/contacts";

const CADENCE_PRESETS: [number | null, string][] = [
  [null, "Не напоминать"],
  [7, "Раз в неделю"],
  [14, "Раз в 2 недели"],
  [30, "Раз в месяц"],
  [60, "Раз в 2 месяца"],
  [90, "Раз в 3 месяца"],
  [180, "Раз в полгода"],
  [365, "Раз в год"]
];

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const LABEL = "flex flex-col gap-1 text-2xs text-subtle-foreground";

/** Edit/create form for one contact. Phones, emails and links are lists with a label each. */
export function ContactForm({
  initial,
  homes,
  tagSuggestions,
  busy,
  submitLabel,
  onSubmit,
  onCancel
}: {
  initial?: ContactCard;
  homes: { id: string; name: string }[];
  tagSuggestions: string[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: CreateContactCardInput) => void | Promise<void>;
  onCancel?: () => void;
}): React.ReactElement {
  const [kind, setKind] = useState<ContactKind>(initial?.kind ?? "person");
  const [name, setName] = useState(initial?.name ?? "");
  const [organization, setOrganization] = useState(initial?.organization ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [phones, setPhones] = useState<ContactChannel[]>(initial?.phones ?? []);
  const [emails, setEmails] = useState<ContactChannel[]>(initial?.emails ?? []);
  const [links, setLinks] = useState<ContactChannel[]>(initial?.links ?? []);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [birthday, setBirthday] = useState<string | null>(initial?.birthday ?? null);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [favorite, setFavorite] = useState(initial?.favorite ?? false);
  const [cadence, setCadence] = useState<number | null>(initial?.contactEveryDays ?? null);
  const [homeId, setHomeId] = useState(initial?.homeId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const emailsValid = emails.every((email) => email.value.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()));
  const valid = name.trim().length > 0 && emailsValid && (birthday === null || isValidDayKey(birthday));
  const cadenceOptions = CADENCE_PRESETS.some(([days]) => days === cadence) ? CADENCE_PRESETS : [...CADENCE_PRESETS, [cadence, `Раз в ${cadence} дн.`] as [number | null, string]];

  function submit(): void {
    if (!valid) return;
    const cleanPhones = normalizeChannels(phones, "phone");
    const cleanEmails = normalizeChannels(emails);
    void onSubmit({
      name: name.trim(),
      kind,
      organization: kind === "person" ? organization.trim() : "",
      role: role.trim(),
      phone: cleanPhones[0]?.value ?? "",
      email: cleanEmails[0]?.value ?? "",
      phones: cleanPhones,
      emails: cleanEmails,
      links: normalizeChannels(links),
      address: address.trim(),
      birthday,
      tags: normalizeTags(tags),
      favorite,
      contactEveryDays: cadence,
      note,
      homeId: homeId || null
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl<ContactKind>
          size="sm"
          aria-label="Тип контакта"
          value={kind}
          onChange={setKind}
          options={[
            { value: "person", label: "Человек" },
            { value: "organization", label: "Организация" }
          ]}
        />
        <button
          type="button"
          aria-pressed={favorite}
          onClick={() => setFavorite((value) => !value)}
          className={cx("flex items-center gap-1 rounded-md px-2 py-1 text-2xs transition-colors", favorite ? "bg-warning/15 text-warning" : "text-subtle-foreground hover:text-foreground")}
        >
          <Star className={cx("h-3.5 w-3.5", favorite && "fill-current")} /> {favorite ? "В избранном" : "В избранное"}
        </button>
      </div>

      <label className={LABEL}>
        {kind === "person" ? "Имя" : "Название"}
        <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus={!initial} required maxLength={120} />
      </label>

      <div className={cx("grid gap-3", kind === "person" && "sm:grid-cols-2")}>
        {kind === "person" ? (
          <label className={LABEL}>
            Организация
            <Input value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="где работает" maxLength={120} />
          </label>
        ) : null}
        <label className={LABEL}>
          {kind === "person" ? "Кто это / должность" : "Чем занимается"}
          <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder="сантехник, бухгалтер, клиент…" maxLength={80} />
        </label>
      </div>

      <ChannelEditor title="Телефоны" addLabel="Телефон" items={phones} onChange={setPhones} suggestions={PHONE_LABEL_SUGGESTIONS} valuePlaceholder="+7 900 000-00-00" inputMode="tel" />
      <ChannelEditor
        title="Почта"
        addLabel="Почта"
        items={emails}
        onChange={setEmails}
        suggestions={EMAIL_LABEL_SUGGESTIONS}
        valuePlaceholder="name@example.com"
        inputMode="email"
        validate={(value) => value.trim() === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())}
        invalidMessage="Введите корректный email"
      />
      <ChannelEditor title="Мессенджеры и сайты" addLabel="Ссылка" items={links} onChange={setLinks} suggestions={LINK_LABEL_SUGGESTIONS} valuePlaceholder="@username, номер или адрес" />

      <label className={LABEL}>
        Адрес
        <Input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={300} />
      </label>

      <BirthdayField value={birthday} onChange={setBirthday} />

      <TagsField tags={tags} onChange={setTags} suggestions={tagSuggestions} />

      <label className={LABEL}>
        Напоминать связаться
        <GlideSelect
          label="Напоминать связаться"
          options={cadenceOptions.map(([, label]) => label)}
          value={cadenceOptions.find(([days]) => days === cadence)?.[1] ?? "Не напоминать"}
          onChange={(label) => {
            const next = cadenceOptions.find(([, item]) => item === label);
            if (next) setCadence(next[0]);
          }}
        />
      </label>

      {homes.length > 0 || initial?.homeId ? (
        <label className={LABEL}>
          Дом
          <Combobox
            label="Дом"
            value={homeId}
            onChange={setHomeId}
            items={[{ id: "", label: "Без дома" }, ...homes.map((home) => ({ id: home.id, label: home.name }))]}
          />
        </label>
      ) : null}

      <label className={LABEL}>
        Заметка
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} />
      </label>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        ) : null}
        <Button type="submit" disabled={!valid || busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A list of «label + value» rows (phones, emails, messengers) with a datalist of common labels. */
function ChannelEditor({
  title,
  addLabel,
  items,
  onChange,
  suggestions,
  valuePlaceholder,
  inputMode,
  validate,
  invalidMessage
}: {
  title: string;
  addLabel: string;
  items: ContactChannel[];
  onChange: (items: ContactChannel[]) => void;
  suggestions: readonly string[];
  valuePlaceholder: string;
  inputMode?: "tel" | "email";
  validate?: (value: string) => boolean;
  invalidMessage?: string;
}): React.ReactElement {
  const listId = useId();
  const update = (index: number, patch: Partial<ContactChannel>): void => onChange(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-0.5 text-2xs text-subtle-foreground">{title}</legend>
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {items.map((item, index) => {
        const invalid = validate ? !validate(item.value) : false;
        return (
          <div key={index} className="flex items-start gap-1.5">
            <div className="w-32 shrink-0">
              <Input list={listId} value={item.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="метка" aria-label={`${title}: метка`} maxLength={40} />
            </div>
            <div className="min-w-0 flex-1">
              <Input value={item.value} onChange={(event) => update(index, { value: event.target.value })} placeholder={valuePlaceholder} aria-label={`${title}: значение`} aria-invalid={invalid} inputMode={inputMode} maxLength={254} />
              {invalid && invalidMessage ? <span className="text-2xs text-destructive">{invalidMessage}</span> : null}
            </div>
            <IconButton label="Убрать" size="sm" tone="danger" onClick={() => onChange(items.filter((_, position) => position !== index))}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        );
      })}
      <Button type="button" variant="subtle" size="sm" className="self-start" onClick={() => onChange([...items, { label: "", value: "" }])}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </fieldset>
  );
}

/** Full date, or just day + month when the year is unknown (stored with the 1904 sentinel year). */
function BirthdayField({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const noYear = value !== null && Number(value.slice(0, 4)) === CONTACT_BIRTHDAY_NO_YEAR;
  const [month, setMonth] = useState(value ? Number(value.slice(5, 7)) : 1);
  const [day, setDay] = useState(value ? Number(value.slice(8, 10)) : 1);
  const pad = (n: number): string => String(n).padStart(2, "0");

  function setNoYear(enabled: boolean): void {
    if (!enabled) {
      onChange(null);
      return;
    }
    // Keep the day and month already picked in the full-date mode.
    const nextMonth = value ? Number(value.slice(5, 7)) : month;
    const nextDay = value ? Number(value.slice(8, 10)) : day;
    setMonth(nextMonth);
    setDay(nextDay);
    const key = `${CONTACT_BIRTHDAY_NO_YEAR}-${pad(nextMonth)}-${pad(nextDay)}`;
    onChange(isValidDayKey(key) ? key : `${CONTACT_BIRTHDAY_NO_YEAR}-${pad(nextMonth)}-01`);
  }

  function setPart(nextMonth: number, nextDay: number): void {
    setMonth(nextMonth);
    setDay(nextDay);
    const key = `${CONTACT_BIRTHDAY_NO_YEAR}-${pad(nextMonth)}-${pad(nextDay)}`;
    if (isValidDayKey(key)) onChange(key);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-subtle-foreground">День рождения</span>
        <label className="flex items-center gap-2 text-2xs text-subtle-foreground">
          Год неизвестен
          <Switch
            checked={noYear}
            onChange={(checked) => {
              if (checked) setNoYear(true);
              else onChange(null);
            }}
            label="Год рождения неизвестен"
          />
        </label>
      </div>
      {noYear ? (
        <div className="flex gap-2">
          <div className="w-20 shrink-0">
            <Input type="number" min={1} max={31} value={day} onChange={(event) => setPart(month, Number(event.target.value) || 1)} aria-label="День" />
          </div>
            <GlideSelect
              label="Месяц"
              options={MONTHS}
              value={MONTHS[month - 1] ?? MONTHS[0]}
              onChange={(label) => {
                const index = MONTHS.indexOf(label);
                if (index >= 0) setPart(index + 1, day);
              }}
            />
        </div>
      ) : (
        <div className="flex gap-2">
          <CalendarPicker value={value ?? ""} onChange={(next) => { if (next.length === 10) onChange(next); }} />
          {value ? (
            <IconButton label="Очистить дату" onClick={() => onChange(null)}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Chips with a free-text input; Enter or a comma adds the tag, existing tags of the workspace are suggested. */
function TagsField({ tags, onChange, suggestions }: { tags: string[]; onChange: (tags: string[]) => void; suggestions: string[] }): React.ReactElement {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function commit(raw: string): void {
    const next = normalizeTags([...tags, ...raw.split(",")]);
    if (next.length !== tags.length) onChange(next.slice(0, 20));
    setDraft("");
  }

  return (
    <div className={LABEL}>
      <span>Теги</span>
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !tags.some((own) => own.toLocaleLowerCase("ru") === tag.toLocaleLowerCase("ru")))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white/[0.02] p-1.5">
        {tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground">
            {tag}
            <button type="button" aria-label={`Убрать тег ${tag}`} onClick={() => onChange(tags.filter((own) => own !== tag))} className="text-subtle-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          list={listId}
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            if (value.endsWith(",")) commit(value);
            else setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim()) {
              event.preventDefault();
              commit(draft);
            } else if (event.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={tags.length === 0 ? "семья, клиенты, подрядчики…" : "ещё тег"}
          aria-label="Новый тег"
          maxLength={30}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-label text-foreground outline-none placeholder:text-subtle-foreground"
        />
      </div>
    </div>
  );
}
