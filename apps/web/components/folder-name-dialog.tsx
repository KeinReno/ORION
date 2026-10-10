"use client";

import { SIDEBAR_FOLDER_NAME_MAX } from "@orion/shared-types";
import { Button, Input, Modal } from "@orion/ui";
import { useState, type FormEvent } from "react";
import { cleanFolderName } from "../lib/sidebar-folders";

/** Asks for a folder name — used to create a folder and to rename one. */
export function FolderNameDialog({
  open,
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose
}: {
  open: boolean;
  title: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      {/* Remounted per opening so the field always starts from `initial`. */}
      {open ? <NameForm key={initial} initial={initial} submitLabel={submitLabel} onSubmit={onSubmit} onClose={onClose} /> : null}
    </Modal>
  );
}

function NameForm({
  initial,
  submitLabel,
  onSubmit,
  onClose
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial);
  const clean = cleanFolderName(name);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (clean) onSubmit(clean);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={SIDEBAR_FOLDER_NAME_MAX}
        placeholder="Название папки"
        aria-label="Название папки"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={!clean}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
