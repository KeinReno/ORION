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
import { PLUGIN_CATALOG, type SessionInfo, type UpdateUserPreferenceInput, type UserPreference } from "@orion/shared-types";
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
  SaveGlyph,
  Skeleton,
  Switch,
  cx,
  useToast
} from "@orion/ui";
import { AlertCircle, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { describeAuthError } from "../lib/error-message";
import { relativeTime, shortDateTime } from "../lib/format";
import { AccountAvatar } from "../components/account-avatar";
import { ThemeSettings } from "./settings/theme-library";
import { ComponentsDiagnostics } from "./settings/components-section";
import { ModulesSettings } from "./settings/modules-section";
import { UpdatesSettings } from "./settings/updates-section";
import { ExtensionsSettings } from "./settings/extensions-section";
import { PluginsSettings } from "./settings/plugins-section";
import { AgentsSettings } from "./settings/agents-section";
import { MembersSettings } from "./settings/members-section";
import { NetworkSettings } from "./settings/network-section";
import { WorkspaceSettings } from "./settings/workspace-section";
import { SpheresSettings } from "./settings/spheres-section";
import { SettingsNav, type ExtensionSettingsTab } from "./settings/settings-nav";
import { PlaceBoundary, useEnabledPlaces } from "../lib/extensions/places-host";
import { placeKey } from "../lib/extensions/places";
import { RegionSettings } from "./settings/region-section";
import { AppearanceSettings, NotificationSettings } from "./settings/preference-sections";
import { SaveBar, SettingGroup, SettingRow } from "./settings/setting-row";
import { sectionTabTitle, useSectionView } from "../components/section-tabs";
import type { PanelComponentProps } from "../lib/panel-registry";
import { useSettingsRequest } from "../lib/panel-bus";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { SETTINGS_TABS, isSettingsTab, settingsScopeText, settingsTabInfo, type SettingsSearchHit, type SettingsTab } from "../lib/settings-catalog";

type PreferenceKey = keyof UserPreference;

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
  "sidebarPosition",
  "openTabsMode",
  "backgroundStyle",
  "backgroundIntensity",
  "backgroundEffectSettings",
  "targetCursorEnabled",
  "showNoteIds",
  "surfaceStyle",
  "panelOpacity",
  "panelBlur",
  "panelAccent",
  "motionLevel"
];
const REGION_KEYS: readonly PreferenceKey[] = ["timeZone", "weekStartsOn"];
/** Tabs whose fields come from the preferences form: a jump to one of their parameters waits for it. */
const FORM_TABS = new Set<string>(["notifications", "appearance", "region"]);
/** The brief ring around a parameter reached from search. */
const FLASH_CLASSES = ["rounded-lg", "ring-2", "ring-accent/60", "ring-offset-4", "ring-offset-background"];

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

/**
 * Replaces the Save button on tabs that apply changes at once: «Применяется сразу» at rest, a
 * turning ring while a change is being written, a drawn check for a moment once it landed, and an
 * explicit failure that stays until the next successful write.
 */
function LiveSaveHint({ pending, failed }: { pending: boolean; failed: boolean }): React.ReactElement {
  const [justSaved, setJustSaved] = useState(false);
  const wasPending = useRef(pending);
  useEffect(() => {
    if (wasPending.current && !pending && !failed) {
      setJustSaved(true);
      const timer = setTimeout(() => setJustSaved(false), 1800);
      wasPending.current = pending;
      return () => clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending, failed]);
  const state = pending ? "saving" : failed ? "error" : justSaved ? "saved" : null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-2xs", failed && !pending ? "text-destructive" : "text-subtle-foreground")} aria-live="polite">
      {state ? <SaveGlyph state={state} /> : null}
      {pending ? "Сохраняю…" : failed ? "Не сохранено" : justSaved ? "Сохранено" : "Применяется сразу"}
    </span>
  );
}

export function SettingsPanel({ params, api: panelApi }: PanelComponentProps = {}): React.ReactElement {
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

  const { workspace } = useActiveWorkspace();

  const [tabState, setTab] = useState<SettingsTab | ExtensionSettingsTab["value"]>("profile");
  // Sections that enabled plugins and extensions add (ADR-0022), as tabs `ext:<pluginId>.<id>`.
  const extensionSections = useEnabledPlaces("settings");
  const extensionTabs = extensionSections.map((place): ExtensionSettingsTab => ({ value: `ext:${placeKey(place)}`, label: place.label }));
  const extensionSection = extensionSections.find((place) => `ext:${placeKey(place)}` === tabState);
  const section = useSectionView(params, panelApi, "Настройки", SETTINGS_TABS);
  // Locked to a tab that no longer exists: "" matches no branch below, only the explanation is shown.
  const tab: SettingsTab | ExtensionSettingsTab["value"] | "" = section.locked ? (section.view ?? "") : tabState;
  const tabInfo = settingsTabInfo(tab);
  const scopeText = tabInfo ? settingsScopeText(tabInfo.scope, workspace?.name) : null;

  // «Open settings at this parameter» (avatar, module sheet, palette, the search here): switch the
  // tab, then bring the parameter into view once it is rendered. A view locked to one tab ignores it.
  const contentRef = useRef<HTMLDivElement>(null);
  const [jump, setJump] = useState<{ anchor: string | null; at: number } | null>(null);
  const request = useSettingsRequest();
  useEffect(() => {
    if (!request || section.locked || !isSettingsTab(request.tab)) return;
    setTab(request.tab);
    setJump({ anchor: request.anchor, at: request.at });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  function pickSearchHit(hit: SettingsSearchHit): void {
    setTab(hit.tab);
    setJump({ anchor: hit.anchor, at: Date.now() });
  }
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
  // Appearance and notifications save themselves as you change them, so a response can arrive while
  // you are already on the next value (a slider mid-drag): a field you changed since the last seed
  // keeps your value, every other field takes the server's.
  const seededFrom = useRef<UserPreference | null>(null);
  useEffect(() => {
    const incoming = preferences.data;
    if (!incoming) return;
    const last = seededFrom.current;
    seededFrom.current = incoming;
    setForm((prev) => {
      if (!prev || !last) return incoming;
      const merged: Record<string, unknown> = { ...incoming };
      for (const key of Object.keys(incoming) as PreferenceKey[]) {
        if (prev[key] !== last[key]) merged[key] = prev[key];
      }
      return merged as unknown as UserPreference;
    });
  }, [preferences.data]);

  // Live apply: a short pause after the last change, then the changed fields are saved quietly
  // (no toast per click); only a failure is reported.
  useEffect(() => {
    if (!form || !preferences.data) return;
    const patch = diffPreferences(form, preferences.data, [...APPEARANCE_KEYS, ...NOTIFICATION_KEYS, ...REGION_KEYS]);
    if (Object.keys(patch).length === 0) return;
    const timer = setTimeout(() => {
      updatePreferences.mutate(patch, {
        onError: (error) => toast({ title: "Не удалось сохранить настройки", description: describeAuthError(error), tone: "danger" })
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, preferences.data]);

  // The jump lands once the target is rendered: tabs fed by the preferences form wait for it; a
  // parameter without its own anchor (or one this tab no longer has) lands on the top of the tab.
  const formReady = form !== null;
  useEffect(() => {
    if (!jump || (FORM_TABS.has(tab) && !formReady)) return;
    const frame = requestAnimationFrame(() => {
      const root = contentRef.current;
      if (!root) return;
      const target = jump.anchor ? root.querySelector<HTMLElement>(`[data-setting="${jump.anchor}"]`) : null;
      if (!target) {
        root.scrollIntoView({ block: "start" });
      } else {
        target.scrollIntoView({ block: "center" });
        target.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button")?.focus({ preventScroll: true });
        target.classList.add(...FLASH_CLASSES);
        window.setTimeout(() => target.classList.remove(...FLASH_CLASSES), 1600);
      }
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, tab, formReady]);

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name, email: user.email ?? "" });
      setUnlock(user.unlockKind);
    }
  }, [user]);

  const profileChanges = {
    name: Boolean(user) && profile.name.trim() !== user?.name,
    email: Boolean(user) && profile.email.trim() !== (user?.email ?? "")
  };

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
      <PanelHeader
        icon={Settings}
        title="Настройки"
        subtitle={section.locked ? sectionTabTitle(tabInfo) : "Учётная запись, пространство и этот компьютер"}
      />

      <PanelBody measure="settings" className="[container-type:inline-size]">
        <div className={cx("flex flex-col gap-6", !section.locked && "[@container(min-width:640px)]:flex-row [@container(min-width:640px)]:items-start")}>
          {!section.locked ? (
            <SettingsNav value={tab as SettingsTab} workspaceName={workspace?.name} extensionTabs={extensionTabs} onChange={setTab} onPick={pickSearchHit} />
          ) : null}
          <div ref={contentRef} className="min-w-0 flex-1 scroll-mt-4">
        {section.missing ? <p className="text-label text-muted-foreground">Этой вкладки больше нет. Данные сохранены.</p> : null}
        {scopeText ? <ScopeNote>{scopeText}</ScopeNote> : null}
        {extensionSection && workspace ? (
          <>
            <ScopeNote>Раздел добавлен расширением «{PLUGIN_CATALOG.find((item) => item.id === extensionSection.pluginId)?.label ?? extensionSection.pluginId}»; кого затрагивают его параметры, решает оно само.</ScopeNote>
            <PanelSection title={extensionSection.label}>
              <PlaceBoundary pluginId={extensionSection.pluginId}>
                <extensionSection.component workspaceId={workspace.id} />
              </PlaceBoundary>
            </PanelSection>
          </>
        ) : null}
        {tab === "profile" ? (
          <PanelSection title="Профиль">
            <form id="settings-profile-form" onSubmit={saveProfile}>
              <SettingGroup title="Личные данные" description="Общие для всех ваших пространств.">
                {user ? (
                  <SettingRow anchor="avatar" label="Фото" description="JPEG, PNG, WebP или GIF — видно участникам ваших пространств.">
                    <div className="flex items-center gap-3">
                      <AccountAvatar userId={user.id} name={profile.name || user.name} hasAvatar={user.hasAvatar} size={48} bust={avatarBust} />
                      <div className="flex flex-col gap-1">
                        <label className="cursor-pointer text-xs text-accent-text hover:underline">
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
                  </SettingRow>
                ) : null}
                <SettingRow anchor="name" label="Имя" changed={profileChanges.name}>
                  <Input aria-label="Имя" required className="w-64 max-w-full" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                </SettingRow>
                <SettingRow
                  anchor="email"
                  label="Email"
                  description="Необязательно. По нему принимаются приглашения в общие пространства."
                  changed={profileChanges.email}
                >
                  <Input aria-label="Email" type="email" className="w-64 max-w-full" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
                </SettingRow>
              </SettingGroup>
              <SaveBar
                form="settings-profile-form"
                changedCount={Number(profileChanges.name) + Number(profileChanges.email)}
                pending={updateProfile.isPending}
                onReset={() => setProfile({ name: user?.name ?? "", email: user?.email ?? "" })}
              />
            </form>
          </PanelSection>
        ) : null}

        {tab === "security" ? (
          <PanelSection title="Безопасность">
            <div className="space-y-5">
              <form data-setting="password" onSubmit={savePassword}>
                <SettingGroup title="Вход" description="Чем вы входите в ORION на этом и других устройствах.">
                  <SettingRow label="Способ входа" description={unlock === "pin" ? "PIN из 4 цифр — для домашнего компьютера." : "Пароль не короче 8 символов."}>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant={unlock === "password" ? "primary" : "outline"} onClick={() => setUnlock("password")}>
                        Пароль
                      </Button>
                      <Button type="button" size="sm" variant={unlock === "pin" ? "primary" : "outline"} onClick={() => setUnlock("pin")}>
                        PIN
                      </Button>
                    </div>
                  </SettingRow>
                  <SettingRow label="Текущий пароль или PIN">
                    <Input
                      aria-label="Текущий пароль или PIN"
                      type="password"
                      required
                      autoComplete="current-password"
                      className="w-56 max-w-full"
                      value={passwords.currentPassword}
                      onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                    />
                  </SettingRow>
                  <SettingRow label={unlock === "pin" ? "Новый PIN" : "Новый пароль"}>
                    {unlock === "pin" ? (
                      <Input
                        aria-label="Новый PIN (4 цифры)"
                        inputMode="numeric"
                        required
                        maxLength={4}
                        className="w-56 max-w-full"
                        value={passwords.newPin}
                        onChange={(e) => setPasswords({ ...passwords, newPin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                      />
                    ) : (
                      <Input
                        aria-label="Новый пароль"
                        type="password"
                        required
                        minLength={8}
                        autoComplete="new-password"
                        className="w-56 max-w-full"
                        value={passwords.newPassword}
                        onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                      />
                    )}
                  </SettingRow>
                  <SettingRow label="Выйти на других устройствах" description="После смены там потребуется войти заново.">
                    <Switch
                      label="Выйти на других устройствах"
                      checked={passwords.revokeOtherSessions}
                      onChange={(revokeOtherSessions) => setPasswords({ ...passwords, revokeOtherSessions })}
                    />
                  </SettingRow>
                  <div className="flex justify-end px-4 py-3">
                    <Button
                      type="submit"
                      status={changePassword.isPending ? "pending" : changePassword.isSuccess ? "success" : changePassword.isError ? "error" : "idle"}
                    >
                      Сохранить вход
                    </Button>
                  </div>
                </SettingGroup>
              </form>

              <div data-setting="sessions" className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-2 px-1">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Устройства и сессии</h3>
                    <p className="text-2xs text-subtle-foreground">Где сейчас выполнен вход в вашу учётную запись.</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={logoutAll.isPending} onClick={() => setConfirmLogoutAll(true)}>
                    <LogOut className="h-4 w-4" /> Выйти на всех устройствах
                  </Button>
                </div>
                {sessions.isLoading ? (
                  <Skeleton className="h-24" />
                ) : sessions.data?.length ? (
                  <div className="divide-y divide-border rounded-2xl border border-border bg-card">
                    {sessions.data.map((session) => (
                      <div key={session.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <span className="truncate">{session.deviceName ?? session.userAgent ?? "Устройство"}</span>
                            {session.current ? <Badge tone="accent">это устройство</Badge> : null}
                          </p>
                          <p className="mt-0.5 text-2xs text-muted-foreground">
                            {session.ipAddress ?? "IP неизвестен"} · вход {shortDateTime(session.createdAt)} · активность {relativeTime(session.lastUsedAt)} · истекает{" "}
                            {shortDateTime(session.expiresAt)}
                          </p>
                          {session.deviceName && session.userAgent ? (
                            <p className="mt-0.5 truncate text-2xs text-subtle-foreground" title={session.userAgent}>
                              {session.userAgent}
                            </p>
                          ) : null}
                        </div>
                        {session.current ? null : (
                          <Button size="sm" variant="outline" disabled={revokeSession.isPending} onClick={() => setPendingSession(session)}>
                            Завершить
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Message>Активных сессий нет.</Message>
                )}
              </div>
            </div>
          </PanelSection>
        ) : null}

        {tab === "notifications" ? (
          <PanelSection title="Уведомления" actions={<LiveSaveHint pending={updatePreferences.isPending} failed={updatePreferences.isError} />}>
            {preferences.isError ? preferencesError : !form ? <Skeleton className="h-40" /> : <NotificationSettings form={form} setForm={setForm} />}
          </PanelSection>
        ) : null}

        {tab === "modules" ? (
          <Anchored anchor="modules">
            <PanelSection title="Модули пространства">
              <ModulesSettings />
            </PanelSection>
          </Anchored>
        ) : null}

        {tab === "plugins" ? (
          <Anchored anchor="plugins">
            <PanelSection title="Плагины">
              <PluginsSettings />
            </PanelSection>
          </Anchored>
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

        {tab === "agents" ? (
          <PanelSection title="ИИ и агенты">
            <AgentsSettings />
          </PanelSection>
        ) : null}

        {tab === "network" ? (
          <PanelSection title="Сеть и устройства">
            <NetworkSettings />
          </PanelSection>
        ) : null}

        {tab === "extensions" ? (
          <PanelSection title="Расширения">
            <ExtensionsSettings />
          </PanelSection>
        ) : null}

        {tab === "updates" ? (
          <PanelSection title="Обновления">
            <UpdatesSettings />
          </PanelSection>
        ) : null}

        {tab === "appearance" ? (
          <PanelSection title="Внешний вид" actions={<LiveSaveHint pending={updatePreferences.isPending} failed={updatePreferences.isError} />}>
            {preferences.isError ? preferencesError : !form ? <Skeleton className="h-56" /> : <AppearanceSettings form={form} setForm={setForm} />}
          </PanelSection>
        ) : null}

        {tab === "themes" ? (
          <Anchored anchor="theme-library">
            <PanelSection title="Темы">
              <Card>
                <ThemeSettings />
              </Card>
            </PanelSection>
          </Anchored>
        ) : null}

        {tab === "region" ? (
          <PanelSection title="Дата и время" actions={<LiveSaveHint pending={updatePreferences.isPending} failed={updatePreferences.isError} />}>
            {preferences.isError ? preferencesError : !form ? (
              <Skeleton className="h-32" />
            ) : (
              <RegionSettings timeZone={form.timeZone} weekStartsOn={form.weekStartsOn} onChange={(patch) => setForm({ ...form, ...patch })} />
            )}
          </PanelSection>
        ) : null}

        {tab === "about" ? (
          <>
            <PanelSection title="Приложение">
              <Card data-setting="app-info">
                {appInfo.isLoading ? (
                  <Skeleton className="h-28" />
                ) : appInfo.data ? (
                  <dl className="grid gap-3 [@container(min-width:576px)]:grid-cols-2">
                    <Row label="Название" value={appInfo.data.name} />
                    <Row label="Версия" value={appInfo.data.version} />
                    <Row label="Версия API" value={appInfo.data.apiVersion} />
                    <Row label="Окружение" value={appInfo.data.environment} />
                    <Row className="[@container(min-width:576px)]:col-span-2" label="Манифест обновлений" value={appInfo.data.updateManifestUrl ?? "не задан"} />
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

            <PanelSection title="Знакомство с ORION">
              <Card data-setting="onboarding" className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Короткая подсказка «Как устроен день» на дашборде: захват, разбор инбокса, сегодняшние дела.
                </p>
                {form ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
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
                ) : null}
              </Card>
            </PanelSection>
          </>
        ) : null}

        {tab === "diagnostics" ? (
          <>
            <Anchored anchor="components">
              <PanelSection title="Компоненты">
                <ComponentsDiagnostics />
              </PanelSection>
            </Anchored>
            <Anchored anchor="api-health">
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
            </Anchored>
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

function Row({ label, value, className }: { label: string; value: string; className?: string }): React.ReactElement {
  return <div className={className}><dt className="text-2xs text-subtle-foreground">{label}</dt><dd className="break-all text-sm text-foreground">{value}</dd></div>;
}

function Message({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Card className="text-sm text-muted-foreground">{children}</Card>;
}

/** A whole section as one search target, for tabs rendered by their own component. */
function Anchored({ anchor, children }: { anchor: string; children: ReactNode }): React.ReactElement {
  return <div data-setting={anchor}>{children}</div>;
}

/** Who a change on this tab affects — shown above every tab that changes something. */
function ScopeNote({ children }: { children: ReactNode }): React.ReactElement {
  return <p className="mb-3 text-2xs text-subtle-foreground">{children}</p>;
}
