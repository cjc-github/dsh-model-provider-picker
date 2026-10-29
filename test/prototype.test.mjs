/**
 * 原型的逻辑回归测试：在 Node 里跑原型脚本的核心函数，
 * 验证两级列表的默认收起、点模型进入等级屏、以及隐藏规则。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 相对本测试文件定位原型页，而不是写死某台机器上的绝对路径。
const file = fileURLToPath(new URL("../prototype/index.html", import.meta.url));
const html = readFileSync(file, "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// 用一个最小的 DOM 垫片跑脚本，取出内部状态与纯函数。
const elements = new Map();
function makeElement(id) {
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    focus() {},
    select() {}
  };
}
for (const id of ["tree", "settingsBody", "sCurrent", "sCounts", "sHidden", "triggerModel", "triggerEffort",
                 "inlinePicker", "settingsPicker", "modalRoot", "dialogPicker", "trigger", "pickerSearch"]) {
  elements.set(id, makeElement(id));
}
globalThis.document = {
  getElementById: (id) => elements.get(id) ?? makeElement(id),
  addEventListener() {}
};

const marker = "renderAll();";
const at = script.lastIndexOf(marker);
if (at < 0) throw new Error("renderAll() call not found");
const instrumented = script.slice(0, at) + `globalThis.__mppApi = {
  get state() { return state; },
  get CATALOG() { return CATALOG; },
  visibleCatalog, effectiveEffort, effortLabel, renderPicker,
};
` + script.slice(at);
new Function(instrumented).call(globalThis);
const api = globalThis.__mppApi;

// 渲染用的垫片容器
const container = makeElement("test");
const baseOpts = () => ({
  query: "",
  onQuery() {},
  view: "list",
  pending: null,
  showSearch: true,
  title: "选择模型",
  onPickProvider() {},
  onPickModel() {},
  onPickEffort() {},
  onBack() {},
});

// ── 目录结构 ─────────────────────────────────────────────────────────────
assert.equal(api.CATALOG.length, 5, "五个厂商");
const raccoon = api.CATALOG.find((g) => g.id === "raccoon");
assert.ok(raccoon.models.find((m) => m.id === "sn-kimi-k3").reasoning, "Kimi K3 带有推理强度元数据");
assert.equal(raccoon.models.find((m) => m.id === "sn-minimax-m3").reasoning, undefined, "没有强度的模型不带该字段");

// ── 两级列表：默认只显示厂商 ─────────────────────────────────────────────
api.state.expandedProviders.clear();
api.state.query = "";
api.renderPicker(container, baseOpts());
const collapsed = container.innerHTML;
assert.ok(collapsed.includes("row-provider"), "有厂商行");
assert.equal(collapsed.includes("row-model"), false, "默认收起：看不到任何模型行");
assert.equal((collapsed.match(/row-provider/g) ?? []).length, 5, "五个厂商全部可见");

// ── 点厂商 → 下方展开模型列表 ───────────────────────────────────────────
api.state.expandedProviders.add("raccoon");
api.renderPicker(container, baseOpts());
const expanded = container.innerHTML;
assert.ok(expanded.includes("row-model"), "展开后有模型行");
assert.equal((expanded.match(/row-provider/g) ?? []).length, 5, "厂商行数量不变");
assert.ok(expanded.includes('aria-expanded="true"'), "展开的厂商标记 aria-expanded");

// 未展开的厂商依然没有模型行：模型行数量应等于 raccoon 的 4 个
assert.equal((expanded.match(/row-model/g) ?? []).length, 4, "只有展开的厂商列出模型");

// ── 第二屏：推理等级 ────────────────────────────────────────────────────
api.renderPicker(container, {
  ...baseOpts(),
  view: "effort",
  pending: { provider: "raccoon", model: "sn-kimi-k3" },
});
const effortView = container.innerHTML;
assert.ok(effortView.includes("选择推理等级"), "第二屏标题是选择推理等级");
assert.ok(effortView.includes('data-back="1"'), "第二屏有返回按钮");
assert.equal((effortView.match(/row-effort/g) ?? []).length, 4, "Kimi K3 有四档强度");
assert.ok(effortView.includes("Kimi K3"), "第二屏头部显示模型名");
// 第二屏不再显示厂商/模型行
assert.equal(effortView.includes("row-provider"), false, "第二屏不显示厂商行");
assert.equal(effortView.includes("row-model"), false, "第二屏不显示模型行");

// 没有推理等级的模型：给出提示
api.renderPicker(container, {
  ...baseOpts(),
  view: "effort",
  pending: { provider: "raccoon", model: "sn-minimax-m3" },
});
assert.ok(container.innerHTML.includes("该模型未提供推理等级"), "无等级模型给出提示");

// ── 强度归属：绑定「厂商 + 模型」 ────────────────────────────────────────
const flash = raccoon.models.find((m) => m.id === "sn-deepseek-v4-1-flash-1017");
const chatAccount = api.CATALOG.find((g) => g.id === "deepseek-account").models.find((m) => m.id === "deepseek-chat");
const chatOfficial = api.CATALOG.find((g) => g.id === "deepseek-official").models.find((m) => m.id === "deepseek-chat");

assert.equal(api.effectiveEffort(flash, "raccoon"), "on", "当前选中模型用显式强度");
assert.equal(api.effortLabel(flash, "raccoon"), "开启", "强度名取自该模型自己的档位表");
assert.equal(api.effortLabel(chatAccount, "deepseek-account"), "low", "同名模型取本厂商默认档");
assert.equal(api.effortLabel(chatOfficial, "deepseek-official"), "high", "同名模型在另一厂商取另一默认档");
assert.equal(api.effortLabel(raccoon.models.find((m) => m.id === "sn-glm-5.2"), "raccoon"), undefined, "无强度元数据时不显示强度");

// ── 隐藏规则 ─────────────────────────────────────────────────────────────
api.state.hiddenProviders.add("sensenova");
assert.ok(!api.visibleCatalog().some((g) => g.id === "sensenova"), "隐藏的厂商不在可见目录里");
api.state.hiddenProviders.delete("sensenova");
api.state.hiddenModels.add("raccoon/sn-glm-5.2");
const visibleRaccoon = api.visibleCatalog().find((g) => g.id === "raccoon");
assert.ok(!visibleRaccoon.models.some((m) => m.id === "sn-glm-5.2"), "隐藏的模型不在可见目录里");
assert.equal(visibleRaccoon.models.length, 3, "同厂商其余模型不受影响");

// ── 搜索：模型名 / 厂商名 / 强度名 ───────────────────────────────────────
api.state.hiddenModels.delete("raccoon/sn-glm-5.2");
api.state.expandedProviders.clear();

// 搜索词走 opts.query（组件是纯渲染函数，不读外部状态）
const searchOpts = (query) => ({ ...baseOpts(), query });

api.state.query = "kimi";
api.renderPicker(container, searchOpts("kimi"));
let out = container.innerHTML;
assert.ok(out.includes("sn-kimi-k3"), "模型名命中");
assert.ok(!out.includes("sn-glm-5.2"), "不匹配的模型被过滤");
assert.ok(out.includes("Raccoon"), "命中的厂商父节点保留");
// 搜索时厂商强制展开，因此看得到模型行
assert.ok(out.includes("row-model"), "搜索时厂商自动展开");

api.renderPicker(container, searchOpts("sensenova"));
out = container.innerHTML;
assert.ok(out.includes("SenseNova"), "厂商名命中");
assert.ok(out.includes("kimi-k3"), "厂商命中时展示其全部模型");

api.renderPicker(container, searchOpts("max"));
out = container.innerHTML;
assert.ok(out.includes("sn-kimi-k3"), "强度名命中时保留该模型");

api.renderPicker(container, searchOpts("zzzz-not-exist"));
assert.ok(container.innerHTML.includes("没有匹配"), "无命中时给出空状态");

api.state.query = "";
api.state.current = { provider: "raccoon", model: "sn-deepseek-v4-1-flash-1017", reasoningEffort: "on" };

console.log("prototype: 全部断言通过");
