// Explicit device QA only: requires a forwarded Orion WebView and creates/removes uniquely named local fixtures.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
if(process.env.ORION_DEVICE_QA!=="1" || !process.env.ADB_SERIAL || !process.env.ADB_PATH) throw new Error("Explicit ORION_DEVICE_QA=1, ADB_SERIAL and ADB_PATH required");
const out=process.env.ANDROID_SMOKE_OUTPUT || "test-results/android-device";await mkdir(out,{recursive:true});
const adb=(...args)=>execFileSync(process.env.ADB_PATH,["-s",process.env.ADB_SERIAL,...args]);
const browser=await chromium.connectOverCDP("http://127.0.0.1:9227",{timeout:8000});
const stamp="QA alpha22 "+Date.now();const task=stamp+" task";const note=stamp+" note";const finance=stamp+" finance";
try {
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>new URL(p.url()).origin==="https://localhost");assert.ok(page,"Only Orion localhost WebView may be tested");page.setDefaultTimeout(10000);
 const capture=async(name)=>{await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>new Promise(requestAnimationFrame));await writeFile(out+"/"+name+".png",adb("exec-out","screencap","-p"));};
 await page.getByRole("button",{name:"Задачи",exact:true}).click();await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 assert.equal(await page.locator(".draft-banner").count(),0,"An existing user draft must not be touched");
 assert.ok((await page.locator(".brand .local-label").innerText()).includes("На телефоне"),"Use local phone records only");
 await capture("tasks-native");
 await page.getByRole("button",{name:"Создать",exact:true}).click();await page.getByLabel("Название",{exact:true}).click();await page.getByLabel("Название",{exact:true}).fill(task);
 await page.getByText("Черновик сохранён на телефоне",{exact:true}).waitFor();
 const keyboard=await page.evaluate(()=>({viewport:visualViewport.height,layout:innerHeight,mask:parseFloat(getComputedStyle(document.body,"::before").height),saveBottom:document.querySelector(".editor-bar .primary").getBoundingClientRect().bottom,saveTop:document.querySelector(".editor-bar .primary").getBoundingClientRect().top}));
 assert.ok(keyboard.mask>0,"Android safe area must be covered");assert.ok(keyboard.saveTop>=keyboard.mask-1 && keyboard.saveBottom<=keyboard.viewport,"Save must stay reachable above keyboard and below status bar");
 await capture("editor-keyboard-native");await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 await page.reload();await page.locator(".task-row .entry-main").filter({hasText:task}).click();assert.equal(await page.getByLabel("Название",{exact:true}).inputValue(),task);
 await page.getByLabel("Название",{exact:true}).fill(task+" edited");await page.getByRole("button",{name:"Сохранить",exact:true}).click();
 await page.getByRole("button",{name:"Завершить: "+task+" edited",exact:true}).click();await page.getByRole("button",{name:"Вернуть в работу: "+task+" edited",exact:true}).waitFor();
 await page.getByRole("button",{name:"Действия задачи: "+task+" edited",exact:true}).click();await page.getByRole("button",{name:"Удалить задачу…",exact:true}).click();await page.getByRole("button",{name:"Удалить задачу",exact:true}).click();await page.getByRole("button",{name:"Действия задачи: "+task+" edited",exact:true}).waitFor({state:"detached"});
 await page.getByRole("button",{name:"Заметки",exact:true}).click();await capture("notes-native");await page.getByRole("button",{name:"Создать",exact:true}).click();
 const source="# Native QA\n\n**SQLite** и редактор сохраняют исходный текст.";
 await page.getByLabel("Название",{exact:true}).fill(note);await page.getByLabel("Текст заметки",{exact:true}).fill(source);await page.getByRole("button",{name:"Сохранить",exact:true}).click();
 await page.reload();await page.getByRole("button",{name:"Заметки",exact:true}).click();await page.locator(".notes .entry-main").filter({hasText:note}).click();assert.equal(await page.getByLabel("Текст заметки",{exact:true}).inputValue(),source);
 await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("button",{name:"Действия заметки: "+note,exact:true}).click();await page.getByRole("button",{name:"Удалить заметку…",exact:true}).click();await page.getByRole("button",{name:"Удалить заметку",exact:true}).click();await page.getByRole("button",{name:"Действия заметки: "+note,exact:true}).waitFor({state:"detached"});
 await page.getByRole("button",{name:"Финансы",exact:true}).click();assert.equal(await page.getByLabel("Сумма, ₽").inputValue(),"","An existing finance draft must not be touched");await capture("finance-native");
 await page.getByLabel("Сумма, ₽").fill("1,01");await page.locator(".finance-details summary").click();await page.getByLabel(/Комментарий/).fill(finance);await page.getByRole("button",{name:"Записать расход",exact:true}).click();
 await page.reload();await page.getByRole("button",{name:"Финансы",exact:true}).click();await page.getByRole("button",{name:"Изменить операцию: "+finance,exact:true}).click();assert.equal(await page.getByLabel("Сумма, ₽").inputValue(),"1,01");
 await page.getByLabel("Сумма, ₽").fill("1,02");await page.getByRole("button",{name:"Сохранить изменения",exact:true}).click();await page.getByRole("button",{name:"Удалить операцию: "+finance,exact:true}).click();await page.getByRole("button",{name:"Удалить операцию",exact:true}).click();await page.getByRole("button",{name:"Изменить операцию: "+finance,exact:true}).waitFor({state:"detached"});
 await page.getByRole("button",{name:"Задачи",exact:true}).click();await writeFile(out+"/native-result.json",JSON.stringify({device:"OPPO Reno8 5G / CPH2481",android:15,versionCode:22,keyboard,taskCrud:true,noteRoundTrip:true,financeCrud:true,fixturesDeleted:true},null,2)+"\n");
 console.log("PASS: physical OPPO Android15, SQLite reload task/note/finance create/edit/delete, keyboard/save/safe-area, test fixtures removed. LAN not tested.");
}finally{await browser.close();}
