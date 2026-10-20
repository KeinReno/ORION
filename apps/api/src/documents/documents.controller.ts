import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import {
  bulkDocumentInputSchema,
  createFolderInputSchema,
  documentViewSchema,
  updateDocumentInputSchema,
  type BulkDocumentInput,
  type CreateFolderInput,
  type DocumentItem,
  type DocumentVersion,
  type DocumentView,
  type UpdateDocumentInput
} from "@orion/shared-types";
import { CurrentUser } from "../common/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { fixMultipartFilename, MAX_UPLOAD_BYTES } from "../common/multipart";
import type { RequestUser } from "../auth/jwt.strategy";
import { RequireModule } from "../modules/require-module";
import { DocumentsService, type UploadedDocumentFile } from "./documents.service";

@RequireModule("documents")
@Controller("workspaces/:workspaceId/documents")
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Query("view") view?: string
  ): Promise<DocumentItem[]> {
    // Unknown/absent view falls back to "active" — a UI convenience, not a contract.
    const parsed: DocumentView = documentViewSchema.safeParse(view).success ? (view as DocumentView) : "active";
    return this.documents.list(user.userId, workspaceId, parsed);
  }

  @Post()
  createFolder(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createFolderInputSchema)) body: CreateFolderInput
  ): Promise<DocumentItem> {
    return this.documents.createFolder(user.userId, workspaceId, body);
  }

  /**
   * Multipart upload. The body is not JSON, so it can't go through
   * ZodValidationPipe — `parentId` is read from a form field and the files
   * from `files[]`. `FilesInterceptor` (from @nestjs/platform-express, which
   * bundles multer) keeps each file in memory up to MAX_UPLOAD_MB.
   */
  @Post("upload")
  @UseInterceptors(FilesInterceptor("files", 20, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @UploadedFiles() files: UploadedDocumentFile[],
    @Body("parentId") parentId?: string
  ): Promise<DocumentItem[]> {
    const decoded = (files ?? []).map((f) => ({ ...f, originalname: fixMultipartFilename(f.originalname) }));
    return this.documents.upload(user.userId, workspaceId, parentId && parentId.length > 0 ? parentId : null, decoded);
  }

  /** «Прикрепить к сообщению ассистента»: the files go to «Документы → Ассистент — входящие», the chat gets their ids. */
  @Post("assistant-inbox")
  @UseInterceptors(FilesInterceptor("files", 10, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadToAssistant(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @UploadedFiles() files: UploadedDocumentFile[]
  ): Promise<DocumentItem[]> {
    const decoded = (files ?? []).map((f) => ({ ...f, originalname: fixMultipartFilename(f.originalname) }));
    return this.documents.uploadToAssistantInbox(user.userId, workspaceId, decoded);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDocumentInputSchema)) body: UpdateDocumentInput
  ): Promise<DocumentItem> {
    return this.documents.update(user.userId, workspaceId, id, body);
  }

  @Post("bulk")
  bulk(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(bulkDocumentInputSchema)) body: BulkDocumentInput
  ): Promise<void> {
    return this.documents.bulk(user.userId, workspaceId, body);
  }

  /** Soft delete — node (and any subtree) goes to the trash. */
  @Delete(":id")
  remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string
  ): Promise<void> {
    return this.documents.remove(user.userId, workspaceId, id);
  }

  @Post(":id/restore")
  restore(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string
  ): Promise<DocumentItem> {
    return this.documents.restore(user.userId, workspaceId, id);
  }

  /** Irreversible hard delete from the trash. */
  @Delete(":id/purge")
  purge(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string
  ): Promise<void> {
    return this.documents.purge(user.userId, workspaceId, id);
  }

  /** Overwrites a file's content; the old content is archived as a version. Multipart, one `file` field. */
  @Post(":id/content")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  replaceContent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @UploadedFile() file: UploadedDocumentFile
  ): Promise<DocumentItem> {
    const decoded = { ...file, originalname: fixMultipartFilename(file.originalname) };
    return this.documents.replaceContent(user.userId, workspaceId, id, decoded);
  }

  @Get(":id/versions")
  listVersions(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string
  ): Promise<DocumentVersion[]> {
    return this.documents.listVersions(user.userId, workspaceId, id);
  }

  /** Streams a past version's bytes — same Range/disposition handling as `content`. */
  @Get(":id/versions/:versionId/content")
  async versionContent(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const { stream, mime, size, range } = await this.documents.getVersionContent(
      user.userId,
      workspaceId,
      id,
      versionId,
      req.headers.range
    );
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      res.setHeader("Content-Length", String(size));
    }
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }

  @Post(":id/versions/:versionId/restore")
  restoreVersion(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Param("versionId") versionId: string
  ): Promise<DocumentItem> {
    return this.documents.restoreVersion(user.userId, workspaceId, id, versionId);
  }

  /**
   * Streams the file. Guarded like every other route (Bearer token) — the
   * client fetches this as a blob and makes an object URL, so `Authorization`
   * stays a header. Honours a single `Range` so media/PDF can seek.
   */
  @Get(":id/content")
  async content(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
    @Query("disposition") disposition: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const { stream, mime, size, name, range } = await this.documents.openContent(
      user.userId,
      workspaceId,
      id,
      req.headers.range
    );
    const filename = encodeURIComponent(name);
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `${disposition === "attachment" ? "attachment" : "inline"}; filename*=UTF-8''${filename}`
    );
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      res.setHeader("Content-Length", String(size));
    }
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.destroy();
    });
    stream.pipe(res);
  }
}
