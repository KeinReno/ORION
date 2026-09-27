export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function accountAvatarUrl(userId: string, bust?: number): string {
  const query = bust != null ? `?t=${bust}` : "";
  return `${API_BASE_URL}/auth/accounts/${userId}/avatar${query}`;
}
