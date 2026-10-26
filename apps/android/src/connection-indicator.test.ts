import { describe,expect,it } from "vitest";
import { connectionIndicator } from "./connection-indicator";
import type { ReplicaStatus } from "@orion/core";
describe("connection feedback",()=>{
 it("never treats pairing, stale data or queued edits as a confirmed exchange",()=>{
  const now=Date.parse("2026-10-25T10:00:00Z");
  const status:ReplicaStatus={hasCopy:true,phase:"idle",asOf:new Date(now-10_000).toISOString(),pending:0,conflicts:0,message:null};
  expect(connectionIndicator(false,false).tone).toBe("neutral");expect(connectionIndicator(true,false,status).tone).toBe("attention");
  expect(connectionIndicator(true,true,status,null,2000).tone).toBe("neutral");
  expect(connectionIndicator(true,true,status,1000,2000).tone).toBe("ready");
  expect(connectionIndicator(true,true,{...status,hasCopy:false},1000,2000).tone).toBe("attention");
  expect(connectionIndicator(true,true,{...status,pending:1},1000,2000).tone).toBe("attention");
  expect(connectionIndicator(true,true,{...status,conflicts:1},1000,2000).tone).toBe("attention");
  expect(connectionIndicator(true,true,{...status,phase:"offline"},1000,2000).tone).toBe("attention");
  expect(connectionIndicator(true,true,status,1000,61_001).tone).toBe("neutral");
  expect(connectionIndicator(true,true,status,3000,2000).tone).toBe("neutral");
 });
 it.each([-86400,-78,78,86400])("uses local confirmation with host clock offset %s seconds",offset=>{
  const status:ReplicaStatus={hasCopy:true,phase:"idle",asOf:new Date(Date.parse("2026-10-25T10:00:00Z")+offset*1000).toISOString(),pending:0,conflicts:0,message:null};
  expect(connectionIndicator(true,true,status,1000,2000).tone).toBe("ready");
  expect(connectionIndicator(true,true,status,null,2000).tone).toBe("neutral");
 });
});
