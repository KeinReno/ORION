"use client";

import {
  useAppInfo,
  useChangePassword,
  useCore,
  useDeleteAvatar,
  useLogoutAll,
  usePreferences,
  useRevokeSession,
  useSession,
  useSessions,
  useUpdatePreferences,
  useUpdateProfile,
  useUploadAvatar
} from "@orion/core-react";
import type { SessionInfo, UpdateUserPreferenceInput, UserPreference } from "@orion/shared-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelShell,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  cx,
  useToast
} from "@orion/ui";
import { AlertCircle, LogOut, Settings } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { describeAuthError } from "../lib/error-message";
import { relativeTime, shortDateTime } from "../lib/format";
import { AccountAvatar } from "../components/account-avatar";
import { BackgroundEffectSettingsForm } from "./settings/background-effect-form";
import { ModulesSettings } from "./settings/modules-section";
import { PluginsSettings } from "./settings/plugins-section";
import { MembersSettings } from "./settings/members-section";
import { WorkspaceSettings } from "./settings/workspace-section";
import { SpheresSettings } from "./settings/spheres-section";

type Tab =
  | "profile"
  | "security"
  | "notifications"
  | "appearance"
  | "modules"
  | "plugins"
  | "workspace"
  | "spheres"
  | "members"
  | "about";
type PreferenceKey = keyof UserPreference;

const TABS: { value: Tab; label: string }[] = [
  { value: "profile", label: "Профиль" },
  { value: "security", label: "Безопасность" },
  { value: "notifications", label: "Уведомления" },
  { value: "appearance", label: "Внешний вид" },
  { value: "modules", label: "Модули" },
  { value: "plugins", label: "Плагины" },
  { value: "workspace", label: "Пространство" },
  { value: "spheres", label: "Сферы" },
  { value: "members", label: "Участники" },
  { value: "about", label: "О приложении" }
];

/** Which preference fields each tab owns — a save sends only these, never the whole object. */
const NOTIFICATION_KEYS: readonly PreferenceKey[] = [
  "desktopNotifications",
  "taskReminders",
  "eventReminders",
  "financeAlerts",
  "inventoryAlerts",
  "quietHoursStart",
  "quietHoursEnd"
];
const APPEARANCE_KEYS: readonly PreferenceKey[] = [
  "theme",
  "accent",
  "density",
  "backgroundStyle",
  "backgroundIntensity",
  "backgroundEffectSettings",
  "targetCursorEnabled",
  "surfaceStyle",
  "panelOpacity",
  "panelBlur",
  "panelAccent",
  "timeZone",
  "weekStartsOn"
];

const WEBGL_BACKGROUND_STYLES = new Set<UserPreference["backgroundStyle"]>([
  "liquid-ether",
  "light-pillar",
  "dark-veil",
  "shape-waves"
]);

/** Swatch hex per accent — mirrors the `--orion-accent` values in globals.css, for the picker dots only. */
const ACCENT_HEX: Record<UserPreference["accent"], string> = {
  violet: "#6366f1",
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  rose: "#f43f5e"
};
const ACCENT_LABEL: Record<UserPreference["accent"], string> = {
  violet: "Фиолетовый",
  blue: "Синий",
  green: "Зелёный",
  amber: "Янтарный",
  rose: "Розовый"
};
const ACCENT_OPTIONS = (Object.keys(ACCENT_HEX) as UserPreference["accent"][]).map((value) => ({
  value,
  label: (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ACCENT_HEX[value] }} aria-hidden />
      {ACCENT_LABEL[value]}
    </span>
  )
}));

/**
 * Partial patch built from just `keys`. The endpoint takes
 * `UpdateUserPreferenceInput` (the settings schema `.partial()`), so untouched
 * fields must stay out of the body rather than be echoed back. Value
 * comparison is enough: every field here is a primitive, and
 * `dashboardWidgets` (the one array) is never edited by this panel.
 */
function diffPreferences(
  form: UserPreference,
  saved: UserPreference,
  keys: readonly PreferenceKey[]
): UpdateUserPreferenceInput {
  const patch: UpdateUserPreferenceInput = {};
  for (const key of keys) {
    if (form[key] !== saved[key]) (patch as Record<string, unknown>)[key] = form[key];
  }
  return patch;
}

export function SettingsPanel(): React.ReactElement {
  const { api } = useCore();
  const { user } = useSession();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const changePassword = useChangePassword();
  const sessions = useSessions();
  const revokeSession = useRevokeSession();
  const logoutAll = useLogoutAll();
  const appInfo = useAppInfo();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>("profile");
  const [form, setForm] = useState<UserPreference | null>(null);
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", newPin: "", revokeOtherSessions: true });
  const [unlock, setUnlock] = useState<"password" | "pin">("password");
  const [avatarBust, setAvatarBust] = useState(0);
  const [pendingSession, setPendingSession] = useState<SessionInfo | null>(null);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [health, setHealth] = useState<{ status: string; database: string; timestamp: string } | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // The query cache is the source of truth: a save invalidates ["preferences"]
  // and this reseeds the form with exactly what the server stored.
  useEffect(() => {
    if (preferences.data) setForm(preferences.data);
  }, [preferences.data]);
  useEffect(() => {
    if (user) {
      setProfile({ name: user.name, email: user.email ?? "" });
      setUnlock(user.unlockKind);
    }
  }, [user]);

  function isDirty(keys: readonly PreferenceKey[]): boolean {
    if (!form || !preferences.data) return false;
    return Object.keys(diffPreferences(form, preferences.data, keys)).length > 0;
  }

  async function savePreferences(keys: readonly PreferenceKey[], title: string): Promise<void> {
    if (!form || !preferences.data) return;
    const patch = diffPreferences(form, preferences.data, keys);
    if (Object.keys(patch).length === 0) {
      toast({ title: "Изменений нет", tone: "default" });
      return;
    }
    try {
      await updatePreferences.mutateAsync(patch);
      toast({ title, tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить настройки", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await updateProfile.mutateAsync({ name: profile.name.trim(), email: profile.email.trim() || null });
      toast({ title: "Профиль обновлён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить профиль", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function savePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await changePassword.mutateAsync({
        currentPassword: passwords.currentPassword,
        revokeOtherSessions: passwords.revokeOtherSessions,
        ...(unlock === "pin" ? { newPin: passwords.newPin } : { newPassword: passwords.newPassword })
      });
      setPasswords({ currentPassword: "", newPassword: "", newPin: "", revokeOtherSessions: true });
      toast({ title: unlock === "pin" ? "PIN изменён" : "Пароль изменён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось изменить пароль или PIN", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onAvatar(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      await uploadAvatar.mutateAsync(file);
      setAvatarBust(Date.now());
      toast({ title: "Аватар обновлён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось загрузить аватар", description: describeAuthError(error), tone: "danger" });
    }
  }

  function confirmRevoke(): void {
    const session = pendingSession;
    if (!session) return;
    setPendingSession(null);
    revokeSession.mutate(session.id, {
      onSuccess: () => toast({ title: "Устройство отключено", tone: "success" }),
      onError: (error) => toast({ title: "Не удалось завершить сессию", description: describeAuthError(error), tone: "danger" })
    });
  }

  function confirmLogoutAllSessions(): void {
    setConfirmLogoutAll(false);
    logoutAll.mutate(undefined, {
      onSuccess: () => toast({ title: "Все сессии завершены", description: "Потребуется войти заново.", tone: "default" }),
      onError: (error) => toast({ title: "Не удалось завершить сессии", description: describeAuthError(error), tone: "danger" })
    });
  }

  async function checkHealth(): Promise<void> {
    setHealthBusy(true);
    try {
      setHealth(await api.getHealth());
      setHealthError(null);
    } catch (error) {
      setHealth(null);
      setHealthError(describeAuthError(error));
    } finally {
      setHealthBusy(false);
    }
  }

  const saveButton = (keys: readonly PreferenceKey[], title: string): React.ReactElement => (
    <Button
      size="sm"
      disabled={!isDirty(keys)}
      status={updatePreferences.isPending ? "pending" : updatePreferences.isSuccess ? "success" : updatePreferences.isError ? "error" : "idle"}
      onClick={() => void savePreferences(keys, title)}
    >
      Сохранить
    </Button>
  );

  // A failed GET /settings/preferences (API down) leaves `form` null — say so
  // instead of showing a skeleton that never resolves.
  const preferencesError = (
    <EmptyState
      icon={AlertCircle}
      tone="danger"
      title="Не удалось загрузить предпочтения"
      description="Проверьте, что API запущен."
      action={
        <Button size="sm" variant="outline" onClick={() => void preferences.refetch()}>
          Повторить
        </Button>
      }
    />
  );

  return (
    <PanelShell>
      <PanelHeader icon={Settings} title="Настройки" subtitle="Профиль, модули, безопасность и внешний вид" />

      <PanelBody className="max-w-5xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <Select
            value={tab}
            onChange={(event) => setTab(event.target.value as Tab)}
            className="md:hidden"
            aria-label="Раздел настроек"
          >
            {TABS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <nav className="hidden w-48 shrink-0 flex-col gap-0.5 md:flex" aria-label="Разделы настроек">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setTab(item.value)}
                className={cx(
                  "rounded-lg px-3 py-row text-left text-label transition-colors",
                  tab === item.value
                    ? "bg-accent/15 text-foreground"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
        {tab === "profile" ? (
          <PanelSection title="Профиль">
            <Card className="space-y-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <AccountAvatar userId={user.id} name={profile.name || user.name} hasAvatar={user.hasAvatar} size={56} bust={avatarBust} />
                  <div className="flex flex-col gap-1">
                    <label className="cursor-pointer text-xs text-accent hover:underline">
                      Загрузить фото
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => void onAvatar(e.target.files?.[0])}
                      />
                    </label>
                    {user.hasAvatar ? (
                      <button
                        type="button"
                        className="text-left text-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          void deleteAvatar.mutateAsync().then(
                            () => {
                              setAvatarBust(Date.now());
                              toast({ title: "Аватар убран", tone: "default" });
                            },
                            (error: unknown) =>
                              toast({ title: "Не удалось убрать аватар", description: describeAuthError(error), tone: "danger" })
                          )
                        }
                      >
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Сейчас: <span className="text-foreground">{user?.name ?? "—"}</span>
                {user?.email ? (
                  <>
                    {" "}
                    · <span className="text-foreground">{user.email}</span>
                  </>
                ) : (
                  <> · без email</>
                )}
              </p>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
                <Field label="Имя"><Input required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
                <Field label="Email (необязательно)"><Input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></Field>
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    status={updateProfile.isPending ? "pending" : updateProfile.isSuccess ? "success" : updateProfile.isError ? "error" : "idle"}
                  >
                    Сохранить
                  </Button>
                </div>
              </form>
            </Card>
          </PanelSection>
        ) : null}

        {tab === "security" ? (
          <>
            <PanelSection title="Смена пароля или PIN">
              <Card>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={savePassword}>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button type="button" size="sm" variant={unlock === "password" ? "primary" : "outline"} onClick={() => setUnlock("password")}>
                      Пароль
                    </Button>
                    <Button type="button" size="sm" variant={unlock === "pin" ? "primary" : "outline"} onClick={() => setUnlock("pin")}>
                      PIN
                    </Button>
                  </div>
                  <Field label="Текущий пароль или PIN"><Input type="password" required autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} /></Field>
                  {unlock === "pin" ? (
                    <Field label="Новый PIN (4 цифры)">
                      <Input
                        inputMode="numeric"
                        required
                        maxLength={4}
                        value={passwords.newPin}
                        onChange={(e) => setPasswords({ ...passwords, newPin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      />
                    </Field>
                  ) : (
                    <Field label="Новый пароль"><Input type="password" required minLength={8} autoComplete="new-password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} /></Field>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                    <input type="checkbox" checked={passwords.revokeOtherSessions} onChange={(e) => setPasswords({ ...passwords, revokeOtherSessions: e.target.checked })} /> Завершить другие сессии
                  </label>
                  <div className="sm:col-span-2">
                    <Button
                      type="submit"
                      status={changePassword.isPending ? "pending" : changePassword.isSuccess ? "success" : changePassword.isError ? "error" : "idle"}
                    >
                      Сохранить вход
                    </Button>
                  </div>
                </form>
              </Card>
            </PanelSection>

            <PanelSection
              title="Устройства и сессии"
              actions={<Button size="sm" variant="outline" disabled={logoutAll.isPending} onClick={() => setConfirmLogoutAll(true)}><LogOut className="h-4 w-4" /> Выйти на всех устройствах</Button>}
            >
              {sessions.isLoading ? (
                <Skeleton className="h-24" />
              ) : sessions.data?.length ? (
                <div className="space-y-2">
                  {sessions.data.map((session) => (
                    <Card key={session.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span className="truncate">{session.deviceName ?? session.userAgent ?? "Устройство"}</span>
                          {session.current ? <Badge tone="accent">текущее устройство</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          {session.ipAddress ?? "IP неизвестен"} · вход {shortDateTime(session.createdAt)} · активность {relativeTime(session.lastUsedAt)} · истекает {shortDateTime(session.expiresAt)}
                        </p>
                        {session.deviceName && session.userAgent ? <p className="mt-0.5 truncate text-2xs text-subtle-foreground" title={session.userAgent}>{session.userAgent}</p> : null}
                      </div>
                      {session.current ? null : (
                        <Button size="sm" variant="outline" disabled={revokeSession.isPending} onClick={() => setPendingSession(session)}>Завершить</Button>
                      )}
                    </Card>
                  ))}
                </div>
              ) : <Message>Активных сессий нет.</Message>}
            </PanelSection>
          </>
        ) : null}

        {tab === "notifications" ? (
          <PanelSection title="Уведомления" actions={saveButton(NOTIFICATION_KEYS, "Уведомления сохранены")}>
            {preferences.isError ? preferencesError : !form ? (
              <Skeleton className="h-40" />
            ) : (
              <Card className="space-y-3">
                <Toggle label="Уведомления на рабочем столе" checked={form.desktopNotifications} onChange={(desktopNotifications) => setForm({ ...form, desktopNotifications })} />
                <Toggle label="Напоминания о задачах" checked={form.taskReminders} onChange={(taskReminders) => setForm({ ...form, taskReminders })} />
                <Toggle label="Напоминания о событиях" checked={form.eventReminders} onChange={(eventReminders) => setForm({ ...form, eventReminders })} />
                <Toggle label="Предупреждения о финансах" checked={form.financeAlerts} onChange={(financeAlerts) => setForm({ ...form, financeAlerts })} />
                <Toggle label="Низкий остаток на складе" checked={form.inventoryAlerts} onChange={(inventoryAlerts) => setForm({ ...form, inventoryAlerts })} />
                <div className="grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
                  <Field label="Тихие часы — начало"><Input type="time" value={form.quietHoursStart ?? ""} onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value || null })} /></Field>
                  <Field label="Тихие часы — конец"><Input type="time" value={form.quietHoursEnd ?? ""} onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value || null })} /></Field>
                </div>
                <p className="text-2xs text-subtle-foreground">
                  Что делают переключатели: «Напоминания о задачах» и «о событиях» гасят серверные напоминания
                  (Telegram и ленту уведомлений) и нативные тосты в десктопе; «Предупреждения о финансах» — алерты о
                  превышении бюджета. Тихие часы действуют на всё, кроме ручной проверки «Напомнить сейчас».
                  Учитывается часовой пояс из поля «Часовой пояс» ниже; пустое поле — часовой пояс сервера.
                </p>
              </Card>
            )}
          </PanelSection>
        ) : null}

        {tab === "modules" ? (
          <PanelSection title="Модули пространства">
            <ModulesSettings />
          </PanelSection>
        ) : null}

        {tab === "plugins" ? (
          <PanelSection title="Плагины">
            <PluginsSettings />
          </PanelSection>
        ) : null}

        {tab === "workspace" ? (
          <PanelSection title="Рабочее пространство">
            <WorkspaceSettings />
          </PanelSection>
        ) : null}

        {tab === "spheres" ? (
          <PanelSection title="Сферы и избранное">
            <SpheresSettings />
          </PanelSection>
        ) : null}

        {tab === "members" ? (
          <PanelSection title="Участники пространства">
            <MembersSettings />
          </PanelSection>
        ) : null}

        {tab === "appearance" ? (
          <PanelSection title="Внешний вид" actions={saveButton(APPEARANCE_KEYS, "Внешний вид сохранён")}>
            {preferences.isError ? preferencesError : !form ? (
              <Skeleton className="h-56" />
            ) : (
              <Card className="space-y-4">
                <p className="text-2xs text-subtle-foreground">
                  Акцент и плотность применяются сразу ко всему приложению. Тема пока одна — тёмная (окно докинга
                  работает на тёмной теме dockview), поэтому переключателя темы здесь нет; поле в профиле сохраняется
                  на будущее.
                </p>
                <Field label="Акцент">
                  <SegmentedControl<UserPreference["accent"]>
                    value={form.accent}
                    onChange={(accent) => setForm({ ...form, accent })}
                    options={ACCENT_OPTIONS}
                  />
                </Field>
                <Field label="Плотность">
                  <SegmentedControl<UserPreference["density"]> value={form.density} onChange={(density) => setForm({ ...form, density })} options={[{ value: "compact", label: "Компактная" }, { value: "comfortable", label: "Свободная" }]} />
                </Field>
                <Field label="Фон">
                  <SegmentedControl<UserPreference["backgroundStyle"]>
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
                </Field>
                {form.backgroundStyle !== "none" ? (
                  <Field label="Сила фона">
                    <SegmentedControl<UserPreference["backgroundIntensity"]>
                      value={form.backgroundIntensity}
                      onChange={(backgroundIntensity) => setForm({ ...form, backgroundIntensity })}
                      options={[
                        { value: "low", label: "Слабая" },
                        { value: "medium", label: "Средняя" },
                        { value: "high", label: "Сильная" }
                      ]}
                    />
                  </Field>
                ) : null}
                {WEBGL_BACKGROUND_STYLES.has(form.backgroundStyle) ? (
                  <BackgroundEffectSettingsForm
                    variant={form.backgroundStyle as UserPreference["backgroundStyle"] & keyof UserPreference["backgroundEffectSettings"]}
                    settings={form.backgroundEffectSettings}
                    accentHex={ACCENT_HEX[form.accent]}
                    onChange={(backgroundEffectSettings) => setForm({ ...form, backgroundEffectSettings })}
                  />
                ) : null}
                <Field label="Поверхности">
                  <SegmentedControl<UserPreference["surfaceStyle"]>
                    value={form.surfaceStyle}
                    onChange={(surfaceStyle) => setForm({ ...form, surfaceStyle })}
                    options={[
                      { value: "solid", label: "Сплошные" },
                      { value: "glass", label: "Стекло" }
                    ]}
                  />
                </Field>
                {form.backgroundStyle !== "none" && form.surfaceStyle === "solid" ? (
                  <p className="text-2xs text-warning">
                    Фон виден только сквозь прозрачные поверхности — включите «Стекло» выше, иначе он будет скрыт.
                  </p>
                ) : null}
                {form.surfaceStyle === "glass" ? (
                  <div className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3">
                    <Field label={`Прозрачность панелей: ${Math.round(form.panelOpacity * 100)}%`}>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={form.panelOpacity}
                        onChange={(e) => setForm({ ...form, panelOpacity: Number(e.target.value) })}
                        className="w-full accent-accent"
                      />
                    </Field>
                    <Field label={`Сила блюра: ${form.panelBlur}px`}>
                      <input
                        type="range"
                        min={0}
                        max={40}
                        step={1}
                        value={form.panelBlur}
                        onChange={(e) => setForm({ ...form, panelBlur: Number(e.target.value) })}
                        className="w-full accent-accent"
                      />
                    </Field>
                    <Field label="Цвет панелей">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.panelAccent ?? "#0d0d11"}
                          onChange={(e) => setForm({ ...form, panelAccent: e.target.value })}
                          className="h-9 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                        {form.panelAccent ? (
                          <button
                            type="button"
                            className="text-2xs text-accent hover:underline"
                            onClick={() => setForm({ ...form, panelAccent: null })}
                          >
                            Нейтральный
                          </button>
                        ) : (
                          <span className="text-2xs text-subtle-foreground">Нейтральный</span>
                        )}
                      </div>
                    </Field>
                  </div>
                ) : null}
                <Field label="Курсор-цель">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.targetCursorEnabled}
                      onChange={(targetCursorEnabled) => setForm({ ...form, targetCursorEnabled })}
                    />
                    <span className="text-xs text-muted-foreground">Рамка вокруг курсора, сужается на кнопках и ссылках</span>
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Часовой пояс"><Input placeholder="Europe/Moscow" value={form.timeZone ?? ""} onChange={(e) => setForm({ ...form, timeZone: e.target.value.trim() || null })} /></Field>
                  <Field label="Начало недели">
                    <Select className="w-full" value={form.weekStartsOn} onChange={(e) => setForm({ ...form, weekStartsOn: Number(e.target.value) })}>
                      <option value={0}>С воскресенья</option>
                      <option value={1}>С понедельника</option>
                    </Select>
                  </Field>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Виджеты дашборда — только просмотр, набор меняет сам дашборд.</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.dashboardWidgets.length > 0 ? (
                      form.dashboardWidgets.map((widget) => <Badge key={widget}>{widget}</Badge>)
                    ) : (
                      <span className="text-xs text-subtle-foreground">Пока пусто</span>
                    )}
                  </div>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">Подсказка первого запуска на дашборде «Сегодня».</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={updatePreferences.isPending}
                    onClick={() =>
                      updatePreferences.mutate(
                        { onboardingCompletedAt: form.onboardingCompletedAt ? null : new Date().toISOString() },
                        {
                          onSuccess: () =>
                            toast({
                              title: form.onboardingCompletedAt ? "Подсказка снова на дашборде" : "Подсказка скрыта",
                              tone: "success"
                            })
                        }
                      )
                    }
                  >
                    {form.onboardingCompletedAt ? "Показать подсказку снова" : "Скрыть подсказку"}
                  </Button>
                </div>
              </Card>
            )}
          </PanelSection>
        ) : null}

        {tab === "about" ? (
          <>
            <PanelSection title="Приложение">
              <Card>
                {appInfo.isLoading ? (
                  <Skeleton className="h-28" />
                ) : appInfo.data ? (
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <Row label="Название" value={appInfo.data.name} />
                    <Row label="Версия" value={appInfo.data.version} />
                    <Row label="Версия API" value={appInfo.data.apiVersion} />
                    <Row label="Окружение" value={appInfo.data.environment} />
                    <Row className="sm:col-span-2" label="Манифест обновлений" value={appInfo.data.updateManifestUrl ?? "не задан"} />
                  </dl>
                ) : (
                  <EmptyState
                    icon={AlertCircle}
                    tone="danger"
                    title="Не удалось получить сведения о приложении"
                    action={
                      <Button size="sm" variant="outline" onClick={() => void appInfo.refetch()}>
                        Повторить
                      </Button>
                    }
                  />
                )}
              </Card>
            </PanelSection>

            <PanelSection title="Состояние API" actions={<Button size="sm" variant="outline" disabled={healthBusy} onClick={() => void checkHealth()}>Проверить</Button>}>
              <Card>
                {health ? (
                  <p className="text-sm text-muted-foreground">
                    API: <span className="text-foreground">{health.status}</span>, база: <span className="text-foreground">{health.database}</span>, время: <span className="text-foreground">{shortDateTime(health.timestamp)}</span>
                  </p>
                ) : healthError ? (
                  <p className="text-sm text-destructive">{healthError}</p>
                ) : <p className="text-sm text-muted-foreground">Нажмите «Проверить», чтобы узнать состояние API.</p>}
              </Card>
            </PanelSection>
          </>
        ) : null}
          </div>
        </div>
      </PanelBody>

      <ConfirmDialog
        open={pendingSession !== null}
        title="Завершить сессию?"
        description={pendingSession ? `${pendingSession.deviceName ?? pendingSession.userAgent ?? "Это устройство"} — потребуется войти заново.` : undefined}
        confirmLabel="Завершить"
        onConfirm={confirmRevoke}
        onCancel={() => setPendingSession(null)}
      />
      <ConfirmDialog
        open={confirmLogoutAll}
        title="Выйти на всех устройствах?"
        description="Все сессии, включая текущую, будут завершены. Потребуется войти заново."
        confirmLabel="Выйти везде"
        onConfirm={confirmLogoutAllSessions}
        onCancel={() => setConfirmLogoutAll(false)}
      />
    </PanelShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  // `<label>` is inline by default — without `flex` here, `space-y-1` has no
  // block context to work with, and sibling Fields can end up sharing a
  // line instead of stacking (visible once the accent picker grew wider).
  return (
    <label className="flex flex-col items-start gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-foreground">
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }): React.ReactElement {
  return <div className={className}><dt className="text-2xs text-subtle-foreground">{label}</dt><dd className="break-all text-sm text-foreground">{value}</dd></div>;
}

function Message({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Card className="text-sm text-muted-foreground">{children}</Card>;
}
