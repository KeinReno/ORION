import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mergeDiscovered, physicalInterfaces, primaryLanAddress, probeCard, scanSubnet, subnetCandidates } from "./lan-scan";
import { loadOrIssueHostCertificate } from "./self-signed-cert";

const nic = (address: string, netmask = "255.255.255.0", internal = false): os.NetworkInterfaceInfo =>
  ({ address, netmask, family: "IPv4", internal, mac: "00:00:00:00:00:00", cidr: null }) as os.NetworkInterfaceInfo;

describe("LAN subnet scan", () => {
  it("keeps real adapters only — no Hyper-V/WSL/VPN, loopback or link-local", () => {
    const interfaces = physicalInterfaces({
      "Беспроводная сеть": [nic("192.168.1.23")],
      "vEthernet (WSL)": [nic("172.28.0.1", "255.255.240.0")],
      "VirtualBox Host-Only Network": [nic("192.168.56.1")],
      Tailscale: [nic("100.64.0.5")],
      "Loopback Pseudo-Interface 1": [nic("127.0.0.1", "255.0.0.0", true)],
      Ethernet: [nic("169.254.10.2", "255.255.0.0"), nic("10.0.0.7")]
    });
    expect(interfaces.map((item) => item.address)).toEqual(["192.168.1.23", "10.0.0.7"]);
    expect(primaryLanAddress(interfaces)).toBe("192.168.1.23");
    expect(primaryLanAddress([{ name: "e", address: "10.0.0.7", netmask: "255.255.255.0" }])).toBe("10.0.0.7");
    expect(primaryLanAddress([])).toBeNull();
  });

  it("lists the /24 around each address, never wider, without itself, network and broadcast", () => {
    const home = subnetCandidates([{ name: "wifi", address: "192.168.1.23", netmask: "255.255.255.0" }]);
    expect(home).toHaveLength(253);
    expect(home).toContain("192.168.1.1");
    expect(home).toContain("192.168.1.254");
    expect(home).not.toContain("192.168.1.23");
    expect(home).not.toContain("192.168.1.0");
    expect(home).not.toContain("192.168.1.255");
    // A /16 office network is not swept whole: only the /24 around this computer.
    const wide = subnetCandidates([{ name: "lan", address: "10.20.30.40", netmask: "255.255.0.0" }]);
    expect(wide).toHaveLength(253);
    expect(wide.every((address) => address.startsWith("10.20.30."))).toBe(true);
    // A narrower subnet stays narrow.
    expect(subnetCandidates([{ name: "lan", address: "10.0.0.2", netmask: "255.255.255.252" }])).toEqual(["10.0.0.1"]);
  });

  it("probes every address on every port in parallel and keeps one entry per node", async () => {
    const seen: string[] = [];
    const nodes = await scanSubnet([4443, 4443, 5443], {
      candidates: ["192.168.1.2", "192.168.1.3", "192.168.1.4"],
      concurrency: 2,
      probe: async (address, port) => {
        seen.push(`${address}:${port}`);
        if (address === "192.168.1.3") return { protocol: 1, nodeId: "host-a", name: "Дом", fingerprint: "AA", address, port };
        return null;
      }
    });
    expect(seen).toHaveLength(6);
    expect(nodes).toEqual([{ protocol: 1, nodeId: "host-a", name: "Дом", fingerprint: "AA", address: "192.168.1.3", port: 4443 }]);
  });

  it("prefers what mDNS announced over the sweep", () => {
    const viaScan = { protocol: 1, nodeId: "a", name: "Дом", fingerprint: "AA", address: "192.168.1.3", port: 4443 };
    const viaMdns = { ...viaScan, address: "192.168.1.30" };
    const other = { ...viaScan, nodeId: "b", address: "192.168.1.9" };
    const merged = mergeDiscovered([viaMdns], [viaScan, other]);
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(expect.arrayContaining([viaMdns, other]));
  });

  describe("a real probe against an HTTPS node", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orion-scan-"));
    const cert = loadOrIssueHostCertificate(dir, "Тест", ["127.0.0.1"]);
    let card: unknown = null;
    const server = https.createServer({ key: cert.keyPem, cert: cert.certPem }, (req, res) => {
      if (req.url !== "/lan/info") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(card));
    });
    afterAll(() => {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("finds a node whose card matches its certificate, ignores a card that lies about it", async () => {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      card = { protocol: 1, nodeId: "node-1", name: "Домашний ORION", fingerprint: cert.fingerprint };
      expect(await probeCard("127.0.0.1", port, 2000)).toEqual({ protocol: 1, nodeId: "node-1", name: "Домашний ORION", fingerprint: cert.fingerprint, address: "127.0.0.1", port });
      card = { protocol: 1, nodeId: "node-1", name: "Подделка", fingerprint: "00:11" };
      expect(await probeCard("127.0.0.1", port, 2000)).toBeNull();
      // Nothing listening: just null, quickly.
      expect(await probeCard("127.0.0.1", 1, 500)).toBeNull();
    });
  });
});
