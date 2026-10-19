import { z } from "zod";

/** ADR-0020 (Orion Link): спаривание устройства с облачным ящиком пространства. */
export const pairLinkDeviceInputSchema = z.object({
  name: z.string().trim().min(1).max(80)
});
export type PairLinkDeviceInput = z.infer<typeof pairLinkDeviceInputSchema>;

/** Ответ спаривания. `key` (`K_ws`, base64) отдаётся один раз и нигде больше не хранится в открытом виде. */
export const linkPairingSchema = z.object({
  linkDeviceId: z.string(),
  workspaceId: z.string(),
  epoch: z.number().int(),
  keyId: z.string(),
  key: z.string()
});
export type LinkPairing = z.infer<typeof linkPairingSchema>;

export const linkDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyId: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable()
});
export type LinkDevice = z.infer<typeof linkDeviceSchema>;

/** Ротация ключа: `cutOffOld` стирает прежние ключи — устройства со старым ключом перестают быть читаемыми и должны быть спарены заново. */
export const rotateLinkKeyInputSchema = z.object({
  cutOffOld: z.boolean().default(false)
});
export type RotateLinkKeyInput = z.input<typeof rotateLinkKeyInputSchema>;

export const linkKeyInfoSchema = z.object({
  keyId: z.string(),
  epoch: z.number().int(),
  cutOffOld: z.boolean()
});
export type LinkKeyInfo = z.infer<typeof linkKeyInfoSchema>;
