import type { Prisma } from "@prisma/client";
import type { Event, EventScope, CreateEventInput, UpdateEventInput } from "@orion/shared-types";

/** Canonical calendar commands and recurrence behavior, without cron/feed registrations. */
export abstract class EventOperations {
  abstract list(userId: string, workspaceId: string, fromISO: string, toISO: string): Promise<Event[]>;
  abstract create(userId: string, workspaceId: string, input: CreateEventInput): Promise<Event>;
  abstract createTx(tx: Prisma.TransactionClient, workspaceId: string, input: CreateEventInput): Promise<{ id: string }>;
  abstract update(userId: string, workspaceId: string, id: string, input: UpdateEventInput, scope: EventScope, occurrenceStartISO?: string): Promise<Event>;
  abstract remove(userId: string, workspaceId: string, id: string, scope: EventScope, occurrenceStartISO?: string): Promise<void>;
}
