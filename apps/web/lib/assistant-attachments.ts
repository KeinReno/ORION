import { ASSISTANT_IMAGE_TYPES, type AssistantAttachmentInput, type DocumentItem } from "@orion/shared-types";

/** The model reads images up to ~1568 px on the long side; larger photos only cost bandwidth. */
const MAX_SIDE = 1568;
/** base64 characters per picture; the whole message must stay under the API's 2 MB JSON limit. */
const MAX_IMAGE_CHARS = 1_400_000;
const MAX_TOTAL_IMAGE_CHARS = 1_700_000;
const EXCERPT_CHARS = 3000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A picture downsized to JPEG for the model, or null for a non-image (or one the browser cannot decode). */
export async function imageForModel(file: File): Promise<AssistantAttachmentInput["image"] | null> {
  if (!(ASSISTANT_IMAGE_TYPES as readonly string[]).includes(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.65, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) return null;
      const data = await blobToBase64(blob);
      if (data.length <= MAX_IMAGE_CHARS) return { mediaType: "image/jpeg", data };
    }
    return null;
  } catch {
    return null;
  }
}

/** One attached file as the chat sends it: the saved document, its text excerpt, and the picture while the budget lasts. */
export function attachmentFor(document: DocumentItem, image: AssistantAttachmentInput["image"] | null): AssistantAttachmentInput {
  return {
    documentId: document.id,
    name: document.name,
    mimeType: document.mimeType ?? "application/octet-stream",
    sizeBytes: document.sizeBytes ?? 0,
    excerpt: (document.extractedText ?? "").slice(0, EXCERPT_CHARS),
    ...(image ? { image } : {})
  };
}

/** Keeps pictures in order while their total fits the request; the rest go as text-only attachments. */
export function fitImages(attachments: AssistantAttachmentInput[]): AssistantAttachmentInput[] {
  let budget = MAX_TOTAL_IMAGE_CHARS;
  return attachments.map((item) => {
    if (!item.image) return item;
    if (item.image.data.length <= budget) {
      budget -= item.image.data.length;
      return item;
    }
    return { ...item, image: undefined };
  });
}
