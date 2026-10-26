import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out=process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha21/preview";await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:412,height:915},colorScheme:"dark"});
 await context.addInitScript(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(window.__fail)throw new Error("disk full");return put.apply(this,args);};});
 const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("https://raw.githubusercontent.com/**",r=>r.abort());
 await page.goto("http://127.0.0.1:3180");await page.getByRole("button",{name:"Связь",exact:true}).click();
 await page.getByRole("heading",{name:"Найдём компьютер",exact:true}).waitFor();
 assert.equal(await page.getByLabel("Адрес компьютера",{exact:true}).isVisible(),false);
 assert.equal(await page.getByRole("button",{name:"Сохранить резервную копию",exact:true}).isVisible(),false);
 await page.screenshot({path:out+"/connection-dark.png",fullPage:true});
 await page.getByText("Компьютер не найден? Ввести адрес",{exact:true}).click();await page.getByLabel("Адрес компьютера",{exact:true}).fill("192.168.1.2");
 await page.getByText("Компьютер не найден? Ввести адрес",{exact:true}).click();await page.getByText("Компьютер не найден? Ввести адрес",{exact:true}).click();assert.equal(await page.getByLabel("Адрес компьютера",{exact:true}).inputValue(),"192.168.1.2");
 for(const width of [320,412,900]) {
  await page.setViewportSize({width,height:740});await page.evaluate(()=>{document.documentElement.style.fontSize="200%";});
  for(const name of ["Задачи","Заметки","Финансы","Списки","Ещё"]) {
   await page.getByRole("button",{name,exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} reflow ${width}`);
  }
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize="";});await page.setViewportSize({width:320,height:740});
 await page.getByRole("button",{name:"Задачи",exact:true}).click();await page.getByRole("button",{name:"Создать",exact:true}).click();
 await page.evaluate(()=>{window.__fail=true;});await page.getByLabel("Название",{exact:true}).fill("Не потерять текст");await page.getByRole("alert").filter({hasText:"Черновик не записан"}).waitFor();
 await page.getByRole("button",{name:"Назад к списку, оставить черновик",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Дождитесь сохранения черновика"}).waitFor();assert.equal(await page.getByLabel("Название",{exact:true}).inputValue(),"Не потерять текст");
 await page.evaluate(()=>{window.__fail=false;});await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 await page.screenshot({path:out+"/tasks-320.png",fullPage:true});
 await page.getByRole("button",{name:"Финансы",exact:true}).click();
 await page.evaluate(()=>{window.__fail=true;});await page.getByLabel("Сумма, ₽").fill("125");
 await page.getByRole("alert").filter({hasText:"Черновик не записан"}).waitFor();
 await page.getByRole("button",{name:"Заметки",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Дождитесь сохранения черновика"}).waitFor();
 assert.equal(await page.getByLabel("Сумма, ₽").inputValue(),"125");
 await page.evaluate(()=>{window.__fail=false;});await page.getByRole("button",{name:"Записать расход",exact:true}).click();
 await page.getByRole("button",{name:"Заметки",exact:true}).click();await page.getByRole("heading",{name:"Заметки",exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log("PASS: progressive sync setup, manual input preservation, five destinations at 320/412/900px with200% text, disk-error safe editor leave; browser only.");
}finally{await browser.close();}
