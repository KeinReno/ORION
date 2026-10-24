import { describe,expect,it } from "vitest";
import { connectionIndicator } from "./connection-indicator";
import type { ReplicaStatus } from "@orion/core";
describe("connection feedback",()=>{
 it("never treats pairing, stale data or queued edits as a confirmed exchange",()=>{
  const now=Date.parse("2026-10-25T10:00:00Z");
  const status:ReplicaStatus={hasCopy:true,phase:"idle",asOf:new Date(now-10_000).toISOString(),pending:0,conflicts:0,message:null};
  expect(connectionIndicator(false,false).tone).toBe("neutral");expect(connectionIndicator(true,false,status).tone).toBe("attention");
  expect(connectionIndicator(true,true,status,now).tone).toBe("ready");
  expect(connectionIndicator(true,true,{...status,pending:1},now).tone).toBe("attention");
  expect(connectionIndicator(true,true,{...status,conflicts:1},now).tone).toBe("attention");
  expect(connectionIndicator(true,true,{...status,phase:"offline"},now).tone).toBe("attention");
  expect(connectionIndicator(true,true,status,now+61_000).tone).toBe("neutral");
  expect(connectionIndicator(true,true,{...status,asOf:"invalid"},now).tone).toBe("neutral");
 });
});
