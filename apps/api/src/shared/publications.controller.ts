import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { publicationRefreshSchema, createPublicationSchema, publicationSourceSchema, publicationStatusInputSchema, publicationDestinationSchema, type CreatePublication, type PublicationSource, type PublicationStatusInput } from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { RequestUser } from "../auth/jwt.strategy";
import { PublicationsService } from "./publications.service";

@UseGuards(JwtAuthGuard)
@Controller("publications")
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}
  @Post("preview")
  preview(@CurrentUser() u: RequestUser, @Body(new ZodValidationPipe(publicationSourceSchema)) body: PublicationSource) { return this.publications.preview(u.userId, body); }
  @Post()
  create(@CurrentUser() u: RequestUser, @Body(new ZodValidationPipe(createPublicationSchema)) body: CreatePublication) { return this.publications.create(u.userId, body); }
  @Get()
  list(@CurrentUser() u: RequestUser, @Query(new ZodValidationPipe(publicationDestinationSchema)) q: { workspaceId: string }) { return this.publications.list(u.userId, q.workspaceId); }
  @Get("issued")
  issued(@CurrentUser() u: RequestUser) { return this.publications.issued(u.userId); }
  @Get("pinned")
  pinned(@CurrentUser() u: RequestUser, @Query(new ZodValidationPipe(publicationDestinationSchema)) q: { workspaceId: string }) { return this.publications.pinned(u.userId, q.workspaceId); }
  @Get(":id/preview")
  refreshPreview(@CurrentUser() u: RequestUser, @Param("id") id: string) { return this.publications.refreshPreview(u.userId, id); }
  @Patch(":id")
  refresh(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationRefreshSchema)) body: { expectedRevision: number; fingerprint: string }) { return this.publications.refresh(u.userId, id, body); }
  @Get(":id")
  get(@CurrentUser() u: RequestUser, @Param("id") id: string) { return this.publications.get(u.userId, id); }
  @Patch(":id/status")
  status(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationStatusInputSchema)) body: PublicationStatusInput) { return this.publications.status(u.userId, id, body); }
  @Delete(":id")
  revoke(@CurrentUser() u: RequestUser, @Param("id") id: string) { return this.publications.revoke(u.userId, id); }
  @Post(":id/pin")
  pin(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationDestinationSchema)) body: { workspaceId: string }) { return this.publications.pin(u.userId, id, body.workspaceId); }
  @Delete(":id/pin")
  unpin(@CurrentUser() u: RequestUser, @Param("id") id: string, @Query(new ZodValidationPipe(publicationDestinationSchema)) q: { workspaceId: string }) { return this.publications.unpin(u.userId, id, q.workspaceId); }
  @Post(":id/copy")
  copy(@CurrentUser() u: RequestUser, @Param("id") id: string, @Body(new ZodValidationPipe(publicationDestinationSchema)) body: { workspaceId: string }) { return this.publications.copy(u.userId, id, body.workspaceId); }
}
