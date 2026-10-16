/** Only registered project view IDs carry project context. Never derive IDs from labels. */
export function projectContextId(panelId: string | null): string | undefined {
  const match = /^(?:project|projectplan|projecttasks|projectaccess|projectmaterials):([^:]+)$/.exec(panelId ?? "");
  return match?.[1];
}

/** Device-local pins are personal navigation metadata, never a source of access rights. */
export function projectPinsKey(userId: string, workspaceId: string): string {
  return `orion.shell.v1.pins:${encodeURIComponent(userId)}:${encodeURIComponent(workspaceId)}`;
}

export function parseProjectPins(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return Array.isArray(value) && value.length <= 100 && value.every(id => typeof id === "string" && id.length > 0 && id.length <= 200)
      ? [...new Set(value)] as string[] : [];
  } catch { return []; }
}
