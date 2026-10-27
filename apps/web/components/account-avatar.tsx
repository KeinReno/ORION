"use client";

import { useAccountAvatarBlob } from "@orion/core-react";
import { useEffect, useState } from "react";

export function AccountAvatar({
  userId,
  name,
  hasAvatar,
  size = 36,
  bust
}: {
  userId: string;
  name: string;
  hasAvatar: boolean;
  size?: number;
  bust?: number;
}): React.ReactElement {
  const initial = (name.trim().slice(0, 1) || "?").toUpperCase();
  // Fetched as a blob, not a plain `<img src>` — the desktop build's CSP
  // (`img-src 'self' data: blob:`) blocks a direct cross-origin image
  // request to the API, which showed up as a broken-image icon instead of
  // the avatar. See `ApiClient.getAccountAvatarBlob`.
  const { data: blob, isError } = useAccountAvatarBlob(userId, hasAvatar, bust);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!hasAvatar || isError || !url) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-xl bg-accent/15 text-sm font-bold text-accent-text"
        style={{ width: size, height: size }}
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-xl object-cover"
      style={{ width: size, height: size }}
    />
  );
}
