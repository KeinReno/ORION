"use client";

import { accountAvatarUrl } from "../lib/api-base";

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
  if (!hasAvatar) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-xl bg-accent/15 text-sm font-bold text-accent"
        style={{ width: size, height: size }}
      >
        {initial}
      </span>
    );
  }
  return (
    // Public local avatar — no auth header; cache-bust after upload.
    <img
      src={accountAvatarUrl(userId, bust)}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-xl object-cover"
      style={{ width: size, height: size }}
    />
  );
}
