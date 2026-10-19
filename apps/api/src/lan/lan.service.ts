import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  LAN_DEVICE_TOKEN_HEADER,
  LAN_PAIR_SECRET_HEADER,
  LAN_PROTOCOL_VERSION,
  LAN_REMOTE_PREFIX,
  type LanClientConnectInput,
  type LanClientPairing,
  type LanClientStatus,
  type LanDevice,
  type LanDiscoveredNode,
  type LanEnableHostInput,
  type LanSetLoginPolicyInput,
  type LanHostStatus,
  type LanNodeCard,
  type LanPairRequestCreated,
  type LanPairStatus,
  type LanPendingPair,
  type LanPinAccount
} from "@orion/shared-types";
import { passwordScore } from "../auth/auth.service";
import { PrismaService } from "../common/prisma.service";
import { DeviceStore } from "./device-store";
import { firewallState, openFirewall, closeFirewall } from "./firewall";
import { discoverNodes, MdnsAdvertiser } from "./mdns";
import {
  clearClientBinding,
  lanAddresses,
  loadClientBinding,
  loadNodeConfig,
  nodeDir,
  saveClientBinding,
  saveNodeConfig,
  type LanClientBinding,
  type LanNodeConfig
} from "./node-config";
import { computePairingCode } from "./pairing-code";
import { PairingRegistry } from "./pairing-registry";
import { observeCertificate, pinnedJson } from "./pinned-request";
import { loadOrIssueHostCertificate, type IssuedCertificate } from "./self-signed-cert";

/** Код выхода, по которому лаунчер понимает «перезапусти меня с новым режимом» (а не «упал»). */
export const RESTART_EXIT_CODE = 75;

interface ClientPairing {
  id: string;
  address: string;
  port: number;
  certPem: string;
  fingerprint: string;
  card: LanNodeCard;
  requestId: string;
  clientNonce: string;
  code: string;
  deviceName: string;
  status: LanClientPairing["status"];
  message: string | null;
}

const HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

@Injectable()
export class LanService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("lan");
  private readonly dir = nodeDir();
  private config: LanNodeConfig = loadNodeConfig(this.dir);
  /** Режим применён к процессу (bind/TLS/доверие), а не только записан в настройках. */
  readonly active = process.env.ORION_LAN_HOST === "1";
  readonly devices = new DeviceStore(this.dir);
  private cert: IssuedCertificate | null = null;
  private readonly mdns = new MdnsAdvertiser();
  private readonly pairings = new Map<string, ClientPairing>();
  private linkState: "online" | "offline" | "revoked" | "none" = "none";
  readonly registry = new PairingRegistry(this.devices, () => this.cert?.fingerprint ?? "");

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!this.active) return;
    this.cert = this.ensureCertificate();
    try {
      this.mdns.start({ name: this.config.name, nodeId: this.config.nodeId, fingerprint: this.cert.fingerprint, port: this.config.port });
    } catch (error) {
      // Без multicast (VPN, строгий роутер) остаётся ручной ввод адреса — это не причина падать.
      this.log.warn(`mDNS не запущен: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  onModuleDestroy(): void {
    this.mdns.stop();
  }

  // ───────── общее ─────────

  private ensureCertificate(): IssuedCertificate {
    this.cert ??= loadOrIssueHostCertificate(path.join(this.dir, "lan-tls"), this.config.name, lanAddresses());
    return this.cert;
  }

  /** PEM+ключ для HTTPS-слушателя (main.ts). */
  tlsCredentials(): { key: string; cert: string; port: number } {
    const cert = this.ensureCertificate();
    return { key: cert.keyPem, cert: cert.certPem, port: this.config.port };
  }

  card(): LanNodeCard {
    if (!this.active) throw new NotFoundException();
    return { protocol: LAN_PROTOCOL_VERSION, nodeId: this.config.nodeId, name: this.config.name, fingerprint: this.ensureCertificate().fingerprint };
  }

  /** Владелец узла: тот, кто включил режим. До включения — любой локальный пользователь (он и станет владельцем). */
  isOwner(userId: string): boolean {
    return !this.config.ownerUserId || this.config.ownerUserId === userId;
  }

  private restart(): boolean {
    if (process.env.ORION_SUPERVISED !== "1") return false;
    setTimeout(() => process.exit(RESTART_EXIT_CODE), 700).unref();
    return true;
  }

  // ───────── хост ─────────

  async hostStatus(): Promise<LanHostStatus> {
    const fingerprint = this.config.mode === "host" || this.active ? this.ensureCertificate().fingerprint : "";
    return {
      mode: this.config.mode,
      nodeId: this.config.nodeId,
      name: this.config.name,
      fingerprint,
      port: this.config.port,
      addresses: lanAddresses(),
      active: this.active,
      ownerUserId: this.config.ownerUserId,
      supervised: process.env.ORION_SUPERVISED === "1",
      mdns: this.mdns.active,
      firewall: await firewallState(),
      loginPolicy: this.config.loginPolicy
    };
  }

  /** Аккаунты, которые входят по PIN: в LAN-режиме PIN отключён, им нужен пароль до включения. */
  async pinAccounts(): Promise<LanPinAccount[]> {
    const users = await this.prisma.user.findMany({ where: { unlockKind: "pin" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
    return users.map((user) => ({ userId: user.id, name: user.name }));
  }

  async enableHost(userId: string, input: LanEnableHostInput): Promise<{ restarting: boolean; status: LanHostStatus }> {
    if (this.config.mode === "client") throw new ConflictException("Устройство подключено к чужому узлу. Сначала вернитесь в режим «Локальный».");
    if (!this.isOwner(userId)) throw new ConflictException("Режимом узла управляет его владелец.");
    // Домашняя политика оставляет PIN рабочим, поэтому пароли аккаунтам с PIN нужны только при строгой.
    const pending = input.loginPolicy === "strict" ? await this.pinAccounts() : [];
    const missing = pending.filter((account) => !input.passwords[account.userId]);
    if (missing.length > 0) {
      throw new ConflictException({
        statusCode: 409,
        code: "accounts_need_password",
        message: "У части аккаунтов вход по PIN. В режиме «Хост LAN» PIN отключён — задайте им пароли.",
        accounts: missing
      });
    }
    for (const account of pending) {
      const password = input.passwords[account.userId]!;
      if (passwordScore(password) < 2) {
        throw new BadRequestException(`Пароль для «${account.name}» слишком простой: не менее 12 символов или сочетание регистра, цифр и символов`);
      }
    }
    for (const account of pending) {
      const password = input.passwords[account.userId]!;
      await this.prisma.user.update({
        where: { id: account.userId },
        data: { passwordHash: await argon2.hash(password), unlockKind: "password", passwordStrength: passwordScore(password), passwordChangedAt: new Date() }
      });
      // Старые сессии аккаунта, у которого сменили способ входа, закрываем: пароль теперь известен администратору хоста.
      await this.prisma.refreshToken.updateMany({ where: { userId: account.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    this.config = { ...this.config, name: input.name?.trim() || this.config.name, mode: "host", ownerUserId: this.config.ownerUserId ?? userId, loginPolicy: input.loginPolicy };
    saveNodeConfig(this.config, this.dir);
    this.ensureCertificate();
    return { restarting: this.restart(), status: await this.hostStatus() };
  }

  /**
   * Смена политики входа без перезапуска (политика читается на каждый запрос). Переход на строгую отключает PIN, поэтому
   * аккаунтам с PIN нужны пароли — как при включении хоста со строгой политикой.
   */
  async setLoginPolicy(userId: string, input: LanSetLoginPolicyInput): Promise<LanHostStatus> {
    if (!this.isOwner(userId)) throw new ConflictException("Режимом узла управляет его владелец.");
    if (this.config.mode !== "host") throw new ConflictException("Политика входа настраивается у хоста LAN.");
    if (input.loginPolicy === "strict") {
      const pending = await this.pinAccounts();
      const missing = pending.filter((account) => !input.passwords[account.userId]);
      if (missing.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: "accounts_need_password",
          message: "У части аккаунтов вход по PIN. При строгой политике PIN отключён — задайте им пароли.",
          accounts: missing
        });
      }
      for (const account of pending) {
        const password = input.passwords[account.userId]!;
        if (passwordScore(password) < 2) {
          throw new BadRequestException(`Пароль для «${account.name}» слишком простой: не менее 12 символов или сочетание регистра, цифр и символов`);
        }
        await this.prisma.user.update({
          where: { id: account.userId },
          data: { passwordHash: await argon2.hash(password), unlockKind: "password", passwordStrength: passwordScore(password), passwordChangedAt: new Date() }
        });
        await this.prisma.refreshToken.updateMany({ where: { userId: account.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    this.config = { ...this.config, loginPolicy: input.loginPolicy };
    saveNodeConfig(this.config, this.dir);
    return this.hostStatus();
  }

  async disableHost(userId: string): Promise<{ restarting: boolean; status: LanHostStatus }> {
    if (!this.isOwner(userId)) throw new ConflictException("Режимом узла управляет его владелец.");
    this.config = { ...this.config, mode: "local" };
    saveNodeConfig(this.config, this.dir);
    return { restarting: this.restart(), status: await this.hostStatus() };
  }

  async renameNode(name: string): Promise<LanHostStatus> {
    this.config = { ...this.config, name };
    saveNodeConfig(this.config, this.dir);
    return this.hostStatus();
  }

  listDevices(): LanDevice[] {
    return this.devices.list();
  }

  revokeDevice(id: string): void {
    if (!this.devices.revoke(id)) throw new NotFoundException("Устройство не найдено");
  }

  listPending(): LanPendingPair[] {
    return this.registry.listPending();
  }

  async openFirewall(): Promise<boolean> {
    return openFirewall(this.config.port);
  }

  async closeFirewall(): Promise<boolean> {
    return closeFirewall();
  }

  createPairRequest(input: { deviceName: string; clientNonce: string }, address: string): LanPairRequestCreated {
    if (!this.active) throw new NotFoundException();
    return this.registry.create({ ...input, address });
  }

  pairStatus(id: string, secret: string | undefined): LanPairStatus {
    if (!this.active) throw new NotFoundException();
    return this.registry.poll(id, secret);
  }

  // ───────── клиент ─────────

  binding(): LanClientBinding | null {
    return loadClientBinding(this.dir);
  }

  isClientMode(): boolean {
    return this.config.mode === "client";
  }

  noteLink(state: "online" | "offline" | "revoked"): void {
    this.linkState = state;
  }

  async discover(): Promise<LanDiscoveredNode[]> {
    return discoverNodes();
  }

  private assertAddress(address: string): void {
    if (!HOST_PATTERN.test(address) && !/^\[[0-9a-fA-F:]+\]$/.test(address)) throw new BadRequestException("Адрес должен быть именем хоста или IP-адресом без схемы и пути");
  }

  /** Подсмотреть сертификат узла и его визитку. Данные не передаются, доверие не выдаётся. */
  async probe(address: string, port: number): Promise<{ card: LanNodeCard; certPem: string }> {
    this.assertAddress(address);
    try {
      const observed = await observeCertificate(address, port);
      const response = await pinnedJson<LanNodeCard>({ address, port, certPem: observed.certPem }, "GET", "/lan/info");
      if (response.status !== 200 || !response.body?.nodeId) throw new Error("not an ORION node");
      // Визитка — слова самого узла; верим только сертификату, который сами увидели в соединении.
      return { card: { ...response.body, fingerprint: observed.fingerprint }, certPem: observed.certPem };
    } catch {
      throw new NotFoundException("Узел ORION по этому адресу не отвечает. Проверьте адрес, порт и что на хосте включён режим «Хост LAN».");
    }
  }

  async startPairing(input: LanClientConnectInput): Promise<LanClientPairing> {
    if (this.config.mode === "host") throw new ConflictException("Этот компьютер сам работает как хост. Сначала отключите режим «Хост LAN».");
    const { card, certPem } = await this.probe(input.address, input.port);
    const clientNonce = randomBytes(24).toString("base64url");
    const response = await pinnedJson<LanPairRequestCreated>({ address: input.address, port: input.port, certPem }, "POST", "/lan/pair/request", {
      body: { deviceName: input.deviceName, clientNonce }
    });
    if (response.status !== 201 && response.status !== 200) {
      const message = (response.body as { message?: string } | null)?.message ?? "Узел отклонил заявку";
      throw new ConflictException(message);
    }
    const created = response.body!;
    const pairing: ClientPairing = {
      id: randomUUID(),
      address: input.address,
      port: input.port,
      certPem,
      fingerprint: card.fingerprint,
      card,
      requestId: created.requestId,
      clientNonce,
      // Код считается из отпечатка, который клиент увидел сам, — подмена сертификата посредником даст другой код.
      code: computePairingCode(clientNonce, created.serverNonce, card.fingerprint),
      deviceName: input.deviceName,
      status: "pending",
      message: null
    };
    this.pairings.set(pairing.id, pairing);
    return this.pairingView(pairing);
  }

  private pairingView(pairing: ClientPairing): LanClientPairing {
    return { pairingId: pairing.id, code: pairing.code, node: pairing.card, status: pairing.status, message: pairing.message };
  }

  async pollPairing(id: string): Promise<LanClientPairing> {
    const pairing = this.pairings.get(id);
    if (!pairing) throw new NotFoundException("Заявка не найдена");
    if (pairing.status !== "pending") return this.pairingView(pairing);
    try {
      const response = await pinnedJson<LanPairStatus>({ address: pairing.address, port: pairing.port, certPem: pairing.certPem }, "GET", `/lan/pair/status/${pairing.requestId}`, {
        headers: { [LAN_PAIR_SECRET_HEADER]: pairing.clientNonce }
      });
      const body = response.body;
      if (response.status === 200 && body?.status === "approved" && body.deviceToken) {
        saveClientBinding(
          {
            nodeId: pairing.card.nodeId,
            name: pairing.card.name,
            address: pairing.address,
            port: pairing.port,
            fingerprint: pairing.fingerprint,
            certPem: pairing.certPem,
            deviceToken: body.deviceToken,
            pairedAt: new Date().toISOString()
          },
          this.dir
        );
        pairing.status = "approved";
        this.pairings.delete(id);
        this.linkState = "online";
      } else if (body?.status === "denied" || body?.status === "expired") {
        pairing.status = body.status;
        pairing.message = body.status === "denied" ? "Владелец узла отклонил подключение" : "Время заявки истекло";
      }
    } catch {
      pairing.message = "Узел не отвечает — повторяю…";
    }
    return this.pairingView(pairing);
  }

  activateClient(): void {
    if (this.config.mode === "host") throw new ConflictException("Сначала отключите режим «Хост LAN».");
    if (!this.binding()) throw new ConflictException("Нет подключения к узлу — сначала подтвердите устройство на хосте.");
    this.config = { ...this.config, mode: "client" };
    saveNodeConfig(this.config, this.dir);
  }

  /** Возврат в «Локальный»: привязка к хосту сохраняется, локальные данные не затрагиваются. */
  deactivateClient(): void {
    if (this.config.mode !== "client") return;
    this.config = { ...this.config, mode: "local" };
    saveNodeConfig(this.config, this.dir);
    this.linkState = "none";
  }

  forgetBinding(): void {
    this.deactivateClient();
    clearClientBinding(this.dir);
  }

  async clientStatus(): Promise<LanClientStatus> {
    const binding = this.binding();
    const paired = binding ? { nodeId: binding.nodeId, name: binding.name, address: binding.address, port: binding.port, fingerprint: binding.fingerprint } : null;
    let link = this.linkState;
    if (this.config.mode === "client" && binding) {
      try {
        const response = await pinnedJson({ address: binding.address, port: binding.port, certPem: binding.certPem }, "GET", "/lan/ping", {
          headers: { [LAN_DEVICE_TOKEN_HEADER]: binding.deviceToken },
          timeoutMs: 2500
        });
        link = response.status === 200 ? "online" : response.status === 401 || response.status === 403 ? "revoked" : "offline";
      } catch {
        link = "offline";
      }
      this.linkState = link;
    } else {
      link = "none";
    }
    return { mode: this.config.mode, paired, link, apiPath: this.config.mode === "client" ? LAN_REMOTE_PREFIX : "" };
  }
}
