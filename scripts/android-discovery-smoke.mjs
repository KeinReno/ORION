import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out=process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha19/preview";
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:412,height:915}});
 await context.addInitScript(()=>{
  window.androidBridge={}; window.__begins=0; window.__reconnects=0;
  const node={protocol:1,nodeId:"home-pc",name:"Домашний ПК",fingerprint:"AA:BB"};
  const methods={OrionLan:["getState","discover","reconnect","beginPairing","pollPairing","accounts"],OrionStorage:["read","write"],OrionMotion:["getState"],OrionDepth:["start","stop","addListener","removeListener"],App:["addListener","removeListener"],OrionUpdates:["getState","check","addListener","removeListener"]};
  window.Capacitor={PluginHeaders:Object.entries(methods).map(([name,list])=>({name,methods:list.map(name=>({name,rtype:name==="addListener"?"callback":"promise"}))})),nativeCallback:()=>"listener",nativePromise:async(plugin,method,options)=>{
   if(plugin==="OrionStorage") {if(method==="read")return {value:localStorage.getItem("snapshot")}; localStorage.setItem("snapshot",options.value);return {};}
   if(plugin==="OrionMotion")return {reduced:true};
   if(plugin==="OrionDepth")return {available:false};
   if(plugin==="OrionUpdates")return {installedVersion:"0.1.18",installedCode:19,lastChecked:0,lastAttempt:0,available:false,ready:false,manifest:null,wifi:false};
   if(plugin!=="OrionLan")return {};
   const paired=localStorage.getItem("paired")==="yes";
   const state=()=>({paired:localStorage.getItem("paired")==="yes",node:localStorage.getItem("paired")==="yes"?node:null,user:null,address:localStorage.getItem("address")||"192.168.1.10",port:4443});
   if(method==="getState")return state();
   if(method==="discover")return {nodes:window.__empty?[]:[{...node,address:paired?"192.168.1.99":"192.168.1.10",port:4443}]};
   if(method==="beginPairing"){window.__begins++;return {status:"pending",code:"123456",expiresAt:"2030-01-01T00:00:00Z",node};}
   if(method==="pollPairing"){localStorage.setItem("paired","yes");return {status:"approved"};}
   if(method==="accounts")return {status:200,body:[]};
   if(method==="reconnect"){window.__reconnects++;if(window.__reject)throw new Error("Сертификат изменился");localStorage.setItem("address",options.address);return state();}
   return {};
  }};
 });
 const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:3180");await page.getByRole("button",{name:"Связь",exact:true}).click();
 await page.getByRole("button",{name:"Запросить доступ",exact:true}).waitFor();
 await page.screenshot({path:out+"/discovery-before-pairing.png",fullPage:true});
 assert.equal(await page.evaluate(()=>window.__begins),0,"discovery grants no trust");
 await page.getByRole("button",{name:"Запросить доступ",exact:true}).click();await page.getByText("123456",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Проверить подтверждение",exact:true}).click();
 await page.getByRole("heading",{name:"Домашний ПК",exact:true}).waitFor();
 await page.getByText("1. Устройство сопряжено. Теперь войдите в аккаунт компьютера.",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Задачи",exact:true}).click();
 await page.getByRole("status").filter({hasText:"Для обмена войдите в аккаунт ПК"}).waitFor();
 await page.getByRole("button",{name:"Связь и обмен",exact:true}).click();
 await page.reload();await page.getByText("Доверенный компьютер найден. Его сертификат проверен; адрес обновлён.",{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem("address")),"192.168.1.99");assert.equal(await page.evaluate(()=>window.__begins),0,"remembered device needs no new approval");
 await page.evaluate(()=>{window.__reject=true;});await page.getByRole("button",{name:"Проверить доверенный ПК",exact:true}).click();await page.getByRole("alert").filter({hasText:"Сертификат изменился"}).waitFor();
 await page.evaluate(()=>{window.__empty=true;window.__reject=false;});await page.getByRole("button",{name:"Найти Orion в сети",exact:true}).click();await page.getByRole("status").filter({hasText:"Orion не найден"}).waitFor();
 assert.deepEqual(errors,[]);console.log("PASS: discovery without trust, explicit pairing approval, remembered identity readdressing, mismatch error, VPN/empty-state guidance; synthetic bridge only.");
}finally{await browser.close();}
