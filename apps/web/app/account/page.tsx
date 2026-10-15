"use client";

import { KaidenLogo } from "../../components/kaiden-logo";

import {
  useChangePassword,
  useDeleteAvatar,
  useLogout,
  useSession,
  useUpdateProfile,
  useUploadAvatar
} from "@orion/core-react";
import { AuroraBackground, Button, Input, SpotlightCard, useToast } from "@orion/ui";
import { motion } from "framer-motion";
import { ArrowLeft, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AccountAvatar } from "../../components/account-avatar";
import { describeAuthError } from "../../lib/error-message";

export default function AccountPage(): React.ReactElement {
  const router = useRouter();
  const { user, isLoading, status } = useSession();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const uploadAvatar = useUploadAvatar();
  const deleteAvatar = useDeleteAvatar();
  const logout = useLogout();
  const { toast } = useToast();
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", newPin: "", revokeOtherSessions: true });
  const [unlock, setUnlock] = useState<"password" | "pin">("password");
  const [bust, setBust] = useState(0);

  useEffect(() => {
    // "unavailable" (API unreachable) is not "logged out" — don't bounce to
    // /login over a blip and lose whatever was being edited on this page.
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name, email: user.email ?? "" });
      setUnlock(user.unlockKind);
    }
  }, [user]);

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await updateProfile.mutateAsync({ name: profile.name.trim(), email: profile.email.trim() || null });
      toast({ title: "Профиль обновлён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось сохранить профиль", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function saveUnlock(event: FormEvent): Promise<void> {
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
      toast({ title: "Не удалось сменить пароль или PIN", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onAvatar(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      await uploadAvatar.mutateAsync(file);
      setBust(Date.now());
      toast({ title: "Аватар обновлён", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось загрузить аватар", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (status === "unavailable") {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Не удаётся связаться с сервером. Проверьте соединение — сохранённые изменения не потеряны.
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
    );
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <AuroraBackground />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <SpotlightCard className="w-full">
          <div className="mb-6 flex items-center gap-2.5">
            <KaidenLogo className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight text-foreground">ORION</span>
          </div>
          <h1 className="mb-1 text-lg font-semibold text-foreground">Учётная запись</h1>
          <p className="mb-6 text-sm text-muted-foreground">Имя, вход и аватар общие для всех ваших пространств.</p>

          <div className="mb-6 flex items-center gap-3">
            <AccountAvatar userId={user.id} name={profile.name || user.name} hasAvatar={user.hasAvatar} size={64} bust={bust} />
            <div className="flex flex-col gap-2">
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
                        setBust(Date.now());
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

          <form className="flex flex-col gap-3" onSubmit={saveProfile}>
            <label className="space-y-1 text-xs text-muted-foreground">
              Имя
              <Input required value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Email (необязательно)
              <Input
                type="email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              />
            </label>
            <Button type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Сохраняем…" : "Сохранить профиль"}
            </Button>
          </form>

          <form className="mt-6 flex flex-col gap-3 border-t border-border pt-6" onSubmit={saveUnlock}>
            <p className="text-sm font-medium text-foreground">Вход</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={unlock === "password" ? "primary" : "outline"} onClick={() => setUnlock("password")}>
                Пароль
              </Button>
              <Button type="button" size="sm" variant={unlock === "pin" ? "primary" : "outline"} onClick={() => setUnlock("pin")}>
                PIN
              </Button>
            </div>
            <label className="space-y-1 text-xs text-muted-foreground">
              Текущий пароль или PIN
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              />
            </label>
            {unlock === "pin" ? (
              <label className="space-y-1 text-xs text-muted-foreground">
                Новый PIN (4 цифры)
                <Input
                  inputMode="numeric"
                  required
                  maxLength={4}
                  value={passwords.newPin}
                  onChange={(e) => setPasswords({ ...passwords, newPin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                />
              </label>
            ) : (
              <label className="space-y-1 text-xs text-muted-foreground">
                Новый пароль
                <Input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={passwords.newPassword}
                  onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={passwords.revokeOtherSessions}
                onChange={(e) => setPasswords({ ...passwords, revokeOtherSessions: e.target.checked })}
              />
              Выйти на других устройствах
            </label>
            <Button type="submit" variant="outline" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Меняем…" : "Сохранить вход"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
            <a href="/spaces" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />
              К пространствам
            </a>
            <button
              type="button"
              onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Сменить учётку
            </button>
          </div>
        </SpotlightCard>
      </motion.div>
    </div>
  );
}
