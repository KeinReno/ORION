import type { RemoteScope } from "@orion/mobile-core";
import type { LanDiscoveredNode } from "@orion/shared-types";

interface SavedHost {
  paired: boolean;
  node: { nodeId: string; fingerprint: string } | null;
  user: { id: string } | null;
  address?: string;
}
interface RecoveryLan<T extends SavedHost> {
  state(): Promise<T>;
  discover(): Promise<LanDiscoveredNode[]>;
  reconnect(address: string, port: number): Promise<T>;
}
/** Advertisements are hints, never trust. Native reconnect checks the saved TLS
 * certificate and node ID before retaining an address. No pairing or login here.
 */
export function rememberedHostRecovery<T extends SavedHost>(scope: RemoteScope, lan: RecoveryLan<T>, options: {
  active(): boolean; recovered(state: T): void; now?: () => number;
}) {
  let running = false, lastAttempt = -Infinity;
  const now = options.now ?? (() => performance.now());
  const matches = (saved: T) => saved.paired && saved.node?.nodeId === scope.nodeId
    && saved.node.fingerprint === scope.fingerprint && saved.user?.id === scope.userId;
  return async () => {
    if (running || !options.active() || now() - lastAttempt < 60_000) return false;
    running = true; lastAttempt = now();
    try {
      if (!matches(await lan.state()) || !options.active()) return false;
      const found = await lan.discover();
      const current = await lan.state();
      if (!options.active() || !matches(current)) return false;
      const candidates = found.filter(node => node.nodeId === scope.nodeId && node.fingerprint === scope.fingerprint)
        .sort((a, b) => Number(b.address === current.address) - Number(a.address === current.address));
      const tried = new Set<string>();
      for (const node of candidates.slice(0, 8)) {
        if (!options.active()) return false;
        const key = `${node.address}:${node.port}`;
        if (tried.has(key)) continue;
        tried.add(key);
        try {
          const saved = await lan.reconnect(node.address, node.port);
          if (!options.active() || !matches(saved)) return false;
          options.recovered(saved); return true;
        } catch { /* A forged/unreachable advertisement must not hide a valid candidate. */ }
      }
      return false;
    } catch { return false; }
    finally { running = false; }
  };
}
