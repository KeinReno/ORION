import { BadRequestException, Body, Controller, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { exportWorkspaceInputSchema, type ExportWorkspaceInput, type WorkspaceTransferPreview } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { WorkspaceTransferService } from "./workspace-transfer.service";

/** Файл переноса целиком в памяти (снапшот + байты в base64): потолок осознанный, см. docs/SYNC.md. */
const MAX_TRANSFER_BYTES = Math.max(1, Number(process.env.MAX_TRANSFER_MB ?? 256)) * 1024 * 1024;

/** ТЗ-05 §5.5. Не по «модульному контракту»: импорт создаёт НОВОЕ пространство, членства в нём ещё нет. */
@UseGuards(JwtAuthGuard)
@Controller("workspaces")
export class WorkspaceTransferController {
  constructor(private readonly transfer: WorkspaceTransferService) {}

  /** POST, а не GET: пароль к файлу едет в теле, а не в адресе. */
  @Post(":workspaceId/export")
  async export(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(exportWorkspaceInputSchema)) body: ExportWorkspaceInput,
    @Res() res: Response
  ): Promise<void> {
    const { filename, data } = await this.transfer.exportWorkspace(user.userId, workspaceId, body.passphrase || undefined);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Content-Length", String(data.length));
    res.end(data);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_TRANSFER_BYTES } }))
  import(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() body: { dryRun?: string; name?: string; passphrase?: string; expectedHash?: string }
  ): Promise<WorkspaceTransferPreview> {
    if (!file?.buffer?.length) throw new BadRequestException("Приложите файл .orion");
    return this.transfer.importWorkspace(user.userId, file.buffer, {
      dryRun: body.dryRun !== "false",
      name: body.name,
      passphrase: body.passphrase || undefined,
      expectedHash: body.expectedHash || undefined
    });
  }
}
