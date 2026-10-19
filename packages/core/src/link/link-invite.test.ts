import { describe, expect, it } from "vitest";
import { LINK_INVITE_PREFIX, decodeLinkInvite, encodeLinkInvite } from "./link-invite";

const invite = {
  pairing: { linkDeviceId: "d1", workspaceId: "ws", epoch: 1, keyId: "k1", key: "AAAA" },
  webdav: { url: "https://dav.example.com", baseDir: "/ORION", username: "анна@example.com" }
};

describe("код приглашения Orion Link", () => {
  it("круг кодирования с кириллицей, без пароля WebDAV", () => {
    const code = encodeLinkInvite(invite);
    expect(code.startsWith(LINK_INVITE_PREFIX)).toBe(true);
    expect(code).not.toMatch(/[+/=\s]/);
    expect(decodeLinkInvite(code)).toEqual(invite);
    expect(atob(code.slice(LINK_INVITE_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/"))).not.toContain("password");
  });

  it("отвергает чужой префикс, мусор и неполные данные", () => {
    expect(() => decodeLinkInvite("hello")).toThrow(/не код/);
    expect(() => decodeLinkInvite(LINK_INVITE_PREFIX + "!!!")).toThrow(/повреждён/);
    const broken = LINK_INVITE_PREFIX + btoa(JSON.stringify({ pairing: {} })).replace(/=+$/, "");
    expect(() => decodeLinkInvite(broken)).toThrow(/повреждён/);
  });
});
