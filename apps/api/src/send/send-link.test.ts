import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SEND_REQUEST_HEADER, SEND_VERSION_HEADER } from "@orion/shared-types";
import { pinnedCall } from "./send-wire";
import { SendLink } from "./send-link";
import { SendSessions } from "./send-sessions";

const links: SendLink[] = [];

async function node(freeBytes?: (directory: string) => Promise<number | null>): Promise<SendLink> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-"));
  const link = new SendLink({ dir, bindHost: "127.0.0.1", advertise: false, chunkBytes: 4, freeBytes });
  await link.enable({ enabled: true, port: 0 });
  links.push(link);
  return link;
}

async function pair(from: SendLink, to: SendLink): Promise<{ fromPeer: string; toPeer: string }> {
  const started = await from.beginPair({ address: "127.0.0.1", port: to.status().port, deviceName: "Узел" });
  expect(started.status).toBe("pending");
  to.approve(started.requestId, started.code);
  const done = await from.refreshPair(started.requestId);
  expect(done.status).toBe("approved");
  const peer = to.peersView().find((item) => item.trusted && !item.revoked);
  expect(peer).toBeTruthy();
  return { fromPeer: done.peerId!, toPeer: peer!.id };
}

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

async function settle(link: SendLink, id: string, status: string, attempts = 80): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = link.transfers().find((item) => item.transferId === id);
    if (row?.status === status) return;
    if (row && ["failed", "rejected", "cancelled"].includes(row.status) && row.status !== status) {
      throw new Error(`${row.status}: ${row.error ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`таймаут, сейчас ${link.transfers().find((item) => item.transferId === id)?.status}`);
}

afterEach(async () => {
  while (links.length > 0) await links.pop()!.stop();
});

describe("Orion Send", () => {
  it("передаёт файл и папку в обе стороны и не пишет токен в устройства хоста", async () => {
    const alice = await node();
    const bob = await node();
    const first = await pair(alice, bob);
    const back = await pair(bob, alice);
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-"));
    writeTree(source, { "one.txt": "alpha", "dir/two.txt": "beta" });
    const sent = await alice.offerPaths(first.fromPeer, [path.join(source, "one.txt"), path.join(source, "dir")]);
    await settle(bob, sent.transferId, "pending");
    await bob.accept(sent.transferId);
    await settle(alice, sent.transferId, "completed");
    await settle(bob, sent.transferId, "completed");
    const inbox = bob.status().downloadDir;
    expect(fs.readFileSync(path.join(inbox, "one.txt"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(inbox, "dir", "two.txt"), "utf8")).toBe("beta");

    const reply = await bob.offerPaths(back.fromPeer, [path.join(inbox, "one.txt")]);
    await settle(alice, reply.transferId, "pending");
    await alice.accept(reply.transferId);
    await settle(bob, reply.transferId, "completed");
    expect(fs.existsSync(path.join(alice.status().downloadDir, "one.txt"))).toBe(true);
    expect(fs.existsSync(path.join(alice["dir"] as string, "lan-devices.json"))).toBe(false);
  });

  it("требует подтверждение, помнит отказ и отзыв", async () => {
    const alice = await node();
    const bob = await node();
    const started = await alice.beginPair({ address: "127.0.0.1", port: bob.status().port, deviceName: "Узел" });
    bob.deny(started.requestId);
    expect((await alice.refreshPair(started.requestId)).status).toBe("denied");

    const peers = await pair(alice, bob);
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-"));
    fs.writeFileSync(path.join(source, "a.txt"), "x");
    bob.revoke(peers.toPeer);
    const sent = await alice.offerPaths(peers.fromPeer, [path.join(source, "a.txt")]);
    await settle(alice, sent.transferId, "failed");
    expect(fs.existsSync(path.join(bob.status().downloadDir, "a.txt"))).toBe(false);
  });

  it("отклонение не сохраняет файл", async () => {
    const alice = await node();
    const bob = await node();
    const peers = await pair(alice, bob);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-")), "no.txt");
    fs.writeFileSync(file, "secret");
    const sent = await alice.offerPaths(peers.fromPeer, [file]);
    await settle(bob, sent.transferId, "pending");
    bob.reject(sent.transferId);
    await settle(alice, sent.transferId, "rejected");
    expect(fs.existsSync(path.join(bob.status().downloadDir, "no.txt"))).toBe(false);
  });

  it("продолжает после паузы и нового процесса отправителя", async () => {
    const alice = await node();
    const bob = await node();
    const peers = await pair(alice, bob);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-")), "wide.txt");
    fs.writeFileSync(file, "0123456789");
    let transferId = "";
    let held = false;
    alice.chunkDelay = async () => {
      if (!held && transferId) {
        held = true;
        alice.pause(transferId);
      }
    };
    const sent = await alice.offerPaths(peers.fromPeer, [file]);
    transferId = sent.transferId;
    await settle(bob, transferId, "pending");
    await bob.accept(transferId);
    await settle(alice, transferId, "paused");
    expect(bob.transfers().find((item) => item.transferId === transferId)!.transferredBytes).toBeGreaterThan(0);
    expect(bob.transfers().find((item) => item.transferId === transferId)!.transferredBytes).toBeLessThan(10);
    const dir = (alice as unknown as { dir: string }).dir;
    await alice.stop();
    const alice2 = new SendLink({ dir, bindHost: "127.0.0.1", advertise: false, chunkBytes: 4 });
    links.push(alice2);
    await alice2.enable({ enabled: true, port: 0 });
    alice2.resume(transferId);
    await settle(alice2, transferId, "completed");
    await settle(bob, transferId, "completed");
    expect(fs.readFileSync(path.join(bob.status().downloadDir, "wide.txt"), "utf8")).toBe("0123456789");
  });

  it("после перезапуска получателя файл не портится", async () => {
    const alice = await node();
    const bob = await node();
    const peers = await pair(alice, bob);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-")), "wide.txt");
    fs.writeFileSync(file, "abcdefghij");
    let transferId = "";
    let held = false;
    alice.chunkDelay = async () => {
      if (!held && transferId) {
        held = true;
        alice.pause(transferId);
      }
    };
    const sent = await alice.offerPaths(peers.fromPeer, [file]);
    transferId = sent.transferId;
    await settle(bob, transferId, "pending");
    await bob.accept(transferId);
    await settle(alice, transferId, "paused");
    const bobDir = (bob as unknown as { dir: string }).dir;
    const download = bob.status().downloadDir;
    const port = bob.status().port;
    await bob.stop();
    const bob2 = new SendLink({ dir: bobDir, bindHost: "127.0.0.1", advertise: false, chunkBytes: 4 });
    links.push(bob2);
    await bob2.enable({ enabled: true, port });
    bob2.resume(transferId);
    alice.resume(transferId);
    await settle(alice, transferId, "completed");
    expect(fs.readFileSync(path.join(download, "wide.txt"), "utf8")).toBe("abcdefghij");
  });

  it("ловит подмену байтов контрольной суммой и отказ при нехватке места", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-disk-"));
    const save = path.join(dir, "in");
    fs.mkdirSync(save);
    const sessions = new SendSessions(dir, async () => 0);
    const sha = createHash("sha256").update("hello").digest("hex");
    const created = sessions.createIncoming({
      transferId: "11111111-1111-4111-8111-111111111111",
      sourceDeviceId: "a",
      targetDeviceId: "b",
      peerName: "A",
      channel: "orion",
      files: [{ relativePath: "hello.txt", size: 5, sha256: sha }]
    });
    await expect(sessions.accept(created.transferId, save)).rejects.toMatchObject({ code: "no_space" });
    expect(fs.existsSync(path.join(save, "hello.txt"))).toBe(false);

    const roomyDir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-hash-"));
    const roomySave = path.join(roomyDir, "in");
    fs.mkdirSync(roomySave);
    const roomy = new SendSessions(roomyDir);
    const bad = roomy.createIncoming({
      transferId: "22222222-2222-4222-8222-222222222222",
      sourceDeviceId: "a",
      targetDeviceId: "b",
      peerName: "A",
      channel: "orion",
      files: [{ relativePath: "hello.txt", size: 5, sha256: sha }]
    });
    await roomy.accept(bad.transferId, roomySave);
    await roomy.commitChunk(bad.transferId, 0, 0, Buffer.from("XXXXX"));
    await expect(roomy.finishFile(bad.transferId, 0)).rejects.toMatchObject({ code: "checksum_mismatch" });
    expect(fs.existsSync(path.join(roomySave, "hello.txt"))).toBe(false);
  });

  it("не принимает путь с выходом из каталога и чужую версию протокола", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-disk-"));
    const sessions = new SendSessions(dir);
    expect(() =>
      sessions.createIncoming({
        transferId: "33333333-3333-4333-8333-333333333333",
        sourceDeviceId: "a",
        targetDeviceId: "b",
        peerName: "A",
        channel: "orion",
        files: [{ relativePath: "../x", size: 1, sha256: "ab".repeat(32) }]
      })
    ).toThrow(/отклонено/);

    const bob = await node();
    const response = await pinnedCall(
      { address: "127.0.0.1", port: bob.status().port, certPem: fs.readFileSync(path.join((bob as unknown as { dir: string }).dir, "lan-tls", "host-cert.pem"), "utf8") },
      "POST",
      "/send/v1/pair/request",
      { headers: { [SEND_VERSION_HEADER]: "99", [SEND_REQUEST_HEADER]: "once" }, json: {} }
    );
    expect(response.status).toBe(400);
    const replay = await pinnedCall(
      { address: "127.0.0.1", port: bob.status().port, certPem: fs.readFileSync(path.join((bob as unknown as { dir: string }).dir, "lan-tls", "host-cert.pem"), "utf8") },
      "POST",
      "/send/v1/pair/request",
      {
        headers: { [SEND_VERSION_HEADER]: "1", [SEND_REQUEST_HEADER]: "same-id" },
        json: { deviceName: "X", clientNonce: "1234567890abcdef", nodeId: "remote-node", fingerprint: bob.fingerprint, listenPort: 4455 }
      }
    );
    const again = await pinnedCall(
      { address: "127.0.0.1", port: bob.status().port, certPem: fs.readFileSync(path.join((bob as unknown as { dir: string }).dir, "lan-tls", "host-cert.pem"), "utf8") },
      "POST",
      "/send/v1/pair/request",
      {
        headers: { [SEND_VERSION_HEADER]: "1", [SEND_REQUEST_HEADER]: "same-id" },
        json: { deviceName: "X", clientNonce: "1234567890abcdef", nodeId: "remote-node-2", fingerprint: bob.fingerprint, listenPort: 4455 }
      }
    );
    expect(replay.status).toBe(200);
    expect(again.status).toBe(409);
  });

  it("выключенный узел не принимает соединение, подмена сертификата рвёт канал", async () => {
    const alice = await node();
    const bob = await node();
    const peers = await pair(alice, bob);
    const port = bob.status().port;
    await bob.stop();
    await expect(alice.beginPair({ address: "127.0.0.1", port, deviceName: "снова" })).rejects.toThrow();
    await bob.enable({ enabled: true, port });
    const tlsDir = path.join((bob as unknown as { dir: string }).dir, "lan-tls");
    fs.rmSync(path.join(tlsDir, "host-key.pem"));
    fs.rmSync(path.join(tlsDir, "host-cert.pem"));
    await bob.stop();
    await bob.enable({ enabled: true, port });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-src-")), "a.txt");
    fs.writeFileSync(file, "z");
    const sent = await alice.offerPaths(peers.fromPeer, [file]);
    await settle(alice, sent.transferId, "failed");
  });

  it("передаёт сто маленьких файлов", async () => {
    const alice = await node();
    const bob = await node();
    const peers = await pair(alice, bob);
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "orion-send-many-"));
    const files: Record<string, string> = {};
    for (let index = 0; index < 100; index += 1) files[`f${index}.txt`] = `n${index}`;
    writeTree(source, files);
    const sent = await alice.offerPaths(peers.fromPeer, [source]);
    await settle(bob, sent.transferId, "pending");
    await bob.accept(sent.transferId);
    await settle(alice, sent.transferId, "completed", 500);
    expect(fs.readdirSync(path.join(bob.status().downloadDir, path.basename(source))).length).toBe(100);
  }, 30_000);
});
