/** Public projection for a proposed edit. current contains only editable preview fields.
 * This is a data contract, not a query interface or an authorization grant. */
export type EntityEditSnapshot = {
  title: string; current: Record<string, unknown>; revision: number | null;
  updatedAt: Date; readOnly: boolean;
};
