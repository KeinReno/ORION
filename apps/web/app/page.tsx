"use client";

import { useSession } from "@orion/core-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function IndexPage(): React.ReactElement {
  const router = useRouter();
  const { user, isLoading } = useSession();

  useEffect(() => {
    if (isLoading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [isLoading, user, router]);

  return (
    <div className="flex h-screen items-center justify-center text-sm text-white/50">
      Загрузка…
    </div>
  );
}
