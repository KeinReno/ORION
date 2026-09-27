import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createEventInputSchema,
  eventScopeSchema,
  updateEventInputSchema,
  type CreateEventInput,
  type Event,
  type EventScope,
  type UpdateEventInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { EventsService } from "./events.service";

@RequireModule("calendar")
@Controller("workspaces/:workspaceId/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /** Windowed — `from` / `to` are required ISO instants (see EventsService.list). */
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("from") from: string,
    @Query("to") to: string
  ): Promise<Event[]> {
    return this.events.list(user.userId, workspaceId, from, to);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createEventInputSchema)) body: CreateEventInput
  ): Promise<Event> {
    return this.events.create(user.userId, workspaceId, body);
  }

  /**
   * `scope` (default `all`) and `occurrenceStart` steer edits to a recurring
   * event — see EventsService.update. `id` may be the synthetic
   * `<masterId>:<iso>` from the list, which carries `occurrenceStart` too.
   */
  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateEventInputSchema)) body: UpdateEventInput,
    @Query("scope") scope?: string,
    @Query("occurrenceStart") occurrenceStart?: string
  ): Promise<Event> {
    return this.events.update(user.userId, workspaceId, id, body, parseScope(scope), occurrenceStart);
  }

  @Delete(":id")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Query("scope") scope?: string,
    @Query("occurrenceStart") occurrenceStart?: string
  ): Promise<void> {
    return this.events.remove(user.userId, workspaceId, id, parseScope(scope), occurrenceStart);
  }
}

/** Unknown/absent scope falls back to `all` — it only matters for recurring events. */
function parseScope(value: string | undefined): EventScope {
  return eventScopeSchema.safeParse(value).success ? (value as EventScope) : "all";
}
