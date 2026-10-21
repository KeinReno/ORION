import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { sendFeedbackInputSchema, type FeedbackResult, type SendFeedbackInput } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { FeedbackService } from "./feedback.service";

/** Не workspace-scoped: обратная связь про приложение в целом, не про данные пространства. */
@UseGuards(JwtAuthGuard)
@Controller("feedback")
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  send(@Body(new ZodValidationPipe(sendFeedbackInputSchema)) body: SendFeedbackInput, @CurrentUser() user: RequestUser): Promise<FeedbackResult> {
    return this.feedback.send(body, { email: user.email });
  }
}
