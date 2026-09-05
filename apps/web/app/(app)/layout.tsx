"use client";

import { useLogout, useSession, useTasks } from "@orion/core-react";
import { Sidebar } from "@orion/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { moduleRegistry } from "../../lib/module-registry";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useDesktopDueReminders } from "../../lib/use-desktop-due-reminders";

function NextLink({ href, className, children }: { href: string; className?: string; children: ReactNode }): React.ReactElement {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export default function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useSession();
  const logout = useLogout();
  const { workspace } = useActiveWorkspace();
  const { data: tasks } = useTasks(workspace?.id);
  useDesktopDueReminders(tasks);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return <div className="flex h-screen items-center justify-center text-sm text-white/50">Загрузка…</div>;
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        links={moduleRegistry}
        activeHref={pathname}
        LinkComponent={NextLink}
        footer={
          <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
            <span className="truncate text-xs text-white/40">{user.email}</span>
            <button
              onClick={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}
              className="text-left text-xs text-white/50 hover:text-white"
            >
              Выйти
            </button>
          </div>
        }
      />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
