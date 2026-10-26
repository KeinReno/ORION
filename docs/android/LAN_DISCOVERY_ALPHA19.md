# LAN discovery and remembered identity — alpha.19

23.10.2026. Android 0.1.18/code19. Desktop counterpart: existing LAN host,
mDNS/physical-interface scan, approval codes, durable device tokens and revocation.
This adds native Android NSD and safe endpoint relocation; no new server protocol,
public DTO, database or trust algorithm. Governing ADR-0015 remains unchanged.

## User flow
1. Desktop: Settings → Network/devices → Host LAN. Advertising is not proof of
   reachability: host UI now says advertising enabled, shows nodeId and LAN/VPN guidance.
2. Phone: Connection screen automatically runs one bounded6-second `_orion._tcp.`
   discovery; explicit rescan is available. Desktop ethernet and phone Wi-Fi are fine
   on the same routable LAN. Scanning does not pair, log in, import or sync data.
3. Unknown host: user selects Request access; existing TLS probe + nonce/HMAC code
   binds approval to observed server certificate. Owner types phone code on desktop.
   Native request names manufacturer/model; server-issued trust ID/device token stays
   durable in Keystore-backed vault. Desktop shows trust ID and existing revoke action.
4. Remembered host: discovery nodeId/fingerprint only select a candidate. Native code
   connects with the SAVED exact leaf certificate, verifies `/lan/info` nodeId/protocol,
   then checks the device gate via `/auth/accounts` before persisting new address/port.
   Device/JWT is never sent in the preliminary info probe. Strict account-list policy
   may return403; explicit device_revoked/device_untrusted always rejects relocation.
5. Same TLS identity and nodeId can move IP without re-pairing; user/workspace/replica
   keys and queued edits remain unchanged. Certificate/key replacement requires explicit
   new pairing. One remembered host remains supported; other hosts do not replace it.

## Discovery implementation
LanDiscovery uses Android NsdManager, serial service resolution, caps32 candidates,
6-second timer and bounded temporary multicast lock. Stop/failure/timeout releases
lock/listener. Only protocol1/valid port/IPv4/64hex fingerprint and bounded name/id
advertisements appear. TXT data remains untrusted and carries no accounts/workspaces.
Android API deprecation warnings for legacy resolveService are retained for compatible
minimum devices; actual OPPO NSD/VPN behavior requires hardware acceptance.

IPv4 only matches existing native HTTPS address validator. No subnet sweep, QR scanner,
background polling, VPN bypass or blanket network binding introduced. Discovery runs
when the Connection page opens, not continuously in the background. A remembered
endpoint already works directly until its address changes; open Connection to relocate.

## VPN and fallback
VPN must permit local routes; guest/client isolation and Windows firewall may block
multicast or traffic. If discovery empty, keep explicit manual address/port available,
including pinned reconnect to remembered host. Failure is not proof a host is offline.
Do not disable VPN/security settings automatically or trust a TXT fingerprint.

## Files and validation
Android: LanDiscovery.java, LanIdentity.java/test, OrionLanPlugin.java, Manifest;
lan.ts/use-lan.ts/connection.tsx; version metadata and smoke fixtures.
Desktop: apps/web/panels/settings/network-section.tsx (guidance and stable IDs).
Synthetic android-discovery-smoke covers discovery without trust, explicit approval,
remembered address update, mismatch error and empty/VPN state. JVM identity and existing
real local TLS tests cover ID/protocol and pinned-certificate refusal. They do NOT
prove mDNS operation on the physical router or Android socket routing under VPN.

## Physical acceptance / next steps
Use current desktop with Host LAN enabled and install alpha.19 over old phone build.
Test: ethernet+Wi-Fi, VPN off/on with LAN allowed, mDNS blocked/manual fallback,
first approve/deny/expiry, app restart, DHCP IP change (Connection → Find), forged
advertisement with wrong certificate, revoke and reconnect/sync denied, offline edits
retained, both home and strict login policy. Confirm no unsolicited access before
approval. Full Windows installer/desktop visual packaging not produced by this slice;
desktop guidance source is in Android PR, existing host already supports the wire flow.


## Automated evidence
Workspace typecheck PASS (including desktop web); lint0 errors/29 existing warnings.
113 focused tests PASS (mobile-core, Android, core sync and API LAN trust/discovery).
15 browser scripts PASS, including synthetic discovery/first approval/readdressing.
Android assembleDebug/assembleRelease/lintDebug/testDebugUnitTest PASS (10 JVM tests).
Architecture/plugin-contract/module-docs checks run locally. CI/physical LAN are separate.
Preview screenshot is synthetic bridge evidence, not a screenshot from OPPO.
