/**
 * 可见性规则的单元测试（不依赖浏览器）。
 *
 * 运行：node test/visibility.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// 客户端半身是一个 ModuleLoader 工厂；这里只取其中纯逻辑的规则部分，
// 在一个最小的 window 垫片上执行，取出内部类做断言。
const start = source.indexOf("function parseRule(rule)");
const end = source.indexOf("//#endregion", start);
const rulesSource = source.slice(start, end);

const sandbox = { module: { exports: {} } };
const factory = new Function("module", "exports", `${rulesSource}; module.exports = { VisibilityRules, parseRule, modelRule, providerName };`);
factory(sandbox.module, sandbox.module.exports);
const { VisibilityRules, parseRule, modelRule } = sandbox.module.exports;

// ── 规则解析 ──────────────────────────────────────────────────────────────
assert.deepEqual(parseRule("raccoon"), { provider: "raccoon", model: undefined });
assert.deepEqual(parseRule("raccoon/sn-deepseek-v4-1-flash"), { provider: "raccoon", model: "sn-deepseek-v4-1-flash" });
assert.deepEqual(parseRule(""), { provider: "", model: undefined });
assert.deepEqual(parseRule("a/b/c"), { provider: "a", model: "b/c" }, "模型 id 自身可以含斜杠");
assert.equal(modelRule("p", "m"), "p/m");

// ── 厂商级隐藏 ────────────────────────────────────────────────────────────
{
	const rules = new VisibilityRules(["raccoon"], []);
	const groups = rules.filterGroups([
		{ id: "raccoon", models: [{ id: "m1" }] },
		{ id: "other", models: [{ id: "m2" }] }
	]);
	assert.deepEqual(groups.map((g) => g.id), ["other"], "被隐藏的厂商整组消失");
	assert.equal(rules.isProviderHidden("raccoon"), true);
	assert.equal(rules.isModelHidden("raccoon", "m1"), true, "厂商隐藏时其模型也隐藏");
}

// ── 模型级隐藏 ────────────────────────────────────────────────────────────
{
	const rules = new VisibilityRules([], ["raccoon/m2"]);
	const groups = rules.filterGroups([{ id: "raccoon", models: [{ id: "m1" }, { id: "m2" }] }]);
	assert.deepEqual(groups[0].models.map((m) => m.id), ["m1"], "只隐藏被点名的那一个模型");
	assert.equal(rules.isModelHidden("raccoon", "m1"), false);
	assert.equal(rules.isModelHidden("raccoon", "m2"), true);
}

// ── 厂商隐藏后只剩空分组时整组消失 ────────────────────────────────────────
{
	const rules = new VisibilityRules([], ["raccoon/m1", "raccoon/m2"]);
	const groups = rules.filterGroups([{ id: "raccoon", models: [{ id: "m1" }, { id: "m2" }] }]);
	assert.deepEqual(groups, [], "所有模型都被隐藏的分组不再显示");
}

// ── 往返：规则 → 数组 → 规则 ──────────────────────────────────────────────
{
	const original = new VisibilityRules(["b", "a"], ["z/z2", "a/a1"]);
	const arrays = original.toArrays();
	assert.deepEqual(arrays.hiddenProviders, ["a", "b"], "厂商按字典序导出");
	assert.deepEqual(arrays.hiddenModels, ["a/a1", "z/z2"], "模型规则按字典序导出");
	const restored = new VisibilityRules(arrays.hiddenProviders, arrays.hiddenModels);
	assert.deepEqual(restored.toArrays(), arrays, "往返稳定");
}

// ── 增删单项的操作（设置页用） ───────────────────────────────────────────
{
	const rules = new VisibilityRules(["x"], ["p/m1"]);
	const flat = [];
	for (const [provider, bucket] of rules.models) for (const model of bucket) flat.push(modelRule(provider, model));
	const next = new VisibilityRules(rules.providers, flat);
	const bucket = next.models.get("p");
	bucket.delete("m1");
	next.models.set("q", new Set(["n1"]));
	const arrays = next.toArrays();
	assert.deepEqual(arrays.hiddenProviders, ["x"]);
	assert.deepEqual(arrays.hiddenModels, ["q/n1"], "删掉的模型不再出现，新加的模型出现");
}

console.log("visibility: 全部断言通过");
