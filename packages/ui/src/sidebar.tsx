"use client";

import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { useState, type ComponentType, type ReactNode } from "react";

export interface SidebarLinkItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface SidebarLinkComponentProps {
  href: string;
  className?: string;
  children: ReactNode;
}

export interface SidebarProps {
  /** Registry of modules: each module contributes one entry here. */
  links: SidebarLinkItem[];
  activeHref?: string;
  footer?: ReactNode;
  /** Inject the host app's router link (e.g. next/link) for client-side nav. Defaults to a plain <a>. */
  LinkComponent?: ComponentType<SidebarLinkComponentProps>;
}

function DefaultLink({ href, className, children }: SidebarLinkComponentProps): React.ReactElement {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/**
 * Expand-on-hover navigation shell — part of the ORION base, not a module.
 * Modules register entries via `links`; they never touch this component.
 */
export function Sidebar({ links, activeHref, footer, LinkComponent = DefaultLink }: SidebarProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <motion.aside
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      animate={{ width: open ? 240 : 72 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex h-screen shrink-0 flex-col justify-between overflow-hidden border-r border-white/10 bg-neutral-950 px-3 py-4"
    >
      <nav className="flex flex-col gap-1">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = link.href === activeHref;
          return (
            <LinkComponent
              key={link.href}
              href={link.href}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    {link.label}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </LinkComponent>
          );
        })}
      </nav>
      {footer ? <div className="pt-4">{footer}</div> : null}
    </motion.aside>
  );
}
