import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const out=process.env.ANDROID_SMOKE_OUTPUT || "../../outputs/android-alpha15/preview"; await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:412,height:915},colorScheme:"dark"});
 const errors=[]; const remote=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("request",r=>{if(r.url().includes("example.com"))remote.push(r.url());});
 await page.route("https://raw.githubusercontent.com/**",r=>r.abort());
 await page.goto("http://127.0.0.1:3180");
 const create=async(title,priority,due)=>{
   await page.getByRole("button",{name:"Создать",exact:true}).click();
   await page.getByLabel("Название",{exact:true}).fill(title);
   await page.getByRole("radio",{name:priority,exact:true}).check();
   await page.getByLabel("Срок задачи",{exact:true}).fill(due);
   await page.getByLabel("Начало задачи",{exact:true}).fill("2026-11-01T09:00");
   await page.getByLabel("Плановое время, минуты",{exact:true}).fill("45");
   await page.getByRole("button",{name:"Сохранить",exact:true}).click();
   await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 };
 await create("Я задача","Низкий","2026-11-03T18:00"); await create("А задача","Высокий","2026-11-02T18:00");
 const titles=()=>page.locator(".task-row .entry-main strong").allTextContents();
  if (!(await page.getByLabel("Порядок задач",{exact:true}).isVisible())) await page.getByLabel("Фильтры задач",{exact:true}).click();
 for(const order of ["title","due","priority"]) {await page.getByLabel("Порядок задач",{exact:true}).selectOption(order); assert.deepEqual(await titles(),["А задача","Я задача"]);}
 assert.equal(await page.getByRole("button",{name:"Переместить задачу: А задача",exact:true}).isDisabled(),true);
  if (!(await page.getByLabel("Порядок задач",{exact:true}).isVisible())) await page.getByLabel("Фильтры задач",{exact:true}).click();
 await page.getByLabel("Порядок задач",{exact:true}).selectOption("manual");
 assert.equal(await page.getByRole("button",{name:"Переместить задачу: А задача",exact:true}).isEnabled(),true);
 await page.reload();
 await page.getByRole("button",{name:/А задача/}).filter({has:page.locator("strong")}).click();
 assert.equal(await page.getByLabel("Начало задачи",{exact:true}).inputValue(),"2026-11-01T09:00"); assert.equal(await page.getByLabel("Плановое время, минуты",{exact:true}).inputValue(),"45");
 await page.getByLabel("Плановое время, минуты",{exact:true}).fill("1.5"); await page.getByRole("button",{name:"Сохранить",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"целое число"}).waitFor();
 await page.getByLabel("Плановое время, минуты",{exact:true}).fill(""); await page.getByRole("button",{name:"Убрать начало",exact:true}).click();
 await page.getByRole("button",{name:"Сохранить",exact:true}).click(); await page.getByRole("heading",{name:"Задачи",exact:true}).waitFor();
 await page.getByRole("button",{name:"Заметки",exact:true}).click();
 const source='# Заголовок\n**Жирный**\n\n- Пункт\n\n<script>window.__xss=true</script>\n\n![фото](https://example.com/pixel.png) [ссылка](https://example.com)\n\n```js\nconst x = 1;\n```';
 for(const title of ["Я заметка","А заметка"]) {
  await page.getByRole("button",{name:"Создать",exact:true}).click(); await page.getByLabel("Название",{exact:true}).fill(title); await page.getByLabel("Текст заметки",{exact:true}).fill(source);
  await page.getByText("Предпросмотр Markdown",{exact:true}).click();
  await page.getByRole("heading",{name:"Заголовок",exact:true}).waitFor();
  assert.equal(await page.locator(".markdown-body strong").innerText(),"Жирный");
  assert.equal(await page.locator(".markdown-body img, .markdown-body a, .markdown-body script").count(),0);
  assert.equal(await page.evaluate(()=>window.__xss),undefined); assert.deepEqual(remote,[]);
  if(title==="А заметка") { await page.setViewportSize({width:320,height:740}); await page.evaluate(()=>{document.documentElement.style.fontSize="200%";}); assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); await page.screenshot({path:out+"/markdown-320-text200.png",fullPage:true}); await page.evaluate(()=>{document.documentElement.style.fontSize="";}); await page.setViewportSize({width:412,height:915}); }
  await page.getByText("Предпросмотр Markdown",{exact:true}).click(); assert.equal(await page.getByLabel("Текст заметки",{exact:true}).inputValue(),source);
  await page.getByRole("button",{name:"Сохранить",exact:true}).click(); await page.getByRole("heading",{name:"Заметки",exact:true}).waitFor();
 }
  if (!(await page.getByLabel("Порядок заметок",{exact:true}).isVisible())) await page.getByLabel("Фильтры заметок",{exact:true}).click();
 await page.getByLabel("Порядок заметок",{exact:true}).selectOption("title"); assert.deepEqual((await page.locator(".notes .entry-main strong").allTextContents()).map(x=>x.trim()),["А заметка","Я заметка"]);
 await page.getByRole("button",{name:/Я заметка/}).filter({has:page.locator("strong")}).click(); await page.getByRole("switch",{name:"Закрепить заметку",exact:true}).check(); await page.getByRole("button",{name:"Сохранить",exact:true}).click();
 await page.locator(".notes > li").first().filter({hasText:"Я заметка"}).waitFor();
 await page.screenshot({path:out+"/notes-sort-dark.png",fullPage:true}); assert.deepEqual(errors,[]);
 console.log("PASS: task ordering/reorder guard, planning reload/validation/clear, Markdown formatting/HTML escaping/no remote resources/source preservation, note ordering/pin precedence, 320px/200%; browser only.");
} finally {await browser.close();}
