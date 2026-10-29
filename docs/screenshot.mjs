/**
 * 为本插件截取界面截图。
 *
 * 依赖系统 Edge + playwright-core（不下载额外浏览器）。
 * 输出到 docs/screenshots/，随仓库一起提交。
 *
 * 截图为便于阅读做了两处临时处理（只影响截图会话，不改插件）：
 *   1. 隐藏桌宠贴纸 —— 它会盖住菜单右侧的计数与模型 id；
 *   2. 把菜单的毛玻璃材质换成不透明底 —— headless 里 backdrop-filter
 *      渲染不出来，保留半透明只会让背景透出来变脏。
 */
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const LOG = "C:\\Users\\Administrator\\AppData\\Roaming\\dsh-desktop\\logs\\harness.log";
const OUT = "C:\\Users\\Administrator\\AppData\\Roaming\\dsh-desktop\\harness\\model-provider-picker\\docs\\screenshots";

/** 从 harness 日志取最新一次启动的 GUI 地址（带一次性 token）。 */
function launchUrl() {
  const text = readFileSync(LOG, "utf8");
  const matches = [...text.matchAll(/dsh web:\s*(http:\/\/\S+)/g)];
  if (matches.length === 0) throw new Error("harness.log 里没有 dsh web 启动地址");
  return matches[matches.length - 1][1].trim();
}

const VIEW = { width: 1440, height: 900 };

mkdirSync(OUT, { recursive: true });
const url = launchUrl();
console.log("GUI:", url.replace(/token=[^&]+/, "token=***"));

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 2,
  locale: "zh-CN",
  colorScheme: "dark",
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector(".mpp_trigger", { timeout: 90_000 });
await page.waitForTimeout(1200);

// 截图专用样式
await page.addStyleTag({
  content: `
    /* 桌宠会盖住菜单右侧 */
    [data-slot="shell.overlay"] { display: none !important; }
    /* headless 无 backdrop-filter：换成实底，避免背景透出来 */
    .mpp_menu { background: #1e2127 !important; }
    .mpp_menu > div[aria-hidden="true"] { display: none !important; }
  `,
});

/** 截取某个元素，四周留一点边距，并裁到视口内。 */
async function shot(selector, file, padding = 14) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 20_000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`元素拿不到盒子：${selector}`);
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const width = Math.min(VIEW.width - x, box.width + padding * 2);
  const height = Math.min(VIEW.height - y, box.height + padding * 2);
  await page.screenshot({ path: join(OUT, file), clip: { x, y, width, height } });
  console.log("saved", file);
}

// ── 01 触发器：模型名 + 淡色推理等级 ────────────────────────────────
await shot(".mpp_root", "01-trigger.png", 20);

// ── 02 点开选择器：两级列表，默认只显示厂商 ─────────────────────────
await page.locator(".mpp_trigger").click();
await page.waitForSelector(".mpp_menu", { timeout: 15_000 });
await page.waitForTimeout(500);
await shot(".mpp_menu", "02-picker-collapsed.png");

// ── 03 点厂商整行：在下方展开模型列表 ───────────────────────────────
const providerRows = page.locator(".mpp_rowProvider");
const providerCount = await providerRows.count();
console.log("厂商数：", providerCount);
await providerRows.first().click();
await page.waitForTimeout(400);
await shot(".mpp_menu", "03-picker-expanded.png");

// ── 04 点有等级的模型：切到推理等级屏 ───────────────────────────────
// 逐个点模型，直到出现等级行（.mpp_rowEffort）
async function reopenAllProviders() {
  if ((await page.locator(".mpp_menu").count()) === 0) {
    await page.locator(".mpp_trigger").click();
    await page.waitForSelector(".mpp_menu", { timeout: 10_000 });
  }
  const n = await page.locator(".mpp_rowProvider").count();
  for (let i = 0; i < n; i++) {
    const row = page.locator(".mpp_rowProvider").nth(i);
    // 已展开的再点会收起，先判断 aria-expanded
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await page.waitForTimeout(120);
  }
}

await reopenAllProviders();
const modelRows = page.locator(".mpp_rowModel");
const modelCount = await modelRows.count();
console.log("可见模型行：", modelCount);

let enteredEffort = false;
for (let i = 0; i < modelCount && !enteredEffort; i++) {
  await modelRows.nth(i).click();
  await page.waitForTimeout(400);
  enteredEffort = (await page.locator(".mpp_rowEffort").count()) > 0;
  if (!enteredEffort) {
    if ((await page.locator(".mpp_menu").count()) === 0) await reopenAllProviders();
  }
}

if (enteredEffort) {
  await shot(".mpp_menu", "04-effort.png");
} else {
  console.log("未遇到带等级的模型，跳过 04");
  await page.keyboard.press("Escape");
}

// ── 05 设置页：模型选择器分区 ───────────────────────────────────────
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// 设置入口在左下角账号菜单里（Desktop 版把它挂在这里，快捷键 Ctrl+Alt+,）
await page.locator('button[aria-label="账号菜单"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="menu"] >> text=设置').first().click();
await page.waitForSelector('[data-slot="settings.section"]', { state: "attached", timeout: 20_000 });
await page.waitForTimeout(900);

// 点导航里的「模型选择器」分区（导航是 button 内含 span 文本）
const navItem = page
  .locator("button", { hasText: "模型选择器" })
  .first();
const navCount = await navItem.count();
console.log("导航项：", navCount);
if (navCount > 0) {
  await navItem.click();
  // 等内容区渲染出来
  await page.waitForTimeout(1800);
  const rendered = await page.evaluate(() => ({
    hint: document.body.innerText.includes("两级列表"),
    switches: document.querySelectorAll('[role="switch"]').length,
  }));
  console.log("设置页渲染：", JSON.stringify(rendered));
}

// 公开仓库用图：只截设置面板本身
// （侧边栏里有本地工作区名与会话标题，不该出现在公开截图里）
const panel = await page.evaluate(() => {
  const section = document.querySelector('[data-slot="settings.section"]');
  if (!section) return null;
  let el = section;
  while (el !== null && el !== document.body) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg !== "" && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      const r = el.getBoundingClientRect();
      if (r.width > 500 && r.height > 300) {
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    el = el.parentElement;
  }
  return null;
});
if (panel === null) throw new Error("找不到设置面板容器");
await page.screenshot({
  path: join(OUT, "05-settings.png"),
  clip: {
    x: Math.max(0, panel.x),
    y: Math.max(0, panel.y),
    width: Math.min(VIEW.width - Math.max(0, panel.x), panel.width),
    height: Math.min(VIEW.height - Math.max(0, panel.y), panel.height),
  },
});
console.log("saved 05-settings.png");

await browser.close();
console.log("done");
