import { Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface TaskClosure {
  workspaceId: string;
  taskId: string;
}

/** Synchronous bridge contract (ADR-0027). Caller authorizes the task change.
 * Handlers use the same transaction, retain RLS, and write only their own data.
 * Failure aborts the entire task command; an empty registry is a valid host. */
@Injectable()
export class TaskClosureRegistry {
  private readonly handlers = new Map<string, (tx: Prisma.TransactionClient, closure: TaskClosure) => Promise<void>>();

  register(owner: string, handler: (tx: Prisma.TransactionClient, closure: TaskClosure) => Promise<void>): void {
    if (this.handlers.has(owner)) throw new Error(`Duplicate task-closure owner: ${owner}`);
    this.handlers.set(owner, handler);
  }

  unregister(owner: string): void { this.handlers.delete(owner); }

  async closeTx(tx: Prisma.TransactionClient, closure: TaskClosure): Promise<void> {
    for (const handler of this.handlers.values()) await handler(tx, closure);
  }
}

/** Import the contract module, never the concrete TasksModule/TasksService. */
@Module({ providers: [TaskClosureRegistry], exports: [TaskClosureRegistry] })
export class TaskClosureRegistryModule {}
