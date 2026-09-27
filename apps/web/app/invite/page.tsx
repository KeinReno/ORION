"use client";

import { useAcceptInvite, useInviteLookup, useSession } from "@orion/core-react";
import { ApiError } from "@orion/core";
import { AuroraBackground, Button, SpotlightCard } from "@orion/ui";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { describeAuthError } from "../../lib/error-message";

/**
 * Static `/invite?token=...` page (S22), not a dynamic `/invite/[token]`
 * segment — the desktop build is `output: "export"`, which requires every
 * dynamic route to be enumerable at build time via `generateStaticParams`,
 * and invite tokens are minted at runtime, so they can't be listed. This one
 * static route does the token lookup client-side after the page loads.
 *
 * `useSearchParams()` needs a `<Suspense>` boundary in the Next 14 app
 * router even for a page that's already a client component, or the export
 * build fails with "should be wrapped in a suspense boundary" — see the
 * outer `InviteAcceptPage` below.
 */
function InviteAcceptContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? undefined;
  const router = useRouter();
  const { user, isLoading: sessionLoading, status: sessionStatus, retry: retrySession } = useSession();
  const lookup = useInviteLookup(token);
  const accept = useAcceptInvite();

  const returnTo = token ? `/invite?token=${encodeURIComponent(token)}` : "/invite";

  async function onAccept(): Promise<void> {
    if (!token) return;
    try {
      await accept.mutateAsync(token);
    } catch {
      return;
    }
    router.replace("/spaces");
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <AuroraBackground />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
      <SpotlightCard className="w-full space-y-4">
        <h1 className="text-lg font-semibold">Приглашение в пространство</h1>

        {!token ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            В ссылке нет токена приглашения — проверьте, что она скопирована целиком.
          </p>
        ) : sessionLoading || lookup.isLoading ? (
          <p className="text-sm text-muted-foreground">Проверяем приглашение…</p>
        ) : sessionStatus === "unavailable" ? (
          <>
            <p className="text-sm text-muted-foreground">Не удаётся связаться с сервером — это не значит, что вы вышли из системы.</p>
            <Button className="w-full" variant="outline" onClick={retrySession}>
              Повторить
            </Button>
          </>
        ) : lookup.isError ? (
          lookup.error instanceof TypeError ? (
            <>
              <p className="text-sm text-muted-foreground">
                Не удалось связаться с сервером. Проверьте, что API запущен, и повторите.
              </p>
              <Button className="w-full" variant="outline" onClick={() => void lookup.refetch()}>
                Повторить
              </Button>
            </>
          ) : (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {lookup.error instanceof ApiError && lookup.error.status === 404
                ? "Приглашение не найдено — проверьте ссылку."
                : "Не удалось проверить приглашение."}
            </p>
          )
        ) : !lookup.data ? null : lookup.data.status === "used" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Приглашение уже принято.
          </p>
        ) : lookup.data.status === "revoked" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Приглашение отозвано — попросите отправить новое.
          </p>
        ) : lookup.data.status === "expired" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Приглашение больше не действует — попросите отправить новое.
          </p>
        ) : !user ? (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{lookup.data.inviterName}</span> приглашает вас в «
              <span className="text-foreground">{lookup.data.workspaceName}</span>» ({lookup.data.email}). Войдите
              или зарегистрируйтесь с этим email, чтобы принять приглашение.
            </p>
            <div className="flex gap-2">
              <a className="flex-1" href={`/login?next=${encodeURIComponent(returnTo)}`}>
                <Button className="w-full" variant="outline">Войти</Button>
              </a>
              <a className="flex-1" href={`/register?next=${encodeURIComponent(returnTo)}`}>
                <Button className="w-full">Зарегистрироваться</Button>
              </a>
            </div>
          </>
        ) : !user.email || user.email.toLowerCase() !== lookup.data.email.toLowerCase() ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Вы вошли как {user.name}
            {user.email ? ` (${user.email})` : " без email"}, а приглашение выписано на {lookup.data.email}.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{lookup.data.inviterName}</span> приглашает вас в «
              <span className="text-foreground">{lookup.data.workspaceName}</span>».
            </p>
            {accept.isError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {describeAuthError(accept.error)}
              </p>
            ) : null}
            <Button
              className="w-full"
              status={accept.isPending ? "pending" : accept.isSuccess ? "success" : accept.isError ? "error" : "idle"}
              onClick={() => void onAccept()}
            >
              Принять приглашение
            </Button>
          </>
        )}
      </SpotlightCard>
      </motion.div>
    </div>
  );
}

export default function InviteAcceptPage(): React.ReactElement {
  return (
    <Suspense
      fallback={
        <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
          <AuroraBackground />
        </div>
      }
    >
      <InviteAcceptContent />
    </Suspense>
  );
}
