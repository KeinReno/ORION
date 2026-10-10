"use client";

import { useDocumentBlob } from "@orion/core-react";
import type { DocumentItem } from "@orion/shared-types";
import { cx } from "@orion/ui";
import { useEffect, useState } from "react";
import { documentIcon } from "../../lib/document-icons";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/**
 * Grid-card visual: a real `<img>` for images (reusing `useDocumentBlob`, the
 * same cached-forever query `PreviewPane` uses — opening the tile view after
 * the preview pane already showed a file costs nothing extra), the type icon
 * for everything else. Not lazy beyond react-query's own cache: a folder is
 * one screenful of files, not an infinite feed, so fetching every visible
 * image's bytes up front is the same cost the browser would pay for `<img
 * src>` thumbnails anyway.
 */
export function DocThumbnail({ doc, isImage }: { doc: DocumentItem; isImage: boolean }): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const { data: blob } = useDocumentBlob(isImage ? workspace?.id : undefined, isImage ? doc.id : undefined);
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

  if (url) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }

  const Icon = documentIcon(doc);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Icon className={cx("h-8 w-8", doc.kind === "folder" ? "text-accent-text" : "text-muted-foreground")} />
    </div>
  );
}
