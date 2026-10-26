import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out=process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha22/preview";await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({viewport:{width:412,height:915},colorScheme:"dark"});
 const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));await page.route("https://raw.githubusercontent.com/**",r=>r.abort());
 await page.goto("http://127.0.0.1:3180");
 for(const title of ["Подготовить презентацию","Позвонить в мастерскую"]) {
  await page.getByRole("button",{name:"Создать",exact:true}).click();await page.getByLabel("Название",{exact:true}).fill(title);
  await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 }
 assert.equal(await page.getByLabel("Порядок задач",{exact:true}).isVisible(),false);
 const first=page.locator(".task-row").first();assert.ok((await first.boundingBox()).y<700,"First task must be reachable on first screen");
 await page.getByRole("group",{name:"Быстрые фильтры задач"}).getByRole("button",{name:"Сегодня",exact:true}).click();
 await page.getByRole("heading",{name:"Ничего не найдено",exact:true}).waitFor();
 await page.getByLabel("Фильтры задач",{exact:true}).click();assert.equal(await page.getByLabel("Срок задач",{exact:true}).inputValue(),"today");
 await page.getByLabel("Фильтры задач",{exact:true}).click();await page.getByRole("button",{name:"Сбросить фильтры задач",exact:true}).click();
 await page.mouse.move(0,0);await page.screenshot({path:out+"/tasks-dark.png"});
 await page.getByRole("button",{name:"Заметки",exact:true}).click();await page.getByRole("button",{name:"Создать",exact:true}).click();
 const source="# Идея\n\n**Сделать** понятную заметку для [команды](https://example.test).";
 await page.getByLabel("Название",{exact:true}).fill("Идеи для Orion");await page.getByLabel("Текст заметки",{exact:true}).fill(source);
 await page.getByRole("button",{name:"Сохранить",exact:true}).click();await page.getByRole("heading",{name:"Заметки",exact:true}).waitFor();
 assert.equal(await page.locator(".notes .excerpt").innerText(),"Идея Сделать понятную заметку для команды.");
 await page.screenshot({path:out+"/notes-dark.png"});await page.locator(".notes .entry-main").click();assert.equal(await page.getByLabel("Текст заметки",{exact:true}).inputValue(),source);
 await page.getByRole("button",{name:"Назад к списку, оставить черновик",exact:true}).click();
 await page.getByRole("button",{name:"Финансы",exact:true}).click();await page.getByLabel("Сумма, ₽").fill("450");await page.getByRole("button",{name:"Кафе",exact:true}).click();
 await page.getByRole("button",{name:"Записать расход",exact:true}).click();await page.getByRole("button",{name:"Изменить операцию: Кафе",exact:true}).waitFor();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+"/finance-dark.png"});
 for(const width of [320,412,900]) {
  await page.setViewportSize({width,height:740});await page.evaluate(()=>document.documentElement.style.fontSize="200%");
  for(const name of ["Задачи","Заметки","Финансы"]) {
   await page.getByRole("button",{name,exact:true}).click();
   if(name!=="Финансы") await page.getByLabel(name==="Задачи"?"Фильтры задач":"Фильтры заметок",{exact:true}).click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} ${width}px/200%`);
  }
 }
 assert.deepEqual(errors,[]);console.log("PASS: compact filter presets/reset, first-screen task, readable note preview with exact Markdown preservation, finance capture and 320/412/900px at200%; browser only.");
}finally{await browser.close();}
