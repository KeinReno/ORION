"use client";

import type { ContactKind } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { Building2 } from "lucide-react";
import { avatarStyle, contactInitials } from "../../lib/contacts";

const SIZE_CLASS = {
  sm: "h-7 w-7 text-2xs",
  md: "h-9 w-9 text-label",
  lg: "h-14 w-14 text-title"
} as const;

/** Round avatar: initials (or a building for an organisation) on a colour derived from the name. */
export function ContactAvatar({
  name,
  kind = "person",
  size = "md",
  className
}: {
  name: string;
  kind?: ContactKind;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}): React.ReactElement {
  return (
    <span
      aria-hidden
      style={avatarStyle(name)}
      className={cx("flex shrink-0 select-none items-center justify-center border font-medium", kind === "organization" ? "rounded-xl" : "rounded-full", SIZE_CLASS[size], className)}
    >
      {kind === "organization" ? <Building2 className={size === "lg" ? "h-6 w-6" : size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} /> : contactInitials(name)}
    </span>
  );
}
