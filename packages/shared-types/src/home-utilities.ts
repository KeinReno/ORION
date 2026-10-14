import { z } from "zod";

export const utilityPeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Период должен быть в формате ГГГГ-ММ");

export const utilityChargeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  amountMinor: z.number().int().min(0).max(100_000_000),
  confirmed: z.boolean(),
  note: z.string().max(500)
}).strict();
export type UtilityCharge = z.infer<typeof utilityChargeSchema>;

export const putUtilityMonthInputSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
  rentMinor: z.number().int().min(0).max(100_000_000),
  rentConfirmed: z.boolean(),
  charges: z.array(utilityChargeSchema).max(100)
}).strict().refine((v) => new Set(v.charges.map((c) => c.id)).size === v.charges.length, "Строки с одинаковым ID");
export type PutUtilityMonthInput = z.infer<typeof putUtilityMonthInputSchema>;

export const utilityMonthSchema = putUtilityMonthInputSchema.innerType().omit({ expectedRevision: true }).extend({
  id: z.string().uuid(),
  revision: z.number().int().min(1),
  homeId: z.string(),
  period: utilityPeriodSchema,
  utilityMinor: z.number().int(),
  confirmedUtilityMinor: z.number().int(),
  grandTotalMinor: z.number().int(),
  confirmedTotalMinor: z.number().int(),
  importedUtilityMinor: z.number().int().nullable(),
  importedGrandTotalMinor: z.number().int().nullable(),
  paidMinor: z.number().int().nullable(),
  remainingMinor: z.number().int().nullable(),
  payments: z.array(z.object({
    id: z.string(), transactionId: z.string(), amountMinor: z.number().int().positive(),
    note: z.string(), occurredAt: z.string(), valid: z.boolean()
  })),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type UtilityMonth = z.infer<typeof utilityMonthSchema>;

export const importUtilityMonthsInputSchema = z.object({
  dryRun: z.boolean(),
  rows: z.array(z.object({
    period: utilityPeriodSchema,
    rentMinor: z.number().int().min(0).max(100_000_000),
    charges: z.array(utilityChargeSchema).max(100),
    importedUtilityMinor: z.number().int().min(0).max(100_000_000).nullable(),
    importedGrandTotalMinor: z.number().int().min(0).max(100_000_000).nullable()
  }).strict()).min(1).max(120)
}).strict().refine((v) => new Set(v.rows.map((row) => row.period)).size === v.rows.length, "Повторяющиеся месяцы в импорте");
export type ImportUtilityMonthsInput = z.infer<typeof importUtilityMonthsInputSchema>;

export const importUtilityMonthsResultSchema = z.object({
  dryRun: z.boolean(), imported: z.number().int(), skipped: z.number().int(),
  rows: z.array(z.object({ period: utilityPeriodSchema, exists: z.boolean(), utilityMinor: z.number().int(), grandTotalMinor: z.number().int(), utilityDifferenceMinor: z.number().int().nullable(), grandDifferenceMinor: z.number().int().nullable() }))
});
export type ImportUtilityMonthsResult = z.infer<typeof importUtilityMonthsResultSchema>;

export const putUtilityPaymentInputSchema = z.object({ transactionId: z.string().uuid(), amountMinor: z.number().int().positive().max(100_000_000) }).strict();
export type PutUtilityPaymentInput = z.infer<typeof putUtilityPaymentInputSchema>;

/** Draft amounts are visible for planning, but are never presented as confirmed bills. */
export function utilityTotals(input: PutUtilityMonthInput) {
  const utilityMinor = input.charges.reduce((sum, charge) => sum + charge.amountMinor, 0);
  const confirmedUtilityMinor = input.charges.reduce((sum, charge) => sum + (charge.confirmed ? charge.amountMinor : 0), 0);
  return {
    utilityMinor,
    confirmedUtilityMinor,
    grandTotalMinor: utilityMinor + input.rentMinor,
    confirmedTotalMinor: confirmedUtilityMinor + (input.rentConfirmed ? input.rentMinor : 0)
  };
}

export const electricityTariffInputSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату начала тарифа"),
  rateRub: z.string().regex(/^(0|[1-9]\d{0,5})(\.\d{1,4})?$/, "Тариф — рубли за кВт·ч, до 4 знаков после запятой").refine((v) => Number(v) > 0, "Тариф должен быть больше нуля"),
  note: z.string().max(500)
}).strict();
export type ElectricityTariffInput = z.infer<typeof electricityTariffInputSchema>;

export const electricityTariffSchema = electricityTariffInputSchema.extend({
  id: z.string(), meterId: z.string(), createdAt: z.string()
});
export type ElectricityTariff = z.infer<typeof electricityTariffSchema>;

/** Estimate only: a supplier's invoice may contain other fees or corrections. */
export function electricityEstimate(previous: number, next: number, rateRub: string): { consumption: number; amountMinor: number } | null {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || next < previous || previous < 0 || !electricityTariffInputSchema.shape.rateRub.safeParse(rateRub).success) return null;
  const usedMilli = Math.round(next * 1000) - Math.round(previous * 1000);
  const [rubles, fractional = ""] = rateRub.split(".");
  const rateUnits = BigInt(rubles) * 10000n + BigInt(fractional.padEnd(4, "0"));
  const minor = (BigInt(usedMilli) * rateUnits + 50_000n) / 100_000n;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { consumption: usedMilli / 1000, amountMinor: Number(minor) };
}
