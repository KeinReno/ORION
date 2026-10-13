"use client";

import type { Home, HomeOverview } from "@orion/shared-types";
import { Button, Card, Input } from "@orion/ui";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

/** What every block of the Home page receives. */
export interface HomeSectionProps {
  workspaceId: string | undefined;
  home: Home;
  overview: HomeOverview;
}

export function SectionCard({
  title,
  icon: Icon,
  summary,
  children
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Short status on the right of the title, e.g. «3 открыто». */
  summary?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-title text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </h2>
        {summary ? <span className="text-2xs text-subtle-foreground">{summary}</span> : null}
      </header>
      {children}
    </Card>
  );
}

/**
 * One line to add something: type, press Enter. `extra` sits beside the field (a due date, an
 * assignee). The line clears only when `onAdd` succeeds, so a failed add keeps what was typed.
 */
export function QuickAdd({
  placeholder,
  busy,
  onAdd,
  extra
}: {
  placeholder: string;
  busy?: boolean;
  onAdd: (text: string) => Promise<unknown>;
  extra?: React.ReactNode;
}): React.ReactElement {
  const [text, setText] = useState("");
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    try {
      await onAdd(value);
      setText("");
    } catch {
      /* the caller already told the user; keep the text */
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2">
      <div className="min-w-[10rem] flex-1">
        <Input value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </div>
      {extra}
      <Button type="submit" size="sm" disabled={busy || !text.trim()} aria-label="Добавить">
        <Plus className="h-4 w-4" />
      </Button>
    </form>
  );
}

export function EmptyLine({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="text-label text-subtle-foreground">{children}</p>;
}
