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
  placeholder = "Название папки",
  maxLength = SIDEBAR_FOLDER_NAME_MAX,
  clean: cleanName = cleanFolderName,
  onSubmit,
  onClose
}: {
  open: boolean;
  title: string;
  initial: string;
  submitLabel: string;
  placeholder?: string;
  maxLength?: number;
  clean?: (raw: string) => string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      {/* Remounted per opening so the field always starts from `initial`. */}
      {open ? <NameForm key={initial} initial={initial} submitLabel={submitLabel} placeholder={placeholder} maxLength={maxLength} clean={cleanName} onSubmit={onSubmit} onClose={onClose} /> : null}
    </Modal>
  );
}

function NameForm({
  initial,
  submitLabel,
  placeholder,
  maxLength,
  clean: cleanName,
  onSubmit,
  onClose
}: {
  initial: string;
  submitLabel: string;
  placeholder: string;
  maxLength: number;
  clean: (raw: string) => string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const [name, setName] = useState(initial);
  const clean = cleanName(name);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (clean) onSubmit(clean);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={placeholder}
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
