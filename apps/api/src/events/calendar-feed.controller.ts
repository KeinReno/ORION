import { Controller, Get, Header, NotFoundException, Param } from "@nestjs/common";
import { EventsService } from "./events.service";

/**
 * The read-only iCalendar feed. Deliberately NOT behind JwtAuthGuard — the
 * unguessable `:token` (Workspace.icsToken) is the whole credential, so a
 * calendar app can subscribe with just a URL. EventsService.feedByToken
 * runs `asSystem`, scoped to the one workspace the token resolves to.
 *
 * Route param is `:token.ics` so the URL ends in a real extension that
 * calendar apps and `webcal://` handlers recognise.
 */
@Controller("calendar")
export class CalendarFeedController {
  constructor(private readonly events: EventsService) {}

  @Get(":token.ics")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Cache-Control", "private, max-age=300")
  async feed(@Param("token") token: string): Promise<string> {
    const doc = await this.events.feedByToken(token);
    if (!doc) throw new NotFoundException("Календарь не найден");
    return doc.body;
  }
}
