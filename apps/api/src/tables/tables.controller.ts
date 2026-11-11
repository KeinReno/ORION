import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Res, UseGuards } from "@nestjs/common";
import {
  createTableInputSchema,
  createTableRowInputSchema,
  importTableCsvInputSchema,
  reorderTableRowsInputSchema,
  updateTableInputSchema,
  updateTableRowInputSchema,
  type CreateTableInput,
  type CreateTableRowInput,
  type ImportTableCsvInput,
  type ImportTableCsvResult,
  type ReorderTableRowsInput,
  type TableDefinition,
  type TableReadResult,
  type TableRow,
  type UpdateTableInput,
  type UpdateTableRowInput
} from "@orion/shared-types";
import type { Response } from "express";
import type { RequestUser } from "../auth/jwt.strategy";
import { CurrentUser } from "../common/current-user.decorator";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RequirePermission } from "../common/require-permission";
import { TablesValidationPipe } from "./table-validation.pipe";
import { TablesService } from "./tables.service";

/**
 * Р—Р°РґР°РЅРёРµ 10.1 вЂ” Orion Tables. Р­С‚Рѕ РїРѕРІРµСЂС…РЅРѕСЃС‚СЊ СЏРґСЂР° (РѕР±С‰РёР№ РёРЅСЃС‚СЂСѓРјРµРЅС‚), Р° РЅРµ
 * РїСЂРµРґРјРµС‚РЅС‹Р№ РјРѕРґСѓР»СЊ, РїРѕСЌС‚РѕРјСѓ Р·РґРµСЃСЊ РЅРµС‚ `@RequireModule`: РІС‹РєР»СЋС‡Р°С‚СЊ РЅРµС‡РµРіРѕ, Р°
 * РїСЂР°РІР° РїСЂРѕРІРµСЂСЏСЋС‚СЃСЏ СЂРµРµСЃС‚СЂРѕРј (`core.table.*`) Рё С‡Р»РµРЅСЃС‚РІРѕРј РІ СЃРµСЂРІРёСЃРµ.
 *
 * Р­РєСЃРїРѕСЂС‚ вЂ” РїРµСЂРІС‹Р№ Р±РёРЅР°СЂРЅС‹Р№/РЅРµ-JSON РѕС‚РІРµС‚ РІ СЌС‚РѕРј РјРѕРґСѓР»Рµ: CSV РѕС‚РґР°С‘С‚СЃСЏ С‡РµСЂРµР·
 * `@Res()` СЃ BOM, С‡С‚РѕР±С‹ СЂСѓСЃСЃРєРёРµ Р·Р°РіРѕР»РѕРІРєРё РѕС‚РєСЂС‹РІР°Р»РёСЃСЊ РІ Excel Р±РµР· В«РєСЂР°РєРѕР·СЏР±СЂВ».
 */
@UseGuards(JwtAuthGuard)
@Controller("workspaces/:workspaceId/tables")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequirePermission("core.table.read")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<TableDefinition[]> {
    return this.tables.list(user.userId, workspaceId);
  }

  @Post("import-csv")
  @RequirePermission("core.table.create")
  importCsv(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new TablesValidationPipe(importTableCsvInputSchema)) body: ImportTableCsvInput
  ): Promise<ImportTableCsvResult> {
    return this.tables.importCsv(user.userId, workspaceId, body);
  }

  @Get(":tableId/export.csv")
  @RequirePermission("core.table.read")
  async exportCsv(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Res() response: Response
  ): Promise<void> {
    const { filename, csv } = await this.tables.exportCsv(user.userId, workspaceId, tableId);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.send(`\uFEFF${csv}`);
  }

  @Post()
  @RequirePermission("core.table.create")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new TablesValidationPipe(createTableInputSchema)) body: CreateTableInput
  ): Promise<TableDefinition> {
    return this.tables.create(user.userId, workspaceId, body);
  }

  @Get(":tableId")
  @RequirePermission("core.table.read")
  get(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string
  ): Promise<TableReadResult> {
    return this.tables.get(user.userId, workspaceId, tableId);
  }

  @Patch(":tableId")
  @RequirePermission("core.table.update")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Body(new TablesValidationPipe(updateTableInputSchema)) body: UpdateTableInput
  ): Promise<TableDefinition> {
    return this.tables.update(user.userId, workspaceId, tableId, body);
  }

  @Delete(":tableId")
  @HttpCode(204)
  @RequirePermission("core.table.delete")
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string
  ): Promise<void> {
    await this.tables.remove(user.userId, workspaceId, tableId);
  }

  @Post(":tableId/rows")
  @RequirePermission("core.table.update")
  createRow(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Body(new TablesValidationPipe(createTableRowInputSchema)) body: CreateTableRowInput
  ): Promise<TableRow> {
    return this.tables.createRow(user.userId, workspaceId, tableId, body);
  }

  @Put(":tableId/rows/order")
  @RequirePermission("core.table.update")
  reorderRows(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Body(new TablesValidationPipe(reorderTableRowsInputSchema)) body: ReorderTableRowsInput
  ): Promise<TableReadResult> {
    return this.tables.reorderRows(user.userId, workspaceId, tableId, body.ids);
  }

  @Patch(":tableId/rows/:rowId")
  @RequirePermission("core.table.update")
  updateRow(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Param("rowId") rowId: string,
    @Body(new TablesValidationPipe(updateTableRowInputSchema)) body: UpdateTableRowInput
  ): Promise<TableRow> {
    return this.tables.updateRow(user.userId, workspaceId, tableId, rowId, body);
  }

  @Delete(":tableId/rows/:rowId")
  @HttpCode(204)
  @RequirePermission("core.table.update")
  async removeRow(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("tableId") tableId: string,
    @Param("rowId") rowId: string
  ): Promise<void> {
    await this.tables.removeRow(user.userId, workspaceId, tableId, rowId);
  }
}

