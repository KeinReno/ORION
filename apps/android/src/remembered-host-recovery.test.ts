import { describe, expect, it, vi } from "vitest";
import { rememberedHostRecovery } from "./remembered-host-recovery";

const scope = { nodeId: "remembered", fingerprint: "AA:BB", userId: "owner", workspaceId: "ws" };
const saved = () => ({ paired: true, node: { nodeId: scope.nodeId, fingerprint: scope.fingerprint }, user: { id: scope.userId }, address: "192.168.1.4" });
const hint = (address: string) => ({ protocol: 1 as const, ...scope, address, port: 4443, name: "PC" });
function fixture() {
  const lan = { state: vi.fn(async () => saved()), discover: vi.fn(async () => [hint("192.168.1.9")]), reconnect: vi.fn(async () => saved()) };
  const recovered = vi.fn(); let active = true, time = 0;
  const recover = rememberedHostRecovery(scope, lan, { active: () => active, recovered, now: () => time });
  return { lan, recover, recovered, pause: () => { active = false; }, advance: () => { time += 60_000; } };
}
describe("remembered host recovery", () => {
  it("prefers the previously verified LAN route when several interfaces advertise the same host", async () => {
    const f = fixture(); f.lan.state.mockResolvedValue({ ...saved(), address: "192.168.1.9" });
    f.lan.discover.mockResolvedValue([hint("10.10.0.2"), hint("192.168.1.9")]);
    expect(await f.recover()).toBe(true);
    expect(f.lan.reconnect).toHaveBeenCalledExactlyOnceWith("192.168.1.9", 4443);
  });
  it("updates only the remembered authenticated host and rate limits discovery", async () => {
    const f = fixture(); expect(await f.recover()).toBe(true);
    expect(f.lan.reconnect).toHaveBeenCalledWith("192.168.1.9", 4443); expect(f.recovered).toHaveBeenCalledOnce();
    expect(await f.recover()).toBe(false); expect(f.lan.discover).toHaveBeenCalledOnce();
    f.advance(); expect(await f.recover()).toBe(true);
  });
  it("ignores other identities and matching IDs with another certificate", async () => {
    const f = fixture(); f.lan.discover.mockResolvedValue([
      { ...hint("192.168.1.8"), nodeId: "stranger" }, { ...hint("192.168.1.7"), fingerprint: "OTHER" },
    ]);
    expect(await f.recover()).toBe(false); expect(f.lan.reconnect).not.toHaveBeenCalled();
  });
  it("does not discover after logout or account change", async () => {
    const f = fixture(); f.lan.state.mockResolvedValue({ ...saved(), user: { id: "someone-else" } });
    expect(await f.recover()).toBe(false); expect(f.lan.discover).not.toHaveBeenCalled();
  });
  it("revalidates identity after discovery and never reconnects a new account", async () => {
    const f = fixture(); f.lan.state.mockResolvedValueOnce(saved()).mockResolvedValue({ ...saved(), user: { id: "changed" } });
    expect(await f.recover()).toBe(false); expect(f.lan.reconnect).not.toHaveBeenCalled();
  });
  it("tries another candidate after pinned verification rejects a hint, without duplicate probes", async () => {
    const f = fixture(); f.lan.discover.mockResolvedValue([hint("192.168.1.8"), hint("192.168.1.8"), hint("192.168.1.9")]);
    f.lan.reconnect.mockRejectedValueOnce(new Error("pin mismatch"));
    expect(await f.recover()).toBe(true); expect(f.lan.reconnect).toHaveBeenCalledTimes(2);
  });
  it("drops a discovery result after pause and suppresses concurrent attempts", async () => {
    const f = fixture(); let finish!: (nodes: ReturnType<typeof hint>[]) => void;
    f.lan.discover.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const flight = f.recover(); await vi.waitFor(() => expect(f.lan.discover).toHaveBeenCalledOnce());
    expect(await f.recover()).toBe(false); f.pause(); finish([hint("192.168.1.9")]);
    expect(await flight).toBe(false); expect(f.lan.reconnect).not.toHaveBeenCalled();
  });
  it("keeps discovery and verification failures recoverable without publishing stale state", async () => {
    const f = fixture(); f.lan.discover.mockRejectedValueOnce(new Error("multicast blocked"));
    expect(await f.recover()).toBe(false); f.advance();
    f.lan.reconnect.mockResolvedValue({ ...saved(), node: { ...saved().node, fingerprint: "changed" } });
    expect(await f.recover()).toBe(false); expect(f.recovered).not.toHaveBeenCalled();
  });
});
