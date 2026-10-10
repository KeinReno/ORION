"use client";

import { Sheet } from "@orion/ui";
import type { DocumentsHistorySlotProps } from "../../lib/extensions/contracts";
import { DocumentHistory } from "./document-history";

/** Plugin `documents-history`: the version list of one file in a side sheet, opened from the file's menu. */
export function DocumentHistorySheet({ workspaceId, doc, onClose }: DocumentsHistorySlotProps): React.ReactElement {
  return (
    <Sheet open={doc !== null} onClose={onClose} title={doc ? `История: ${doc.name}` : "История версий"} bare>
      {doc ? <DocumentHistory workspaceId={workspaceId} doc={doc} onRestored={onClose} /> : null}
    </Sheet>
  );
}
