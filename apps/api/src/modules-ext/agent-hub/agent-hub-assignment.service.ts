import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  agentHubAgentProfileSchema, agentHubCredentialOptionSchema, agentHubTaskAssignmentSchema,
  type AgentHubAgentProfile, type AgentHubCredentialOption, type AgentHubTaskAssignment, type AgentHubCreateAgentProfileInput,
  type AgentHubBindAgentCredentialsInput
} from "@orion/shared-types";
import { AgentCredentialReader, type AgentCredentialState } from "../../ai/public/agent-credential-reader";
import { PrismaService } from "../../common/prisma.service";
import { ModulesService } from "../../modules/modules.service";
import { TaskAgentAssignmentRegistry } from "../../tasks/public/task-agent-assignment-registry";
import { TaskIntegrationReader } from "../../tasks/public/task-integration-reader";
import { WorkspacesService } from "../../workspaces/workspaces.service";

@Injectable()
export class AgentHubAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService,
    private readonly tasks: TaskIntegrationReader,
    private readonly credentials: AgentCredentialReader,
    private readonly taskAssignments: TaskAgentAssignmentRegistry
  ) {}

  private async assertEnabledTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
  }
  private async assertLeadTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string): Promise<void> {
    await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "lead"]);
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "agent-hub");
    await this.modules.assertEnabledTx(tx, userId, workspaceId, "tasks");
  }
  private profile(row: { id: string; name: string; createdAt: Date; updatedAt: Date }, credentialStatus: AgentCredentialState): AgentHubAgentProfile {
    return agentHubAgentProfileSchema.parse({ id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), credentialStatus });
  }

  /** Existing unassigned work remains manually claimable; explicit assignments fence new claims to linked credentials. */
  async workerMayClaimTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string, tokenId: string): Promise<boolean> {
    const task = await this.tasks.referenceTx(tx, workspaceId, taskId);
    if (!task || task.assigneeId) return false;
    const assignment = await tx.agentHubTaskAssignment.findFirst({ where: { workspaceId, taskId }, select: { profileId: true } });
    if (!assignment) return true;
    const binding = await tx.agentHubAgentCredential.findFirst({ where: { workspaceId, profileId: assignment.profileId, tokenId }, select: { tokenId: true } });
    if (!binding) return false;
    return (await this.credentials.stateTx(tx, userId, workspaceId, tokenId)) === "active";
  }

  async lockTaskForWorkerClaimTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string, tokenId: string): Promise<void> {
    const task = await this.taskAssignments.lockTaskTx(tx, workspaceId, taskId);
    if (!task) throw new NotFoundException("Задача не найдена");
    if (task.assigneeId) throw new ForbiddenException("Задача назначена участнику команды");
    const assignment = await tx.agentHubTaskAssignment.findFirst({ where: { workspaceId, taskId }, select: { profileId: true } });
    if (assignment) await this.lockProfileTx(tx, workspaceId, assignment.profileId);
    if (!await this.workerMayClaimTx(tx, userId, workspaceId, taskId, tokenId)) {
      throw new ForbiddenException("Задача назначена другому профилю агента");
    }
  }

  /** Credential rebinding and worker claims share a profile lock after the common Task lock. */
  private async lockProfileTx(tx: Prisma.TransactionClient, workspaceId: string, profileId: string): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "agent_hub_agent_profiles"
      WHERE id = ${profileId} AND "workspaceId" = ${workspaceId}
      FOR UPDATE
    `;
  }

  async credentialsFor(userId: string, workspaceId: string): Promise<{ credentials: AgentHubCredentialOption[] }> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertEnabledTx(tx, userId, workspaceId);
      const credentials = (await this.credentials.listOwnedActiveTx(tx, userId, workspaceId))
        .filter(token => token.scopes.includes("agent-hub.execution.create"))
        .map(token => agentHubCredentialOptionSchema.parse({ id: token.id, name: token.name, scopes: token.scopes, expiresAt: token.expiresAt?.toISOString() ?? null }));
      return { credentials };
    });
  }

  async agentsFor(userId: string, workspaceId: string): Promise<{ agents: AgentHubAgentProfile[] }> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertEnabledTx(tx, userId, workspaceId);
      const profiles = await tx.agentHubAgentProfile.findMany({ where: { workspaceId, createdById: userId }, orderBy: { name: "asc" } });
      const available: AgentHubAgentProfile[] = [];
      for (const profile of profiles) {
        const bindings = await tx.agentHubAgentCredential.findMany({ where: { workspaceId, profileId: profile.id }, select: { tokenId: true } });
        const states: AgentCredentialState[] = [];
        for (const binding of bindings) {
          states.push(await this.credentials.stateTx(tx, userId, workspaceId, binding.tokenId));
        }
        const state = states.includes("active") ? "active" : states.includes("revoked") ? "revoked" : states.includes("expired") ? "expired" : "missing";
        available.push(this.profile(profile, state));
      }
      return { agents: available };
    });
  }

  async createAgent(userId: string, workspaceId: string, input: AgentHubCreateAgentProfileInput): Promise<AgentHubAgentProfile> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertLeadTx(tx, userId, workspaceId);
      const tokenIds = [...new Set(input.credentialIds)];
      if (tokenIds.length !== input.credentialIds.length) throw new ConflictException("Повторяющийся credential");
      const owned = await this.credentials.resolveOwnedActiveTx(tx, userId, workspaceId, tokenIds);
      const usable = owned.filter(token => token.scopes.includes("agent-hub.execution.create"));
      if (usable.length !== tokenIds.length) throw new ForbiddenException("Можно связать только собственные действующие credentials с правом tasks:read и Agent Hub");
      const existing = await tx.agentHubAgentProfile.findFirst({ where: { workspaceId, name: input.name }, select: { id: true } });
      if (existing) throw new ConflictException("Профиль с таким именем уже существует в пространстве");
      try {
        const profile = await tx.agentHubAgentProfile.create({ data: { workspaceId, name: input.name, createdById: userId } });
        await tx.agentHubAgentCredential.createMany({ data: usable.map(token => ({ workspaceId, profileId: profile.id, tokenId: token.id, createdById: userId })) });
        return this.profile(profile, "active");
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Credential уже связан с другим профилем");
        throw error;
      }
    });
  }

  async rebindAgent(userId: string, workspaceId: string, agentId: string, input: AgentHubBindAgentCredentialsInput): Promise<AgentHubAgentProfile> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertLeadTx(tx, userId, workspaceId);
      const profile = await tx.agentHubAgentProfile.findFirst({ where: { id: agentId, workspaceId, createdById: userId } });
      if (!profile) throw new NotFoundException("Профиль агента не найден");
      await this.lockProfileTx(tx, workspaceId, agentId);
      const tokenIds = [...new Set(input.credentialIds)];
      if (tokenIds.length !== input.credentialIds.length) throw new ConflictException("Повторяющийся credential");
      const owned = await this.credentials.resolveOwnedActiveTx(tx, userId, workspaceId, tokenIds);
      const usable = owned.filter(token => token.scopes.includes("agent-hub.execution.create"));
      if (usable.length !== tokenIds.length) throw new ForbiddenException("Можно связать только собственные действующие credentials с правом tasks:read и Agent Hub");
      const retainedTokenIds = new Set(usable.map(token => token.id));
      const assignments = await tx.agentHubTaskAssignment.findMany({ where: { workspaceId, profileId: agentId }, select: { taskId: true } });
      for (const assignment of assignments) {
        const activeRuns = await tx.agentHubExecution.findMany({
          where: { workspaceId, targetKind: "task", targetId: assignment.taskId, status: { in: ["claimed", "working"] } },
          select: { workerId: true }
        });
        if (activeRuns.some(run => !run.workerId || !retainedTokenIds.has(run.workerId))) {
          throw new ConflictException("Нельзя перепривязать credentials, пока задачу выполняет этот профиль; дождитесь завершения исполнения");
        }
      }
      await tx.agentHubAgentCredential.deleteMany({ where: { workspaceId, profileId: agentId } });
      try {
        await tx.agentHubAgentCredential.createMany({ data: usable.map(token => ({ workspaceId, profileId: agentId, tokenId: token.id, createdById: userId })) });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("Credential уже связан с другим профилем");
        throw error;
      }
      return this.profile(profile, "active");
    });
  }

  private async assignmentDto(tx: Prisma.TransactionClient, userId: string, workspaceId: string, taskId: string): Promise<AgentHubTaskAssignment> {
    const row = await tx.agentHubTaskAssignment.findFirst({ where: { workspaceId, taskId }, include: { profile: { select: { id: true, name: true, createdById: true } } } });
    let credentialStatus: AgentCredentialState | "unavailable" = "missing";
    if (row) {
      if (row.profile.createdById !== userId) credentialStatus = "unavailable";
      else {
        const bindings = await tx.agentHubAgentCredential.findMany({ where: { workspaceId, profileId: row.profileId }, select: { tokenId: true } });
        const states: AgentCredentialState[] = [];
        for (const binding of bindings) states.push(await this.credentials.stateTx(tx, userId, workspaceId, binding.tokenId));
        credentialStatus = states.includes("active") ? "active" : states.includes("revoked") ? "revoked" : states.includes("expired") ? "expired" : "missing";
      }
    }
    return agentHubTaskAssignmentSchema.parse({
      workspaceId, taskId, agent: row ? { id: row.profile.id, name: row.profile.name } : null,
      credentialStatus, updatedAt: (row?.updatedAt ?? new Date()).toISOString()
    });
  }

  async getAssignment(userId: string, workspaceId: string, taskId: string): Promise<AgentHubTaskAssignment> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertEnabledTx(tx, userId, workspaceId);
      if (!await this.tasks.referenceTx(tx, workspaceId, taskId)) throw new NotFoundException("Задача не найдена");
      return this.assignmentDto(tx, userId, workspaceId, taskId);
    });
  }

  async setAssignment(userId: string, workspaceId: string, taskId: string, agentId: string | null): Promise<AgentHubTaskAssignment> {
    return this.prisma.withUser(userId, async tx => {
      await this.assertLeadTx(tx, userId, workspaceId);
      const task = await this.taskAssignments.lockTaskTx(tx, workspaceId, taskId);
      if (!task) throw new NotFoundException("Задача не найдена");
      const targetCredentialIds = new Set<string>();
      if (agentId) {
        const profile = await tx.agentHubAgentProfile.findFirst({ where: { id: agentId, workspaceId, createdById: userId } });
        if (!profile) throw new NotFoundException("Профиль агента не найден");
        await this.lockProfileTx(tx, workspaceId, agentId);
        const bindings = await tx.agentHubAgentCredential.findMany({ where: { workspaceId, profileId: agentId }, select: { tokenId: true } });
        for (const binding of bindings) {
          if (await this.credentials.stateTx(tx, userId, workspaceId, binding.tokenId) === "active") targetCredentialIds.add(binding.tokenId);
        }
        if (!targetCredentialIds.size) throw new ConflictException("У профиля нет действующего credential; перепривяжите его перед назначением");
      }
      const activeRuns = await tx.agentHubExecution.findMany({
        where: { workspaceId, targetKind: "task", targetId: taskId, status: { in: ["claimed", "working"] } },
        select: { workerId: true }
      });
      if (activeRuns.some(run => !run.workerId || !targetCredentialIds.has(run.workerId))) {
        throw new ConflictException("Нельзя менять назначение, пока задачу выполняет другой профиль; дождитесь завершения исполнения");
      }
      if (agentId === null) {
        await tx.agentHubTaskAssignment.deleteMany({ where: { workspaceId, taskId } });
        return this.assignmentDto(tx, userId, workspaceId, taskId);
      }
      if (task.assigneeId) throw new ConflictException("Сначала снимите назначение участника команды");
      await tx.agentHubTaskAssignment.upsert({
        where: { workspaceId_taskId: { workspaceId, taskId } },
        create: { workspaceId, taskId, profileId: agentId, assignedById: userId },
        update: { profileId: agentId, assignedById: userId }
      });
      return this.assignmentDto(tx, userId, workspaceId, taskId);
    });
  }
}
