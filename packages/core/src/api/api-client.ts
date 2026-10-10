import {
  accountPublicSchema,
  accountSchema,
  appInfoSchema,
  authResponseSchema,
  backupRefSchema,
  backupResultSchema,
  budgetSchema,
  calendarConnectionSchema,
  calendarFeedInfoSchema,
  categoryBreakdownEntrySchema,
  categoryRuleSchema,
  documentSchema,
  documentVersionSchema,
  entityLinkSchema,
  entityLinkPageSchema,
  createAndLinkResultSchema,
  entityReminderSchema,
  eventSchema,
  financeCategorySchema,
  globalSearchResultSchema,
  habitEntrySchema,
  habitSchema,
  inboxItemSchema,
  inboxListSchema,
  listItemSchema,
  listSchema,
  inventoryItemSchema,
  inventoryMovementSchema,
  milestoneCascadeImpactSchema,
  milestoneSchema,
  monthlyFinanceSummarySchema,
  myOverviewSchema,
  notificationSchema,
  projectDetailSchema,
  projectSchema,
  savingsGoalSchema,
  savedTaskViewSchema,
  sessionInfoSchema,
  sessionUserSchema,
  restorePreviewSchema,
  syncRemoteSchema,
  syncRemoteTestResultSchema,
  noteAttachmentSchema,
  noteBacklinkSchema,
  noteRevisionSchema,
  noteRevisionSummarySchema,
  noteSchema,
  noteTitleRefSchema,
  orionModeInfoSchema,
  recurringTransactionSchema,
  taskSchema,
  taskActivitySchema,
  taskCommentSchema,
  taskCommentPageSchema,
  timeEntryPageSchema,
  timeEntrySchema,
  timeSummarySchema,
  toggleHabitResultSchema,
  transactionSchema,
  financeImportResultSchema,
  obligationSchema,
  watchItemSchema,
  investmentTradeSchema,
  tradeImportResultSchema,
  userPreferenceSchema,
  workspaceOrganizationSchema,
  workspaceModuleStateSchema,
  workspaceSchema,
  workspaceInviteSchema,
  createdWorkspaceInviteSchema,
  workspaceMemberSchema,
  inviteLookupSchema,
  workspacePluginStateSchema,
  type Account,
  type AccountPublic,
  type AppInfo,
  type OrionModeInfo,
  type AuthResponse,
  type BackupRef,
  type BackupResult,
  type Budget,
  type CalendarConnection,
  type CalendarConnectionInput,
  type CalendarFeedInfo,
  type CaptureInboxInput,
  type CategoryBreakdownEntry,
  type CategoryRule,
  type ChangePasswordInput,
  type CreateAccountInput,
  type CreateBudgetInput,
  type CreateCategoryRuleInput,
  type CreateAndLinkInput,
  type CreateAndLinkResult,
  type CreateEntityLinkInput,
  type CreateEventInput,
  type CreateProjectInput,
  type CreateSavedTaskViewInput,
  type CreateTaskCommentInput,
  type CreateProjectUpdateInput,
  type ProjectUpdate,
  projectUpdateSchema,
  type UpdateTaskCommentInput,
  type TaskActivity,
  type TaskComment,
  type TaskCommentPage,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type CreateFinanceCategoryInput,
  type CreateHabitInput,
  type CreateInventoryItemInput,
  type CreateListInput,
  type CreateListItemInput,
  type CreateInventoryMovementInput,
  type CreateMilestoneInput,
  type MilestoneCascadeImpact,
  type MilestoneReschedulePreviewInput,
  type CreateNoteInput,
  type CreateRecurringTransactionInput,
  type CreateSavingsGoalInput,
  type CreateTaskInput,
  type CreateTimeEntryInput,
  type CreateTransactionInput,
  type FinanceImportInput,
  type CreateObligationInput,
  type CreateWatchItemInput,
  type InvestmentTrade,
  type RecordTradeFeeInput,
  type CompassEngineStatus,
  compassEngineStatusSchema,
  compassJournalSyncResultSchema,
  type CompassJournalSyncResult,
  type TradeImportInput,
  type TradeImportResult,
  type TradeMode,
  type UpdateWatchItemInput,
  type WatchItem,
  type Obligation,
  type PayObligationInput,
  type UpdateObligationInput,
  type FinanceImportResult,
  type BulkDocumentInput,
  type CreateFolderInput,
  type DocumentItem,
  type DocumentVersion,
  type DocumentView,
  type EntityLink,
  type EntityLinkPage,
  type EntityReminder,
  type CreateEntityReminderInput,
  type GlobalSearchResult,
  type Habit,
  type HabitEntry,
  type InboxItem,
  type InboxList,
  type InventoryItem,
  type InventoryMovement,
  type List,
  type ListItem,
  type Milestone,
  type Notification,
  type ProcessInboxInput,
  type Project,
  type ProjectDetail,
  type SavedTaskView,
  type SearchableEntityType,
  type SessionInfo,
  type UpdateDocumentInput,
  type UpdateProjectInput,
  type UpdateUserPreferenceInput,
  type UpdateProfileInput,
  type UserPreference,
  type WorkspaceOrganization,
  type CreateSphereInput,
  type UpdateSphereInput,
  type AssignWorkspaceSphereInput,
  type Event,
  type EventScope,
  type FinanceCategory,
  type LoginInput,
  type MonthlyFinanceSummary,
  type MyOverview,
  type Note,
  type NoteAttachment,
  type NoteBacklink,
  type NoteRevision,
  type NoteRevisionSummary,
  type NoteTitleRef,
  type NoteView,
  type RecurringTransaction,
  type RegisterInput,
  type SavingsGoal,
  type SessionUser,
  type RestoreInput,
  type RestorePreview,
  type StartTimerInput,
  type StopTimerInput,
  type SyncRemote,
  type SyncRemoteInput,
  type SyncRemoteTestResult,
  type Task,
  type TimeEntry,
  type TimeEntryPage,
  type TimeSummary,
  type ToggleHabitInput,
  type ToggleHabitResult,
  type Transaction,
  type UpdateAccountInput,
  type UpdateBudgetInput,
  type UpdateEventInput,
  type UpdateFinanceCategoryInput,
  type UpdateHabitInput,
  type UpdateInventoryItemInput,
  type UpdateListInput,
  type UpdateListItemInput,
  type UpdateMilestoneInput,
  type UpdateNoteInput,
  type UpdateRecurringTransactionInput,
  type UpdateSavingsGoalInput,
  type UpdateTaskInput,
  type UpdateTimeEntryInput,
  type UpdateTransactionInput,
  type SetWorkspaceModuleInput,
  type SetWorkspaceModuleRestrictionInput,
  type Workspace,
  type WorkspaceModuleState,
  type CreateWorkspaceInviteInput,
  type CreatedWorkspaceInvite,
  type InviteLookup,
  type UpdateWorkspaceMemberRoleInput,
  type WorkspaceInvite,
  type WorkspaceMember,
  type SetWorkspacePluginInput,
  type WorkspacePluginState,
  crossWorkspaceGrantSchema,
  sharedGrantSummarySchema,
  sharedGrantIssuedSchema,
  sharedObjectViewSchema,
  workspaceMemberSearchResultSchema,
  resolveUserByEmailResultSchema,
  type CreateGrantInput,
  type CrossWorkspaceGrant,
  type SharedGrantIssued,
  type SharedGrantSummary,
  type SharedObjectView,
  type WorkspaceMemberSearchResult,
  type ResolveUserByEmailResult
} from "@orion/shared-types";
import { z } from "zod";
import type { TokenStore } from "../auth/token-store";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
}

const AUTH_ENDPOINTS_WITHOUT_RETRY = new Set(["/auth/login", "/auth/register", "/auth/refresh", "/auth/accounts"]);

/**
 * Typed fetch client for the ORION API. Framework-agnostic — no React,
 * no DOM assumptions beyond a global fetch (present in browsers, Node 18+,
 * and the Tauri webview alike).
 */
export class ApiClient {
  /** Single-flight guard: concurrent 401s share one /auth/refresh call instead of racing each other. */
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const data = await this.request("POST", "/auth/register", input, authResponseSchema);
    await this.options.tokenStore.setPair(data.accessToken, data.refreshToken);
    return data;
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const data = await this.request("POST", "/auth/login", input, authResponseSchema);
    await this.options.tokenStore.setPair(data.accessToken, data.refreshToken);
    return data;
  }

  async logout(): Promise<void> {
    const refreshToken = await this.options.tokenStore.getRefreshToken();
    if (refreshToken) {
      try {
        await this.request("POST", "/auth/logout", { refreshToken }, z.unknown());
      } catch {
        // best-effort — the token gets cleared locally regardless
      }
    }
    await this.options.tokenStore.clear();
  }

  async logoutAll(): Promise<void> {
    await this.request("POST", "/auth/logout-all", undefined, z.unknown());
    await this.options.tokenStore.clear();
  }

  /**
   * Parsed with the shared `sessionUserSchema`, not a hand-written subset: the
   * local `{ id, email, name }` shape here was a second, silently drifting copy
   * of the contract (it went stale the moment `/auth/me` grew the password
   * fields). Response schemas are always the ones from `@orion/shared-types`.
   */
  me(): Promise<SessionUser> {
    return this.request("GET", "/auth/me", undefined, sessionUserSchema);
  }

  listLocalAccounts(): Promise<AccountPublic[]> {
    return this.request("GET", "/auth/accounts", undefined, z.array(accountPublicSchema));
  }

  uploadAvatar(file: Blob): Promise<SessionUser> {
    const form = new FormData();
    form.append("file", file);
    return this.request("POST", "/auth/avatar", form, sessionUserSchema);
  }

  async deleteAvatar(): Promise<void> {
    await this.request("DELETE", "/auth/avatar", undefined, z.unknown());
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request("GET", "/workspaces/me", undefined, z.array(workspaceSchema));
  }

  /** U08 — personal cross-workspace overview. See OverviewService: aggregates workspaces the caller already has RLS-checked access to, grants nothing new. */
  getMyOverview(): Promise<MyOverview> {
    return this.request("GET", "/me/overview", undefined, myOverviewSchema);
  }

  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
    return this.request("POST", "/workspaces", input, workspaceSchema);
  }

  /** U09 grant-issue recipient picker — members of `workspaceId` matching `q` by email/name, `q.length < 2` returns []. */
  searchWorkspaceMembers(workspaceId: string, q: string): Promise<WorkspaceMemberSearchResult[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/members-search${buildQuery({ q })}`,
      undefined,
      z.array(workspaceMemberSearchResultSchema)
    );
  }

  /**
   * R29-05 — exact-email lookup for the grant-issue "по email" flow, for a
   * person who isn't a member of the source workspace (that's the whole
   * point of a grant). Not workspace-scoped: the whole reason this exists is
   * to find someone the caller has no shared workspace with. Server returns
   * `{ found: false }` uniformly for "no such account" and anything else —
   * this method doesn't add its own distinction on top.
   */
  resolveUserByEmail(email: string): Promise<ResolveUserByEmailResult> {
    return this.request("GET", `/users/resolve-by-email${buildQuery({ email })}`, undefined, resolveUserByEmailResultSchema);
  }

  updateWorkspace(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    return this.request("PATCH", `/workspaces/${workspaceId}`, input, workspaceSchema);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}`, undefined, z.unknown());
  }

  listWorkspaceModules(workspaceId: string): Promise<WorkspaceModuleState[]> {
    return this.request("GET", `/workspaces/${workspaceId}/modules`, undefined, z.array(workspaceModuleStateSchema));
  }

  setWorkspaceModule(workspaceId: string, moduleId: string, input: SetWorkspaceModuleInput): Promise<WorkspaceModuleState[]> {
    return this.request(
      "PATCH",
      `/workspaces/${workspaceId}/modules/${moduleId}`,
      input,
      z.array(workspaceModuleStateSchema)
    );
  }

  /** Visibility, not availability — restricted modules stay on for owner/lead, only `member` is turned away. */
  setWorkspaceModuleRestriction(
    workspaceId: string,
    moduleId: string,
    input: SetWorkspaceModuleRestrictionInput
  ): Promise<WorkspaceModuleState[]> {
    return this.request(
      "PATCH",
      `/workspaces/${workspaceId}/modules/${moduleId}/restrict`,
      input,
      z.array(workspaceModuleStateSchema)
    );
  }

  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.request("GET", `/workspaces/${workspaceId}/members`, undefined, z.array(workspaceMemberSchema));
  }

  async removeWorkspaceMember(workspaceId: string, memberId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/members/${memberId}`, undefined, z.unknown());
  }

  setWorkspaceMemberRole(workspaceId: string, memberId: string, input: UpdateWorkspaceMemberRoleInput): Promise<WorkspaceMember> {
    return this.request("PATCH", `/workspaces/${workspaceId}/members/${memberId}`, input, workspaceMemberSchema);
  }

  listWorkspaceInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    return this.request("GET", `/workspaces/${workspaceId}/invites`, undefined, z.array(workspaceInviteSchema));
  }

  createWorkspaceInvite(workspaceId: string, input: CreateWorkspaceInviteInput): Promise<CreatedWorkspaceInvite> {
    return this.request("POST", `/workspaces/${workspaceId}/invites`, input, createdWorkspaceInviteSchema);
  }

  async revokeWorkspaceInvite(workspaceId: string, inviteId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/invites/${inviteId}`, undefined, z.unknown());
  }

  lookupInvite(token: string): Promise<InviteLookup> {
    return this.request("GET", `/invites/${token}`, undefined, inviteLookupSchema);
  }

  async acceptInvite(token: string): Promise<void> {
    await this.request("POST", `/invites/${token}/accept`, undefined, z.unknown());
  }

  listWorkspacePlugins(workspaceId: string): Promise<WorkspacePluginState[]> {
    return this.request("GET", `/workspaces/${workspaceId}/plugins`, undefined, z.array(workspacePluginStateSchema));
  }

  setWorkspacePlugin(workspaceId: string, pluginId: string, input: SetWorkspacePluginInput): Promise<WorkspacePluginState[]> {
    return this.request(
      "PATCH",
      `/workspaces/${workspaceId}/plugins/${pluginId}`,
      input,
      z.array(workspacePluginStateSchema)
    );
  }

  // --- U09: explicit cross-workspace grants --------------------------------

  /** "Доступно мне" — active grants where I'm the grantee. */
  listSharedWithMe(): Promise<SharedGrantSummary[]> {
    return this.request("GET", "/shared", undefined, z.array(sharedGrantSummarySchema));
  }

  /** The single allowlisted object a grant points at. */
  getSharedObject(grantId: string): Promise<SharedObjectView> {
    return this.request("GET", `/shared/${grantId}`, undefined, sharedObjectViewSchema);
  }

  /** Grants issued FROM this workspace — owner's own management list. */
  listGrants(workspaceId: string): Promise<SharedGrantIssued[]> {
    return this.request("GET", `/workspaces/${workspaceId}/grants`, undefined, z.array(sharedGrantIssuedSchema));
  }

  createGrant(workspaceId: string, input: CreateGrantInput): Promise<CrossWorkspaceGrant> {
    return this.request("POST", `/workspaces/${workspaceId}/grants`, input, crossWorkspaceGrantSchema);
  }

  async revokeGrant(workspaceId: string, grantId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/grants/${grantId}`, undefined, z.unknown());
  }

  /** File bytes for a `document`-type grant — same auth-header caveat as `getDocumentBlob`. */
  getSharedDocumentBlob(grantId: string): Promise<Blob> {
    return this.requestBlob("GET", `/shared/${grantId}/content`);
  }

  listNotes(workspaceId: string, search?: string, view?: NoteView, templates?: boolean): Promise<Note[]> {
    const query = buildQuery({
      search: search?.trim() || undefined,
      view: view && view !== "active" ? view : undefined,
      templates: templates ? "1" : undefined
    });
    return this.request("GET", `/workspaces/${workspaceId}/notes${query}`, undefined, z.array(noteSchema));
  }

  /** `{ id, title }` for every live note — for the `[[wiki link]]` autocomplete. */
  listNoteTitles(workspaceId: string): Promise<NoteTitleRef[]> {
    return this.request("GET", `/workspaces/${workspaceId}/notes/titles`, undefined, z.array(noteTitleRefSchema));
  }

  /** Notes whose body `[[links]]` resolve to `noteId`. */
  noteBacklinks(workspaceId: string, noteId: string): Promise<NoteBacklink[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/notes/${noteId}/backlinks`,
      undefined,
      z.array(noteBacklinkSchema)
    );
  }

  /** Open (or create) today's daily note. */
  openDailyNote(workspaceId: string): Promise<Note> {
    return this.request("POST", `/workspaces/${workspaceId}/notes/daily`, undefined, noteSchema);
  }

  /** Version history for a note, newest first (no bodies). */
  listNoteRevisions(workspaceId: string, noteId: string): Promise<NoteRevisionSummary[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/notes/${noteId}/revisions`,
      undefined,
      z.array(noteRevisionSummarySchema)
    );
  }

  /** One full past snapshot, with its body. */
  getNoteRevision(workspaceId: string, noteId: string, revisionId: string): Promise<NoteRevision> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/notes/${noteId}/revisions/${revisionId}`,
      undefined,
      noteRevisionSchema
    );
  }

  /**
   * Roll the note back to a past snapshot (snapshots the current state
   * first). `expectedRevision` is optional (R18-02) — the server still
   * enforces CAS against the revision it reads itself when omitted, but a
   * caller that already has the note's current revision loaded (e.g. the
   * editor that's about to restore) should pass it to close the race
   * between load and restore too.
   */
  restoreNoteRevision(workspaceId: string, noteId: string, revisionId: string, expectedRevision?: number): Promise<Note> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/notes/${noteId}/revisions/${revisionId}/restore`,
      { expectedRevision },
      noteSchema
    );
  }

  createNote(workspaceId: string, input: CreateNoteInput): Promise<Note> {
    return this.request("POST", `/workspaces/${workspaceId}/notes`, input, noteSchema);
  }

  updateNote(workspaceId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    return this.request("PATCH", `/workspaces/${workspaceId}/notes/${noteId}`, input, noteSchema);
  }

  /** Soft delete — the note goes to the trash (see `restoreNote` / `purgeNote`). */
  async deleteNote(workspaceId: string, noteId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/notes/${noteId}`, undefined, z.unknown());
  }

  restoreNote(workspaceId: string, noteId: string): Promise<Note> {
    return this.request("POST", `/workspaces/${workspaceId}/notes/${noteId}/restore`, undefined, noteSchema);
  }

  /** Irreversible hard delete from the trash. */
  async purgeNote(workspaceId: string, noteId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/notes/${noteId}/purge`, undefined, z.unknown());
  }

  /** Rename/merge a tag across the whole workspace. */
  renameNoteTag(workspaceId: string, from: string, to: string): Promise<{ updated: number }> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/notes/tags/rename`,
      { from, to },
      z.object({ updated: z.number() })
    );
  }

  /** Remove a tag from every note in the workspace. */
  deleteNoteTag(workspaceId: string, tag: string): Promise<{ updated: number }> {
    return this.request(
      "DELETE",
      `/workspaces/${workspaceId}/notes/tags/${encodeURIComponent(tag)}`,
      undefined,
      z.object({ updated: z.number() })
    );
  }

  // --- Вложения заметок ---------------------------------------------------

  /** Files attached to one note (each is a Document of this workspace). */
  listNoteAttachments(workspaceId: string, noteId: string): Promise<NoteAttachment[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/notes/${noteId}/attachments`,
      undefined,
      z.array(noteAttachmentSchema)
    );
  }

  /** Attach a document that already exists in this workspace. */
  attachNoteDocument(workspaceId: string, noteId: string, documentId: string): Promise<NoteAttachment> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/notes/${noteId}/attachments`,
      { documentId },
      noteAttachmentSchema
    );
  }

  /** Upload new files and attach them to the note — `multipart/form-data`, like `uploadDocuments`. */
  uploadNoteAttachments(workspaceId: string, noteId: string, files: File[]): Promise<NoteAttachment[]> {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/notes/${noteId}/attachments/upload`,
      form,
      z.array(noteAttachmentSchema)
    );
  }

  /** Detach a file from the note — the Document itself stays in "Документы". */
  async deleteNoteAttachment(workspaceId: string, noteId: string, attachmentId: string): Promise<void> {
    await this.request(
      "DELETE",
      `/workspaces/${workspaceId}/notes/${noteId}/attachments/${attachmentId}`,
      undefined,
      z.unknown()
    );
  }

  // --- Документы (v0.12) -------------------------------------------------

  /** Every document in the workspace, one flat list — the client builds the tree. `view: "trash"` returns only soft-deleted rows. */
  listDocuments(workspaceId: string, view?: DocumentView): Promise<DocumentItem[]> {
    const query = buildQuery({ view: view && view !== "active" ? view : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/documents${query}`, undefined, z.array(documentSchema));
  }

  createFolder(workspaceId: string, input: CreateFolderInput): Promise<DocumentItem> {
    return this.request("POST", `/workspaces/${workspaceId}/documents`, input, documentSchema);
  }

  /** Upload one or more files into `parentId` (null = workspace root). Sent as `multipart/form-data`. */
  uploadDocuments(workspaceId: string, parentId: string | null, files: File[]): Promise<DocumentItem[]> {
    const form = new FormData();
    if (parentId) form.append("parentId", parentId);
    for (const file of files) form.append("files", file, file.name);
    return this.request("POST", `/workspaces/${workspaceId}/documents/upload`, form, z.array(documentSchema));
  }

  /** Rename (`name`) and/or move (`parentId`) a file or folder. */
  renameOrMoveDocument(workspaceId: string, id: string, input: UpdateDocumentInput): Promise<DocumentItem> {
    return this.request("PATCH", `/workspaces/${workspaceId}/documents/${id}`, input, documentSchema);
  }

  /** Soft delete — the node (and its subtree) goes to the trash. */
  async deleteDocument(workspaceId: string, id: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/documents/${id}`, undefined, z.unknown());
  }

  restoreDocument(workspaceId: string, id: string): Promise<DocumentItem> {
    return this.request("POST", `/workspaces/${workspaceId}/documents/${id}/restore`, undefined, documentSchema);
  }

  /** Irreversible hard delete from the trash. */
  async purgeDocument(workspaceId: string, id: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/documents/${id}/purge`, undefined, z.unknown());
  }

  /** Apply one op (`move` / `trash` / `restore` / `purge`) to many ids at once. */
  async bulkDocuments(workspaceId: string, input: BulkDocumentInput): Promise<void> {
    await this.request("POST", `/workspaces/${workspaceId}/documents/bulk`, input, z.unknown());
  }

  /**
   * Fetches a file's bytes (with the Bearer header). The caller turns this
   * into an object URL for preview / download — a plain `<img src>` or
   * `<a href>` can't carry the auth header.
   */
  getDocumentBlob(workspaceId: string, id: string): Promise<Blob> {
    return this.requestBlob("GET", `/workspaces/${workspaceId}/documents/${id}/content`);
  }

  /** Overwrites a file's content; the old content is archived as a version. Sent as `multipart/form-data`. */
  replaceDocumentContent(workspaceId: string, id: string, file: File): Promise<DocumentItem> {
    const form = new FormData();
    form.append("file", file, file.name);
    return this.request("POST", `/workspaces/${workspaceId}/documents/${id}/content`, form, documentSchema);
  }

  /** Version history for a file, newest first. */
  listDocumentVersions(workspaceId: string, id: string): Promise<DocumentVersion[]> {
    return this.request("GET", `/workspaces/${workspaceId}/documents/${id}/versions`, undefined, z.array(documentVersionSchema));
  }

  /** A past version's bytes — same auth-header caveat as `getDocumentBlob`. */
  getDocumentVersionBlob(workspaceId: string, id: string, versionId: string): Promise<Blob> {
    return this.requestBlob("GET", `/workspaces/${workspaceId}/documents/${id}/versions/${versionId}/content`);
  }

  /** Rolls a file back to `versionId`'s content; the current content is archived as a new version first. */
  restoreDocumentVersion(workspaceId: string, id: string, versionId: string): Promise<DocumentItem> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/documents/${id}/versions/${versionId}/restore`,
      undefined,
      documentSchema
    );
  }

  listTasks(workspaceId: string, search?: string, assignedToMe?: boolean): Promise<Task[]> {
    const query = buildQuery({ search: search?.trim() || undefined, assignedToMe: assignedToMe ? "true" : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/tasks${query}`, undefined, z.array(taskSchema));
  }

  createTask(workspaceId: string, input: CreateTaskInput): Promise<Task> {
    return this.request("POST", `/workspaces/${workspaceId}/tasks`, input, taskSchema);
  }

  updateTask(workspaceId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
    return this.request("PATCH", `/workspaces/${workspaceId}/tasks/${taskId}`, input, taskSchema);
  }

  async deleteTask(workspaceId: string, taskId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/tasks/${taskId}`, undefined, z.unknown());
  }

  // --- S17 комментарии + журнал задачи ------------------------------------

  listTaskComments(
    workspaceId: string,
    taskId: string,
    page?: { cursor?: string; limit?: number }
  ): Promise<TaskCommentPage> {
    const query = buildQuery({ cursor: page?.cursor, limit: page?.limit ? String(page.limit) : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/tasks/${taskId}/comments${query}`, undefined, taskCommentPageSchema);
  }

  createTaskComment(workspaceId: string, taskId: string, input: CreateTaskCommentInput): Promise<TaskComment> {
    return this.request("POST", `/workspaces/${workspaceId}/tasks/${taskId}/comments`, input, taskCommentSchema);
  }

  updateTaskComment(workspaceId: string, taskId: string, commentId: string, input: UpdateTaskCommentInput): Promise<TaskComment> {
    return this.request("PATCH", `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`, input, taskCommentSchema);
  }

  async deleteTaskComment(workspaceId: string, taskId: string, commentId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`, undefined, z.unknown());
  }

  // --- UI-05 обновления состояния проекта -----------------------------------

  listProjectUpdates(workspaceId: string, projectId: string): Promise<ProjectUpdate[]> {
    return this.request("GET", `/workspaces/${workspaceId}/projects/${projectId}/updates`, undefined, z.array(projectUpdateSchema));
  }

  createProjectUpdate(workspaceId: string, projectId: string, input: CreateProjectUpdateInput): Promise<ProjectUpdate> {
    return this.request("POST", `/workspaces/${workspaceId}/projects/${projectId}/updates`, input, projectUpdateSchema);
  }

  async deleteProjectUpdate(workspaceId: string, projectId: string, updateId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/projects/${projectId}/updates/${updateId}`, undefined, z.unknown());
  }

  listTaskActivity(workspaceId: string, taskId: string): Promise<TaskActivity[]> {
    return this.request("GET", `/workspaces/${workspaceId}/tasks/${taskId}/activity`, undefined, z.array(taskActivitySchema));
  }

  /** Windowed — `from`/`to` are ISO instants; the server expands recurring events into the window. */
  listEvents(workspaceId: string, from: string, to: string): Promise<Event[]> {
    const query = buildQuery({ from, to });
    return this.request("GET", `/workspaces/${workspaceId}/events${query}`, undefined, z.array(eventSchema));
  }

  createEvent(workspaceId: string, input: CreateEventInput): Promise<Event> {
    return this.request("POST", `/workspaces/${workspaceId}/events`, input, eventSchema);
  }

  /**
   * `opts.scope` (`one` / `following` / `all`, default `all`) and
   * `opts.occurrenceStart` steer edits to a recurring event. `eventId` may
   * be the synthetic `<masterId>:<iso>` from `listEvents` — encoded here.
   */
  updateEvent(
    workspaceId: string,
    eventId: string,
    input: UpdateEventInput,
    opts?: { scope?: EventScope; occurrenceStart?: string }
  ): Promise<Event> {
    const query = buildQuery({ scope: opts?.scope, occurrenceStart: opts?.occurrenceStart });
    return this.request(
      "PATCH",
      `/workspaces/${workspaceId}/events/${encodeURIComponent(eventId)}${query}`,
      input,
      eventSchema
    );
  }

  async deleteEvent(
    workspaceId: string,
    eventId: string,
    opts?: { scope?: EventScope; occurrenceStart?: string }
  ): Promise<void> {
    const query = buildQuery({ scope: opts?.scope, occurrenceStart: opts?.occurrenceStart });
    await this.request(
      "DELETE",
      `/workspaces/${workspaceId}/events/${encodeURIComponent(eventId)}${query}`,
      undefined,
      z.unknown()
    );
  }

  /** Read-only .ics subscription URL for this workspace (mints a token on first call). */
  calendarFeedInfo(workspaceId: string): Promise<CalendarFeedInfo> {
    return this.request("GET", `/workspaces/${workspaceId}/calendar/feed`, undefined, calendarFeedInfoSchema);
  }

  rotateCalendarFeed(workspaceId: string): Promise<CalendarFeedInfo> {
    return this.request("POST", `/workspaces/${workspaceId}/calendar/feed/rotate`, undefined, calendarFeedInfoSchema);
  }

  listAccounts(workspaceId: string, includeArchived = false): Promise<Account[]> {
    const query = buildQuery({ includeArchived: includeArchived ? "true" : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/finance/accounts${query}`, undefined, z.array(accountSchema));
  }

  createAccount(workspaceId: string, input: CreateAccountInput): Promise<Account> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/accounts`, input, accountSchema);
  }

  updateAccount(workspaceId: string, accountId: string, input: UpdateAccountInput): Promise<Account> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/accounts/${accountId}`, input, accountSchema);
  }

  async deleteAccount(workspaceId: string, accountId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/accounts/${accountId}`, undefined, z.unknown());
  }

  reconcileAccount(workspaceId: string, accountId: string, actualBalance: number): Promise<Account> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/finance/accounts/${accountId}/reconcile`,
      { actualBalance },
      accountSchema
    );
  }

  listFinanceCategories(workspaceId: string, includeArchived = false): Promise<FinanceCategory[]> {
    const query = buildQuery({ includeArchived: includeArchived ? "true" : undefined });
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/finance/categories${query}`,
      undefined,
      z.array(financeCategorySchema)
    );
  }

  createFinanceCategory(workspaceId: string, input: CreateFinanceCategoryInput): Promise<FinanceCategory> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/categories`, input, financeCategorySchema);
  }

  updateFinanceCategory(workspaceId: string, categoryId: string, input: UpdateFinanceCategoryInput): Promise<FinanceCategory> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/categories/${categoryId}`, input, financeCategorySchema);
  }

  async deleteFinanceCategory(workspaceId: string, categoryId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/categories/${categoryId}`, undefined, z.unknown());
  }

  listTransactions(
    workspaceId: string,
    filters?: {
      accountId?: string;
      categoryId?: string;
      tag?: string;
      month?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<Transaction[]> {
    const query = buildQuery(filters);
    return this.request("GET", `/workspaces/${workspaceId}/finance/transactions${query}`, undefined, z.array(transactionSchema));
  }

  createTransaction(workspaceId: string, input: CreateTransactionInput): Promise<Transaction> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/transactions`, input, transactionSchema);
  }

  listWatchItems(workspaceId: string): Promise<WatchItem[]> {
    return this.request("GET", `/workspaces/${workspaceId}/markets/watchlist`, undefined, z.array(watchItemSchema));
  }

  addWatchItem(workspaceId: string, input: CreateWatchItemInput): Promise<WatchItem> {
    return this.request("POST", `/workspaces/${workspaceId}/markets/watchlist`, input, watchItemSchema);
  }

  updateWatchItem(workspaceId: string, itemId: string, input: UpdateWatchItemInput): Promise<WatchItem> {
    return this.request("PATCH", `/workspaces/${workspaceId}/markets/watchlist/${itemId}`, input, watchItemSchema);
  }

  async deleteWatchItem(workspaceId: string, itemId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/markets/watchlist/${itemId}`, undefined, z.unknown());
  }

  listInvestmentTrades(workspaceId: string, mode?: TradeMode): Promise<InvestmentTrade[]> {
    return this.request("GET", `/workspaces/${workspaceId}/markets/trades${mode ? `?mode=${mode}` : ""}`, undefined, z.array(investmentTradeSchema));
  }

  compassEngine(workspaceId: string, action: "status" | "start" | "stop" = "status"): Promise<CompassEngineStatus> {
    return action === "status"
      ? this.request("GET", `/workspaces/${workspaceId}/markets/engine`, undefined, compassEngineStatusSchema)
      : this.request("POST", `/workspaces/${workspaceId}/markets/engine/${action}`, {}, compassEngineStatusSchema);
  }

  /** Запрос к движку Compass через прокси ORION. `apiPath` — путь движка, начиная с `/api/…`. */
  compassRequest(workspaceId: string, method: string, apiPath: string, body?: unknown): Promise<unknown> {
    return this.request(method, `/workspaces/${workspaceId}/markets/engine${apiPath}`, body, z.unknown());
  }

  syncCompassJournal(workspaceId: string): Promise<CompassJournalSyncResult> {
    return this.request("POST", `/workspaces/${workspaceId}/markets/engine/sync-journal`, {}, compassJournalSyncResultSchema);
  }

  importInvestmentTrades(workspaceId: string, input: TradeImportInput): Promise<TradeImportResult> {
    return this.request("POST", `/workspaces/${workspaceId}/markets/trades/import`, input, tradeImportResultSchema);
  }

  recordTradeFee(workspaceId: string, tradeId: string, input: RecordTradeFeeInput): Promise<InvestmentTrade> {
    return this.request("POST", `/workspaces/${workspaceId}/markets/trades/${tradeId}/fee`, input, investmentTradeSchema);
  }

  async deleteInvestmentTrade(workspaceId: string, tradeId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/markets/trades/${tradeId}`, undefined, z.unknown());
  }

  listObligations(workspaceId: string): Promise<Obligation[]> {
    return this.request("GET", `/workspaces/${workspaceId}/finance/obligations`, undefined, z.array(obligationSchema));
  }

  createObligation(workspaceId: string, input: CreateObligationInput): Promise<Obligation> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/obligations`, input, obligationSchema);
  }

  updateObligation(workspaceId: string, obligationId: string, input: UpdateObligationInput): Promise<Obligation> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/obligations/${obligationId}`, input, obligationSchema);
  }

  async deleteObligation(workspaceId: string, obligationId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/obligations/${obligationId}`, undefined, z.unknown());
  }

  /** Records the payment as a real transaction and moves the plan on (a repeat for the same due date is a 409). */
  payObligation(workspaceId: string, obligationId: string, input: PayObligationInput): Promise<{ obligation: Obligation; transaction: Transaction }> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/finance/obligations/${obligationId}/pay`,
      input,
      z.object({ obligation: obligationSchema, transaction: transactionSchema })
    );
  }

  /** Batch import into one account; `dryRun: true` (the default) only reports what would happen. */
  importTransactions(workspaceId: string, input: FinanceImportInput): Promise<FinanceImportResult> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/transactions/import`, input, financeImportResultSchema);
  }

  updateTransaction(workspaceId: string, transactionId: string, input: UpdateTransactionInput): Promise<Transaction> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/transactions/${transactionId}`, input, transactionSchema);
  }

  async deleteTransaction(workspaceId: string, transactionId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/transactions/${transactionId}`, undefined, z.unknown());
  }

  listBudgets(workspaceId: string, month?: string): Promise<Budget[]> {
    const query = buildQuery({ month });
    return this.request("GET", `/workspaces/${workspaceId}/finance/budgets${query}`, undefined, z.array(budgetSchema));
  }

  createBudget(workspaceId: string, input: CreateBudgetInput): Promise<Budget> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/budgets`, input, budgetSchema);
  }

  updateBudget(workspaceId: string, budgetId: string, input: UpdateBudgetInput): Promise<Budget> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/budgets/${budgetId}`, input, budgetSchema);
  }

  async deleteBudget(workspaceId: string, budgetId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/budgets/${budgetId}`, undefined, z.unknown());
  }

  listRecurringTransactions(workspaceId: string): Promise<RecurringTransaction[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/finance/recurring`,
      undefined,
      z.array(recurringTransactionSchema)
    );
  }

  createRecurringTransaction(workspaceId: string, input: CreateRecurringTransactionInput): Promise<RecurringTransaction> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/recurring`, input, recurringTransactionSchema);
  }

  updateRecurringTransaction(
    workspaceId: string,
    recurringId: string,
    input: UpdateRecurringTransactionInput
  ): Promise<RecurringTransaction> {
    return this.request(
      "PATCH",
      `/workspaces/${workspaceId}/finance/recurring/${recurringId}`,
      input,
      recurringTransactionSchema
    );
  }

  async deleteRecurringTransaction(workspaceId: string, recurringId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/recurring/${recurringId}`, undefined, z.unknown());
  }

  getMonthlyFinanceSummary(workspaceId: string, months: number): Promise<MonthlyFinanceSummary[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/finance/reports/monthly?months=${months}`,
      undefined,
      z.array(monthlyFinanceSummarySchema)
    );
  }

  getCategoryBreakdown(
    workspaceId: string,
    opts: { month?: string; from?: string; to?: string }
  ): Promise<CategoryBreakdownEntry[]> {
    const query = buildQuery(opts);
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/finance/reports/categories${query}`,
      undefined,
      z.array(categoryBreakdownEntrySchema)
    );
  }

  listCategoryRules(workspaceId: string): Promise<CategoryRule[]> {
    return this.request("GET", `/workspaces/${workspaceId}/finance/category-rules`, undefined, z.array(categoryRuleSchema));
  }

  createCategoryRule(workspaceId: string, input: CreateCategoryRuleInput): Promise<CategoryRule> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/category-rules`, input, categoryRuleSchema);
  }

  async deleteCategoryRule(workspaceId: string, ruleId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/category-rules/${ruleId}`, undefined, z.unknown());
  }

  listGoals(workspaceId: string, includeArchived = false): Promise<SavingsGoal[]> {
    const query = buildQuery({ includeArchived: includeArchived ? "true" : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/finance/goals${query}`, undefined, z.array(savingsGoalSchema));
  }

  createGoal(workspaceId: string, input: CreateSavingsGoalInput): Promise<SavingsGoal> {
    return this.request("POST", `/workspaces/${workspaceId}/finance/goals`, input, savingsGoalSchema);
  }

  updateGoal(workspaceId: string, goalId: string, input: UpdateSavingsGoalInput): Promise<SavingsGoal> {
    return this.request("PATCH", `/workspaces/${workspaceId}/finance/goals/${goalId}`, input, savingsGoalSchema);
  }

  async deleteGoal(workspaceId: string, goalId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/finance/goals/${goalId}`, undefined, z.unknown());
  }

  getSyncRemote(workspaceId: string): Promise<SyncRemote | null> {
    return this.request("GET", `/workspaces/${workspaceId}/sync/remote`, undefined, syncRemoteSchema.nullable());
  }

  putSyncRemote(workspaceId: string, input: SyncRemoteInput): Promise<SyncRemote> {
    return this.request("PUT", `/workspaces/${workspaceId}/sync/remote`, input, syncRemoteSchema);
  }

  testSyncRemote(workspaceId: string): Promise<SyncRemoteTestResult> {
    return this.request("POST", `/workspaces/${workspaceId}/sync/remote/test`, undefined, syncRemoteTestResultSchema);
  }

  runBackup(workspaceId: string): Promise<BackupResult> {
    return this.request("POST", `/workspaces/${workspaceId}/sync/backup`, undefined, backupResultSchema);
  }

  listBackups(workspaceId: string): Promise<BackupRef[]> {
    return this.request("GET", `/workspaces/${workspaceId}/sync/backups`, undefined, z.array(backupRefSchema));
  }

  restoreBackup(workspaceId: string, input: RestoreInput): Promise<RestorePreview> {
    return this.request("POST", `/workspaces/${workspaceId}/sync/restore`, input, restorePreviewSchema);
  }

  // --- Profile & sessions (v0.14) ------------------------------------------
  // `/auth/me` has always been here; the rest of the identity surface (rename,
  // password change, the device list) was API-only until v0.14.

  updateProfile(input: UpdateProfileInput): Promise<SessionUser> {
    return this.request("PATCH", "/auth/profile", input, sessionUserSchema);
  }

  changePassword(input: ChangePasswordInput): Promise<SessionUser> {
    return this.request("POST", "/auth/change-password", input, sessionUserSchema);
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.request("GET", "/auth/sessions", undefined, z.array(sessionInfoSchema));
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/auth/sessions/${encodeURIComponent(sessionId)}`, undefined, z.unknown());
  }

  // --- Projects (v0.14) ----------------------------------------------------
  // A project is what a task's free-form `projectTag` grew into (the v0.14
  // migration backfills every existing tag into a real row). Notes, tasks,
  // events, documents and finance transactions can all point at one.

  listProjects(workspaceId: string, archived = false): Promise<Project[]> {
    const query = archived ? "?archived=true" : "";
    return this.request("GET", `/workspaces/${workspaceId}/projects${query}`, undefined, z.array(projectSchema));
  }

  getProject(workspaceId: string, projectId: string): Promise<ProjectDetail> {
    return this.request("GET", `/workspaces/${workspaceId}/projects/${projectId}`, undefined, projectDetailSchema);
  }

  createProject(workspaceId: string, input: CreateProjectInput): Promise<Project> {
    return this.request("POST", `/workspaces/${workspaceId}/projects`, input, projectSchema);
  }

  updateProject(workspaceId: string, projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.request("PATCH", `/workspaces/${workspaceId}/projects/${projectId}`, input, projectSchema);
  }

  /** Archiving is the delete: the route sets `archivedAt` and returns the project, so history stays readable. */
  archiveProject(workspaceId: string, projectId: string): Promise<Project> {
    return this.request("DELETE", `/workspaces/${workspaceId}/projects/${projectId}`, undefined, projectSchema);
  }

  // --- Вехи / план проекта (v0.27) ------------------------------------------
  // Second level of the Gantt (tasks are the first) — see milestone.ts. Gated
  // by the "projects" module, not a module of its own.

  listMilestones(workspaceId: string, projectId?: string): Promise<Milestone[]> {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return this.request("GET", `/workspaces/${workspaceId}/milestones${query}`, undefined, z.array(milestoneSchema));
  }

  createMilestone(workspaceId: string, input: CreateMilestoneInput): Promise<Milestone> {
    return this.request("POST", `/workspaces/${workspaceId}/milestones`, input, milestoneSchema);
  }

  updateMilestone(workspaceId: string, milestoneId: string, input: UpdateMilestoneInput): Promise<Milestone> {
    return this.request("PATCH", `/workspaces/${workspaceId}/milestones/${milestoneId}`, input, milestoneSchema);
  }

  /** S14a — read-only cascade preview: which other milestones a date edit would also push forward, before the PATCH above commits it. */
  previewMilestoneReschedule(
    workspaceId: string,
    milestoneId: string,
    input: MilestoneReschedulePreviewInput
  ): Promise<MilestoneCascadeImpact[]> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/milestones/${milestoneId}/reschedule-preview`,
      input,
      z.array(milestoneCascadeImpactSchema)
    );
  }

  async deleteMilestone(workspaceId: string, milestoneId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/milestones/${milestoneId}`, undefined, z.unknown());
  }

  // --- Inbox (v0.14) -------------------------------------------------------
  // Quick capture that lands in one place and is later "processed" into a real
  // task, note or event — `processInboxItem` decides which.

  /** `totalCount` may exceed `items.length` — the server caps at `limit` (250 active / 100 history), see `InboxList`. */
  listInbox(workspaceId: string, history = false): Promise<InboxList> {
    const query = history ? "?history=true" : "";
    return this.request("GET", `/workspaces/${workspaceId}/inbox${query}`, undefined, inboxListSchema);
  }

  captureInboxItem(workspaceId: string, input: CaptureInboxInput): Promise<InboxItem> {
    return this.request("POST", `/workspaces/${workspaceId}/inbox`, input, inboxItemSchema);
  }

  processInboxItem(workspaceId: string, itemId: string, input: ProcessInboxInput): Promise<InboxItem> {
    return this.request("POST", `/workspaces/${workspaceId}/inbox/${itemId}/process`, input, inboxItemSchema);
  }

  async deleteInboxItem(workspaceId: string, itemId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/inbox/${itemId}`, undefined, z.unknown());
  }

  // --- Notification centre (v0.14) ----------------------------------------
  // Distinct from `notifications/check-due`: this is the in-app list the bell
  // reads, not the cron trigger.

  listNotifications(workspaceId: string, unreadOnly = false): Promise<Notification[]> {
    const query = unreadOnly ? "?unread=true" : "";
    return this.request("GET", `/workspaces/${workspaceId}/notifications${query}`, undefined, z.array(notificationSchema));
  }

  markNotificationRead(workspaceId: string, notificationId: string, read = true): Promise<Notification> {
    const action = read ? "read" : "unread";
    return this.request("PATCH", `/workspaces/${workspaceId}/notifications/${notificationId}/${action}`, undefined, notificationSchema);
  }

  markAllNotificationsRead(workspaceId: string): Promise<{ updated: number }> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/notifications/read-all`,
      undefined,
      z.object({ updated: z.number().int() })
    );
  }

  async deleteNotification(workspaceId: string, notificationId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/notifications/${notificationId}`, undefined, z.unknown());
  }

  // --- Global search & typed links (v0.14) --------------------------------

  search(workspaceId: string, query: string): Promise<GlobalSearchResult[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`,
      undefined,
      z.array(globalSearchResultSchema)
    );
  }

  listEntityLinks(workspaceId: string, type: SearchableEntityType, id: string, cursor?: string): Promise<EntityLinkPage> {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/links?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}${cursorParam}`,
      undefined,
      entityLinkPageSchema
    );
  }

  createEntityLink(workspaceId: string, input: CreateEntityLinkInput): Promise<EntityLink> {
    return this.request("POST", `/workspaces/${workspaceId}/links`, input, entityLinkSchema);
  }

  async deleteEntityLink(workspaceId: string, linkId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/links/${linkId}`, undefined, z.unknown());
  }

  /** U03 Часть 1: create a task/note AND link it to `target` in one atomic server transaction. */
  createAndLink(workspaceId: string, input: CreateAndLinkInput): Promise<CreateAndLinkResult> {
    return this.request("POST", `/workspaces/${workspaceId}/create-and-link`, input, createAndLinkResultSchema);
  }

  // --- Personal entity reminders (U03) ------------------------------------

  listReminders(workspaceId: string): Promise<EntityReminder[]> {
    return this.request("GET", `/workspaces/${workspaceId}/reminders`, undefined, z.array(entityReminderSchema));
  }

  createReminder(workspaceId: string, input: CreateEntityReminderInput): Promise<EntityReminder> {
    return this.request("POST", `/workspaces/${workspaceId}/reminders`, input, entityReminderSchema);
  }

  cancelReminder(workspaceId: string, reminderId: string): Promise<EntityReminder> {
    return this.request("PATCH", `/workspaces/${workspaceId}/reminders/${reminderId}`, {}, entityReminderSchema);
  }

  // --- Preferences (v0.14, user-scoped: not under /workspaces) -----------

  getPreferences(): Promise<UserPreference> {
    return this.request("GET", "/settings/preferences", undefined, userPreferenceSchema);
  }

  updatePreferences(input: UpdateUserPreferenceInput): Promise<UserPreference> {
    return this.request("PATCH", "/settings/preferences", input, userPreferenceSchema);
  }

  // --- Workspace organization: spheres + favorites (U05, user-scoped) ----

  getWorkspaceOrganization(): Promise<WorkspaceOrganization> {
    return this.request("GET", "/settings/organization", undefined, workspaceOrganizationSchema);
  }

  createSphere(input: CreateSphereInput): Promise<WorkspaceOrganization> {
    return this.request("POST", "/settings/organization/spheres", input, workspaceOrganizationSchema);
  }

  updateSphere(sphereId: string, input: UpdateSphereInput): Promise<WorkspaceOrganization> {
    return this.request("PATCH", `/settings/organization/spheres/${sphereId}`, input, workspaceOrganizationSchema);
  }

  deleteSphere(sphereId: string): Promise<WorkspaceOrganization> {
    return this.request("DELETE", `/settings/organization/spheres/${sphereId}`, undefined, workspaceOrganizationSchema);
  }

  assignWorkspaceSphere(input: AssignWorkspaceSphereInput): Promise<WorkspaceOrganization> {
    return this.request("PUT", "/settings/organization/workspace-sphere", input, workspaceOrganizationSchema);
  }

  setWorkspaceFavorite(workspaceId: string, favorite: boolean): Promise<WorkspaceOrganization> {
    return this.request(
      "PUT",
      `/settings/organization/favorites/${workspaceId}`,
      { favorite },
      workspaceOrganizationSchema
    );
  }

  // --- Saved task views (v0.14) -------------------------------------------

  listTaskViews(workspaceId: string): Promise<SavedTaskView[]> {
    return this.request("GET", `/workspaces/${workspaceId}/tasks/views`, undefined, z.array(savedTaskViewSchema));
  }

  createTaskView(workspaceId: string, input: CreateSavedTaskViewInput): Promise<SavedTaskView> {
    return this.request("POST", `/workspaces/${workspaceId}/tasks/views`, input, savedTaskViewSchema);
  }

  async deleteTaskView(workspaceId: string, viewId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/tasks/views/${viewId}`, undefined, z.unknown());
  }

  // --- External calendars (v0.14, inbound ICS) ---------------------------
  // Read-only import of a remote feed. The outbound feed (`calendarFeedInfo` /
  // `rotateCalendarFeed`) is the mirror image of this and lives above.

  listCalendarConnections(workspaceId: string): Promise<CalendarConnection[]> {
    return this.request("GET", `/workspaces/${workspaceId}/calendar-connections`, undefined, z.array(calendarConnectionSchema));
  }

  createCalendarConnection(workspaceId: string, input: CalendarConnectionInput): Promise<CalendarConnection> {
    return this.request("POST", `/workspaces/${workspaceId}/calendar-connections`, input, calendarConnectionSchema);
  }

  updateCalendarConnection(workspaceId: string, id: string, input: CalendarConnectionInput): Promise<CalendarConnection> {
    return this.request("PATCH", `/workspaces/${workspaceId}/calendar-connections/${id}`, input, calendarConnectionSchema);
  }

  syncCalendarConnection(workspaceId: string, id: string): Promise<{ imported: number }> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/calendar-connections/${id}/sync`,
      undefined,
      z.object({ imported: z.number().int() })
    );
  }

  async deleteCalendarConnection(workspaceId: string, id: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/calendar-connections/${id}`, undefined, z.unknown());
  }

  // --- Учёт времени (v0.18) -----------------------------------------------
  // An entry with `endedAt === null` is a running timer and there is at most
  // one per workspace (a partial unique index in the DB). Duration is never
  // stored: both sides derive it with `entryMinutes`, so a ticking panel needs
  // no writes — only the client's own 1-second interval.

  /**
   * A cursor page of entries, newest first. `from`/`to` are ISO instants;
   * pass the previous page's `nextCursor` back as `cursor` to continue — see
   * `TimeEntryPage`. Use `timeEntriesSummary` for exact totals instead of
   * summing pages (S15: the old flat array response silently truncated past
   * 500 rows with no way to page further or know the real total).
   */
  listTimeEntries(
    workspaceId: string,
    filters?: { from?: string; to?: string; taskId?: string; projectId?: string; cursor?: string; limit?: number }
  ): Promise<TimeEntryPage> {
    const query = buildQuery(filters);
    return this.request("GET", `/workspaces/${workspaceId}/time${query}`, undefined, timeEntryPageSchema);
  }

  /** Server-side aggregate total for the same filter set `listTimeEntries` takes — exact at any row count. */
  timeEntriesSummary(
    workspaceId: string,
    filters?: { from?: string; to?: string; taskId?: string; projectId?: string }
  ): Promise<TimeSummary> {
    const query = buildQuery(filters);
    return this.request("GET", `/workspaces/${workspaceId}/time/summary${query}`, undefined, timeSummarySchema);
  }

  /**
   * The running entry, or `null` if there is none. NestJS answers "nothing is
   * running" with `200` and an empty body — `safeJson` maps that to `null`, so
   * the nullable schema parses it (see its doc comment).
   */
  runningTimeEntry(workspaceId: string): Promise<TimeEntry | null> {
    return this.request("GET", `/workspaces/${workspaceId}/time/running`, undefined, timeEntrySchema.nullable());
  }

  /** Starts a new running entry. `409` when a timer is already running in this workspace. */
  startTimer(workspaceId: string, input: StartTimerInput): Promise<TimeEntry> {
    return this.request("POST", `/workspaces/${workspaceId}/time/start`, input, timeEntrySchema);
  }

  /** Stops the running entry — `404` when there is nothing to stop, `400` when `at` is not after its start. */
  stopTimer(workspaceId: string, input: StopTimerInput = {}): Promise<TimeEntry> {
    return this.request("POST", `/workspaces/${workspaceId}/time/stop`, input, timeEntrySchema);
  }

  /** A manual entry for work already done ("вчера с 10 до 12"). */
  createTimeEntry(workspaceId: string, input: CreateTimeEntryInput): Promise<TimeEntry> {
    return this.request("POST", `/workspaces/${workspaceId}/time`, input, timeEntrySchema);
  }

  updateTimeEntry(workspaceId: string, entryId: string, input: UpdateTimeEntryInput): Promise<TimeEntry> {
    return this.request("PATCH", `/workspaces/${workspaceId}/time/${entryId}`, input, timeEntrySchema);
  }

  async deleteTimeEntry(workspaceId: string, entryId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/time/${entryId}`, undefined, z.unknown());
  }

  // --- Привычки (v0.19) ----------------------------------------------------
  // A habit is a weekly intention plus one tick per calendar day. The per-habit
  // numbers (`streak`, `dueToday`, `doneToday`) are computed by the server from
  // the tick history with the helpers in `@orion/shared-types`; the client shows
  // them and never re-derives them, so the two can't disagree.

  listHabits(workspaceId: string, includeArchived = false, today?: string): Promise<Habit[]> {
    const query = buildQuery({
      includeArchived: includeArchived ? "true" : undefined,
      // The caller's own calendar day. The API's default is its UTC day, which
      // would be the wrong "today" for `dueToday` and for the streak anchor for
      // anyone east or west of UTC for part of the day (see habit.ts).
      today
    });
    return this.request("GET", `/workspaces/${workspaceId}/habits${query}`, undefined, z.array(habitSchema));
  }

  /** Ticks of the workspace, oldest day first. `from`/`to` are `YYYY-MM-DD` days; the server caps the list at 5000 rows. */
  listHabitEntries(workspaceId: string, filters?: { from?: string; to?: string }): Promise<HabitEntry[]> {
    const query = buildQuery(filters);
    return this.request("GET", `/workspaces/${workspaceId}/habits/entries${query}`, undefined, z.array(habitEntrySchema));
  }

  createHabit(workspaceId: string, input: CreateHabitInput): Promise<Habit> {
    return this.request("POST", `/workspaces/${workspaceId}/habits`, input, habitSchema);
  }

  updateHabit(workspaceId: string, habitId: string, input: UpdateHabitInput): Promise<Habit> {
    return this.request("PATCH", `/workspaces/${workspaceId}/habits/${habitId}`, input, habitSchema);
  }

  /**
   * Archiving is the delete (same choice as projects): the row keeps every tick
   * it ever had and comes back with `updateHabit(…, { archivedAt: null })`.
   */
  archiveHabit(workspaceId: string, habitId: string): Promise<Habit> {
    return this.request("DELETE", `/workspaces/${workspaceId}/habits/${habitId}`, undefined, habitSchema);
  }

  /**
   * Tick or untick one day — the server's `toggle` is idempotent per
   * `(habitId, day)`. Without `day` it falls back to *its own* UTC day, so the
   * panel always passes `habitLocalDayKey()`; see `habit.ts` on why the two are
   * different questions.
   */
  toggleHabit(workspaceId: string, habitId: string, input: ToggleHabitInput = {}): Promise<ToggleHabitResult> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/habits/${habitId}/toggle`,
      input,
      toggleHabitResultSchema
    );
  }

  // --- Списки -----------------------------------------------------------
  // A list is a name plus a small set of checkable items, always fetched and
  // shown together (unlike habits/entries, there's no separate flat endpoint).

  listLists(workspaceId: string, includeArchived = false): Promise<List[]> {
    const query = buildQuery({ includeArchived: includeArchived ? "true" : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/lists${query}`, undefined, z.array(listSchema));
  }

  createList(workspaceId: string, input: CreateListInput): Promise<List> {
    return this.request("POST", `/workspaces/${workspaceId}/lists`, input, listSchema);
  }

  updateList(workspaceId: string, listId: string, input: UpdateListInput): Promise<List> {
    return this.request("PATCH", `/workspaces/${workspaceId}/lists/${listId}`, input, listSchema);
  }

  /** Archiving is the delete (same choice as habits): items stay and come back with `updateList(…, { archivedAt: null })`. */
  archiveList(workspaceId: string, listId: string): Promise<List> {
    return this.request("DELETE", `/workspaces/${workspaceId}/lists/${listId}`, undefined, listSchema);
  }

  createListItem(workspaceId: string, listId: string, input: CreateListItemInput): Promise<ListItem> {
    return this.request("POST", `/workspaces/${workspaceId}/lists/${listId}/items`, input, listItemSchema);
  }

  /** Also used to toggle `checked` — one endpoint for both label edits and the checkbox. */
  updateListItem(workspaceId: string, listId: string, itemId: string, input: UpdateListItemInput): Promise<ListItem> {
    return this.request("PATCH", `/workspaces/${workspaceId}/lists/${listId}/items/${itemId}`, input, listItemSchema);
  }

  async deleteListItem(workspaceId: string, listId: string, itemId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/lists/${listId}/items/${itemId}`, undefined, z.unknown());
  }

  /** Deletes every checked item in the list at once. */
  async clearCheckedItems(workspaceId: string, listId: string): Promise<void> {
    await this.request("POST", `/workspaces/${workspaceId}/lists/${listId}/items/clear-checked`, undefined, z.unknown());
  }

  // --- Склад (v0.26) --------------------------------------------------------
  // `balance`/`avgCostMinor` on InventoryItem are computed server-side from
  // the movement ledger — the client shows them and never re-derives them.

  listInventoryItems(workspaceId: string, includeArchived = false): Promise<InventoryItem[]> {
    const query = buildQuery({ includeArchived: includeArchived ? "true" : undefined });
    return this.request("GET", `/workspaces/${workspaceId}/inventory/items${query}`, undefined, z.array(inventoryItemSchema));
  }

  createInventoryItem(workspaceId: string, input: CreateInventoryItemInput): Promise<InventoryItem> {
    return this.request("POST", `/workspaces/${workspaceId}/inventory/items`, input, inventoryItemSchema);
  }

  updateInventoryItem(workspaceId: string, itemId: string, input: UpdateInventoryItemInput): Promise<InventoryItem> {
    return this.request("PATCH", `/workspaces/${workspaceId}/inventory/items/${itemId}`, input, inventoryItemSchema);
  }

  /** Archiving is the delete (same choice as habits/projects): the movement ledger stays and comes back with `updateInventoryItem(…, { archivedAt: null })`. */
  archiveInventoryItem(workspaceId: string, itemId: string): Promise<InventoryItem> {
    return this.request("DELETE", `/workspaces/${workspaceId}/inventory/items/${itemId}`, undefined, inventoryItemSchema);
  }

  /** Ledger for one item, newest first — the server caps it at 500 rows. */
  listInventoryMovements(workspaceId: string, itemId: string): Promise<InventoryMovement[]> {
    return this.request(
      "GET",
      `/workspaces/${workspaceId}/inventory/items/${itemId}/movements`,
      undefined,
      z.array(inventoryMovementSchema)
    );
  }

  recordInventoryMovement(workspaceId: string, itemId: string, input: CreateInventoryMovementInput): Promise<InventoryMovement> {
    return this.request(
      "POST",
      `/workspaces/${workspaceId}/inventory/items/${itemId}/movements`,
      input,
      inventoryMovementSchema
    );
  }

  // --- System info (v0.14) -------------------------------------------------

  getAppInfo(): Promise<AppInfo> {
    return this.request("GET", "/system/info", undefined, appInfoSchema);
  }

  /** S05 — public, unauthenticated; used by login/register to gate account-picker/PIN UI. */
  getOrionMode(): Promise<OrionModeInfo> {
    return this.request("GET", "/system/mode", undefined, orionModeInfoSchema);
  }

  getHealth(): Promise<{ status: string; database: string; timestamp: string }> {
    return this.request(
      "GET",
      "/system/health",
      undefined,
      z.object({ status: z.string(), database: z.string(), timestamp: z.string() })
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    isRetry = false
  ): Promise<T> {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const token = await this.options.tokenStore.get();
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        // For FormData the browser sets `Content-Type` (incl. the multipart
        // boundary) itself — setting it here would break the request.
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 401 && !isRetry && !AUTH_ENDPOINTS_WITHOUT_RETRY.has(path)) {
        try {
          await this.refreshAccessToken();
        } catch {
          await this.options.tokenStore.clear();
          const payload = await safeJson(response);
          throw new ApiError(response.status, extractMessage(payload) ?? response.statusText, payload);
        }
        return this.request(method, path, body, schema, true);
      }

      const payload = await safeJson(response);
      throw new ApiError(response.status, extractMessage(payload) ?? response.statusText, payload);
    }

    if (response.status === 204) {
      return schema.parse(undefined);
    }

    const json = await safeJson(response);
    return schema.parse(json);
  }

  /**
   * Like `request`, but returns the raw response body as a `Blob` instead of
   * parsing JSON — for binary downloads (see `getDocumentBlob`). Shares the
   * same `401 → /auth/refresh → retry once` behaviour.
   */
  private async requestBlob(method: string, path: string, isRetry = false): Promise<Blob> {
    const token = await this.options.tokenStore.get();
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) {
      if (response.status === 401 && !isRetry && !AUTH_ENDPOINTS_WITHOUT_RETRY.has(path)) {
        try {
          await this.refreshAccessToken();
        } catch {
          await this.options.tokenStore.clear();
          const payload = await safeJson(response);
          throw new ApiError(response.status, extractMessage(payload) ?? response.statusText, payload);
        }
        return this.requestBlob(method, path, true);
      }
      const payload = await safeJson(response);
      throw new ApiError(response.status, extractMessage(payload) ?? response.statusText, payload);
    }

    return response.blob();
  }

  /** Rotates the refresh token and stores the new pair. Concurrent callers share one in-flight request. */
  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      const refreshToken = await this.options.tokenStore.getRefreshToken();
      if (!refreshToken) {
        throw new ApiError(401, "Нет refresh-токена");
      }
      const data = await this.request<AuthResponse>(
        "POST",
        "/auth/refresh",
        { refreshToken },
        authResponseSchema
      );
      await this.options.tokenStore.setPair(data.accessToken, data.refreshToken);
      return data.accessToken;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

/** Builds `?a=1&b=2` from the defined entries of `params`, `""` if none — for the finance list filters (accountId/categoryId/month). */
function buildQuery(params: Record<string, string | number | undefined> | undefined): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined
  );
  if (entries.length === 0) return "";
  return `?${entries.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`).join("&")}`;
}

/**
 * Parses a response body as JSON.
 *
 * An **empty** body means JSON `null`, not `undefined`: NestJS answers a
 * handler that returned `null` with `200` and no body at all, so endpoints
 * typed `T | null` (nobody's running timer, an unconfigured sync remote) are
 * indistinguishable from "nothing" at the wire level. Mapping it to `null` is
 * what lets `xSchema.nullable()` parse the response instead of throwing on
 * `undefined` — a latent bug this helper had until v0.18, when a live
 * integration test finally exercised such an endpoint.
 */
async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message;
    return typeof message === "string" ? message : JSON.stringify(message);
  }
  return undefined;
}
