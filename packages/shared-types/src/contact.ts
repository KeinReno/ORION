import { z } from "zod";

/**
 * Module «Контакты» — a person or organisation as a universal record
 * (PRODUCT_DIRECTION.md: «Контакты — универсальная сущность; клиентская
 * воронка, сделки и CRM-поля — расширение»). It is the same `contacts` table
 * the «Дом» module uses for a home's contacts: `homeId` is optional, a home
 * still shows and edits the contacts attached to it through its own API, and
 * deleting a home only drops the link (SET NULL) — the contact stays.
 *
 * Named `ContactCard` to stay distinct from «Дом»'s home-scoped `Contact` DTO.
 * Links and reminders come from the shared entity-link layer (type "contact").
 */
export const contactCardSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  homeId: z.string().nullable(),
  name: z.string(),
  /** Who they are to you: «сантехник», «бухгалтер», «клиент». */
  role: z.string(),
  phone: z.string(),
  email: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ContactCard = z.infer<typeof contactCardSchema>;

const emailField = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || z.string().email().safeParse(value).success, "Введите корректный email");

export const createContactCardInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120),
  role: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  email: emailField.default(""),
  note: z.string().max(2_000).default(""),
  /** Attach to a home of the «Дом» module (must be in the same workspace). */
  homeId: z.string().nullable().optional()
});
export type CreateContactCardInput = z.infer<typeof createContactCardInputSchema>;

export const updateContactCardInputSchema = z.object({
  name: z.string().trim().min(1, "Имя обязательно").max(120).optional(),
  role: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  email: emailField.optional(),
  note: z.string().max(2_000).optional(),
  homeId: z.string().nullable().optional()
});
export type UpdateContactCardInput = z.infer<typeof updateContactCardInputSchema>;

/** Case-insensitive match over name, role, phone, email and note — the panel's client-side search. */
export function contactMatches(contact: Pick<ContactCard, "name" | "role" | "phone" | "email" | "note">, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("ru");
  if (!needle) return true;
  const digits = needle.replace(/\D/g, "");
  return (
    [contact.name, contact.role, contact.email, contact.note].some((field) => field.toLocaleLowerCase("ru").includes(needle)) ||
    (digits.length >= 3 && contact.phone.replace(/\D/g, "").includes(digits))
  );
}
