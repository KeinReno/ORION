import { afterEach, describe, expect, it, vi } from "vitest";
import { startForegroundSync } from "./foreground-sync";
import { MobileRemoteClient, type ReplicaIO } from "@orion/mobile-core";
import { MemoryHost } from "../../../packages/core/src/sync/memory-host";
class Copies implements ReplicaIO {
  data = new Map<string,string>();
  async read(key:string){return this.data.get(key) ?? null;}
  async write(key:string,value:string){this.data.set(key,value);}
  async clear(key:string){this.data.delete(key);}
}
afterEach(()=>vi.useRealTimers());
describe("foreground sync driver",()=>{
 it("retains an unacknowledged edit across sleep and process restart without duplicating the host row",async()=>{
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
  const host=new MemoryHost(), disk=new Copies();
  const scope={nodeId:"node",fingerprint:"AA:BB",userId:"user",workspaceId:"ws"};
  let phone=await MobileRemoteClient.create(scope,disk,host); await phone.sync();
  let active=true;let driver=startForegroundSync(phone,{active:()=>active,blocked:()=>false,error:()=>{}});
  try {
   await vi.advanceTimersByTimeAsync(1);host.dropPushResponses=1;
   const id=crypto.randomUUID();await phone.saveEntry({kind:"note",id,title:"Durable resume",body:"Queued once",priority:"normal"});
   await vi.advanceTimersByTimeAsync(700);
   expect(phone.engine.status().pending).toBe(1);
   expect([...host.rows.keys()].filter(key=>key===`note:${id}`)).toHaveLength(1);
   active=false;const calls=vi.spyOn(host,"pull");await vi.advanceTimersByTimeAsync(10*60_000);
   expect(calls).not.toHaveBeenCalled();await driver.stop();
   phone=await MobileRemoteClient.create(scope,disk,host);
   expect(phone.engine.status().pending).toBe(1);
   active=true;driver=startForegroundSync(phone,{active:()=>active,blocked:()=>false,error:()=>{}});
   await vi.advanceTimersByTimeAsync(1);
   expect(phone.engine.status().pending).toBe(0);expect(phone.engine.notes().filter(note=>note.id===id)).toHaveLength(1);
   expect([...host.rows.keys()].filter(key=>key===`note:${id}`)).toHaveLength(1);
  }finally{await driver.stop();}
 });
 it("coalesces resume/network wakes during a slow request and retries immediately after it settles",async()=>{
  vi.useFakeTimers(); let release:()=>void=()=>{};
  const sync=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;})).mockResolvedValue(undefined);
  const engine={pending:()=>[],status:()=>({phase:"idle"}),subscribe:()=>()=>{}};
  const driver=startForegroundSync({engine,sync} as unknown as Parameters<typeof startForegroundSync>[0],{active:()=>true,blocked:()=>false,error:()=>{}});
  try {
   await vi.advanceTimersByTimeAsync(1);
   driver.wake(); driver.wake(); await vi.advanceTimersByTimeAsync(1);
   expect(sync).toHaveBeenCalledTimes(1);
   release(); await vi.advanceTimersByTimeAsync(1);
   expect(sync).toHaveBeenCalledTimes(2);
   await vi.advanceTimersByTimeAsync(1000); expect(sync).toHaveBeenCalledTimes(2);
  } finally {release();await driver.stop();}
 });
 it("does not start a deferred wake after backgrounding or stopping",async()=>{
  vi.useFakeTimers(); let release:()=>void=()=>{};let active=true;
  const sync=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const engine={pending:()=>[],status:()=>({phase:"idle"}),subscribe:()=>()=>{}};
  const driver=startForegroundSync({engine,sync} as unknown as Parameters<typeof startForegroundSync>[0],{active:()=>active,blocked:()=>false,error:()=>{}});
  await vi.advanceTimersByTimeAsync(1);driver.wake();await vi.advanceTimersByTimeAsync(1);
  active=false;release();await vi.advanceTimersByTimeAsync(1);expect(sync).toHaveBeenCalledTimes(1);
  active=true;driver.wake();await vi.advanceTimersByTimeAsync(1);expect(sync).toHaveBeenCalledTimes(2);
  driver.wake();await vi.advanceTimersByTimeAsync(1);const drained=driver.stop();release();await drained;
  await vi.advanceTimersByTimeAsync(20000);expect(sync).toHaveBeenCalledTimes(2);
 });
 it("exchanges real replicas in both directions without manual sync and pauses in background",async()=>{
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
  const host=new MemoryHost(); const scope={nodeId:"node",fingerprint:"AA:BB",userId:"user",workspaceId:"ws"};
  const phone=await MobileRemoteClient.create(scope,new Copies(),host);
  const pc=await MobileRemoteClient.create(scope,new Copies(),host); await pc.sync();
  let active=true;const errors:string[]=[];
  const driver=startForegroundSync(phone,{active:()=>active,blocked:()=>false,error:e=>errors.push(e)});
  try {
   await vi.advanceTimersByTimeAsync(1); expect(phone.engine.hasCopy()).toBe(true);
   const id=crypto.randomUUID(); await phone.saveEntry({kind:"note",id,title:"С телефона",body:"Текст",priority:"normal"});
   await vi.advanceTimersByTimeAsync(700); await pc.sync(); expect(pc.engine.notes()[0].title).toBe("С телефона");
   host.nowMs+=1000; const other=crypto.randomUUID();await pc.saveEntry({kind:"task",id:other,title:"С ПК",body:"Дело",priority:"normal"}); await pc.sync();
   active=false;await vi.advanceTimersByTimeAsync(16000); expect(phone.engine.tasks()).toHaveLength(0);
   active=true; driver.wake();await vi.advanceTimersByTimeAsync(1);expect(phone.engine.tasks()[0].title).toBe("С ПК");
   expect(phone.engine.status().pending).toBe(0);expect(errors.every(e=>!e)).toBe(true);
  } finally {driver.stop();}
 });
 it("retains offline edits and retries them on the next foreground poll",async()=>{
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
  const host=new MemoryHost();const scope={nodeId:"node",fingerprint:"AA:BB",userId:"user",workspaceId:"ws"};
  const phone=await MobileRemoteClient.create(scope,new Copies(),host); await phone.sync();
  const pc=await MobileRemoteClient.create(scope,new Copies(),host);await pc.sync();
  const driver=startForegroundSync(phone,{active:()=>true,blocked:()=>false,error:()=>{}});
  try {
   await vi.advanceTimersByTimeAsync(1);host.failNext=1;
   await phone.saveEntry({kind:"note",id:crypto.randomUUID(),title:"Офлайн",body:"Не потерять",priority:"normal"});
   await vi.advanceTimersByTimeAsync(700);expect(phone.engine.status().phase).toBe("offline");expect(phone.engine.status().pending).toBe(1);
   await vi.advanceTimersByTimeAsync(15000);await pc.sync();expect(pc.engine.notes().filter(n=>n.title==="Офлайн")).toHaveLength(1);expect(phone.engine.status().pending).toBe(0);
  }finally{driver.stop();}
 });
 it("does not overlap requests and removes its timers/subscription",async()=>{
  vi.useFakeTimers();let release:()=>void=()=>{};const sync=vi.fn(()=>new Promise<void>(r=>{release=r;}));const unsub=vi.fn();
  const engine={pending:()=>[],status:()=>({phase:"idle"}),subscribe:()=>unsub};
  const driver=startForegroundSync({engine,sync} as unknown as Parameters<typeof startForegroundSync>[0],{active:()=>true,blocked:()=>false,error:()=>{}});
  await vi.advanceTimersByTimeAsync(1); driver.wake();await vi.advanceTimersByTimeAsync(30001);expect(sync).toHaveBeenCalledTimes(1);
  const drained = driver.stop();release();await drained;await vi.advanceTimersByTimeAsync(30001);expect(unsub).toHaveBeenCalledOnce();expect(sync).toHaveBeenCalledTimes(1);
 });
});
