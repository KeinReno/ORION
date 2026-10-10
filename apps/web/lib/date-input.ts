/** `YYYY-MM-DD` of an instant in the viewer's local day — the value of an `<input type="date">`. */
export function toDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD` value, as an ISO instant. */
export function fromDateInput(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}
