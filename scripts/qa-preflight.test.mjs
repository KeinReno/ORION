import { describe, expect, it } from "vitest";
import { validateQaDatabaseConfig } from "./qa-preflight.mjs";

const config = {
  databaseUrl: "postgresql://orion:example@127.0.0.1:5433/orion",
  appDatabaseUrl: "postgresql://orion_app:example@127.0.0.1:5433/orion",
  dbName: "orion_qa_gpt",
  confirmReset: "orion_qa_gpt"
};

describe("QA-01 local database safety preflight", () => {
  it("maps both credentials to exactly the explicitly confirmed throwaway database", () => {
    const accepted = validateQaDatabaseConfig(config);
    expect(new URL(accepted.databaseUrl).pathname).toBe("/orion_qa_gpt");
    expect(new URL(accepted.appDatabaseUrl).pathname).toBe("/orion_qa_gpt");
  });
  it.each([
    [{ dbName: "orion", confirmReset: "orion" }, "name"],
    [{ confirmReset: "" }, "confirm"],
    [{ databaseUrl: undefined }, "DATABASE_URL"],
    [{ appDatabaseUrl: undefined }, "APP_DATABASE_URL"],
    [{ databaseUrl: "postgresql://orion:x@prod.example.com:5433/orion" }, "outside"],
    [{ appDatabaseUrl: "postgresql://app:x@10.0.0.2:5433/orion" }, "outside"],
    [{ appDatabaseUrl: "postgresql://app:x@127.0.0.1:5432/orion" }, "host and port"],
    [{ appDatabaseUrl: "postgresql://app:x@127.0.0.1:5433/other" }, "same base"],
    [{ databaseUrl: "postgresql://admin:x@127.0.0.1:5433/orion_qa_gpt",
       appDatabaseUrl: "postgresql://app:x@127.0.0.1:5433/orion_qa_gpt" }, "different existing"]
  ])("rejects unsafe input %# instead of attempting a database reset", (patch, expected) => {
    expect(() => validateQaDatabaseConfig({ ...config, ...patch })).toThrow(expected);
  });
});
