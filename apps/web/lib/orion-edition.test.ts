import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCAL_API_PORT, LOCAL_API_URL } from "./orion-edition";

describe("ORION Rust edition", () => {
  it("keeps the web client on the experimental API port", () => {
    const edition = JSON.parse(readFileSync(new URL("../../../orion-rust/edition.json", import.meta.url), "utf8")) as {
      apiPort: number;
      forbiddenApiPort: number;
      dataDirName: string;
    };
    expect(edition.apiPort).toBe(LOCAL_API_PORT);
    expect(edition.forbiddenApiPort).not.toBe(LOCAL_API_PORT);
    expect(edition.dataDirName).toBe("ORION-Rust");
    expect(LOCAL_API_URL).toBe(`http://localhost:${edition.apiPort}`);
  });
});
