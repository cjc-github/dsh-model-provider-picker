/**
 * 预设库与提交流程的单元测试（不依赖浏览器）。
 *
 * 运行：node test/presets.test.mjs
 *
 * 覆盖：
 * 1. 预设数据完整性（route 合法、URL 合法、协议合法、无重复）
 * 2. deriveKeyRef 与宿主官方规则一致
 * 3. 提交归一化逻辑（尾部斜杠、空行、重复 id、名称回退）
 * 4. 编辑合并语义（字段保全、清 Key 判定）
 * 5. 失效隐藏规则统计与清理
 * 6. Host 半身的 parseRevealedKeys / mergeEnvKeys
 * 7. zh/en 文案键集合一致
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(join(here, "..", "lib", "client.js"), "utf8");

// ── 从 client.js 抽取纯逻辑段 ─────────────────────────────────────────────
function extract(startMarker, endMarker) {
	const s = clientSource.indexOf(startMarker);
	assert.ok(s >= 0, `marker not found: ${startMarker.slice(0, 40)}`);
	const e = clientSource.indexOf(endMarker, s);
	assert.ok(e > s, `end marker not found after: ${startMarker.slice(0, 40)}`);
	return clientSource.slice(s, e);
}

const presetsRegion = extract("//#region presets", "//#endregion");
// presetsRegion 里含 PresetManager 组件（依赖 React），只取到组件声明之前。
const pureEnd = presetsRegion.indexOf("/** 预设库面板");
const pureSource = presetsRegion.slice(0, pureEnd >= 0 ? pureEnd : presetsRegion.length);

const sandbox = { window: {} };
const factory = new Function("require", "window", `${pureSource};
return { PRESETS, ROUTE_PATTERN, PROTOCOLS, deriveKeyRef, isHttpUrl };`);
const { PRESETS, ROUTE_PATTERN, PROTOCOLS, deriveKeyRef, isHttpUrl } = factory(() => ({}), sandbox.window);
assert.ok(PRESETS && PRESETS.length > 0, "PRESETS extracted");

// ── 1. 预设数据完整性 ────────────────────────────────────────────────────
{
	const seen = new Set();
	for (const preset of PRESETS) {
		assert.ok(ROUTE_PATTERN.test(preset.route), `route invalid: ${preset.route}`);
		assert.ok(isHttpUrl(preset.baseURL), `baseURL invalid: ${preset.route} -> ${preset.baseURL}`);
		assert.ok(PROTOCOLS.includes(preset.api), `api invalid: ${preset.route} -> ${preset.api}`);
		assert.ok(!seen.has(preset.route), `duplicate route: ${preset.route}`);
		seen.add(preset.route);
		assert.ok(["cn", "global"].includes(preset.category), `category invalid: ${preset.route}`);
		const ids = new Set();
		for (const model of preset.models) {
			assert.ok(typeof model.id === "string" && model.id.trim() !== "", `bad model in ${preset.route}`);
			assert.ok(!ids.has(model.id), `duplicate model ${model.id} in ${preset.route}`);
			ids.add(model.id);
			if (model.contextWindow !== undefined) {
				assert.ok(Number.isFinite(model.contextWindow) && model.contextWindow > 0, `bad contextWindow in ${preset.route}/${model.id}`);
			}
		}
	}
	assert.ok(PRESETS.length >= 15, `expected at least 15 presets, got ${PRESETS.length}`);
}

// ── 2. deriveKeyRef 与宿主规则一致（大写 + 非字母数字段转下划线）─────────
assert.equal(deriveKeyRef("sensenova"), "SENSENOVA_API_KEY");
assert.equal(deriveKeyRef("minimax-cn"), "MINIMAX_CN_API_KEY");
assert.equal(deriveKeyRef("a-b-c"), "A_B_C_API_KEY");

// ── 3. 提交归一化：复刻 submit 的清洗逻辑并断言 ──────────────────────────
// client.js 的 submit 内联了这段；测试用同构实现锁定语义。
function normalizeSubmit(draft) {
	const baseURL = draft.baseURL.trim().replace(/\/+$/, "");
	const seen = new Set();
	const models = [];
	for (const model of draft.models) {
		const id = model.id.trim();
		if (id === "" || seen.has(id)) continue;
		seen.add(id);
		models.push({ ...model, id });
	}
	return { baseURL, models };
}
{
	const { baseURL, models } = normalizeSubmit({
		baseURL: "https://api.x.com/v1///",
		models: [
			{ id: " a " }, { id: "a" }, { id: "  " }, { id: "b", name: "B", contextWindow: 1000 }
		]
	});
	assert.equal(baseURL, "https://api.x.com/v1", "trailing slashes trimmed");
	assert.deepEqual(models.map((m) => m.id), ["a", "b"], "empty and duplicate ids dropped");
	assert.equal(models[1].name, "B");
	assert.equal(models[1].contextWindow, 1000);
}

// 创建分支的名称回退：表单名 trim 后为空则用 id。
function createdName(model) {
	return (model.name ?? "").trim() || model.id;
}
assert.equal(createdName({ id: "glm-5.3", name: "  " }), "glm-5.3");
assert.equal(createdName({ id: "glm-5.3", name: "GLM 5.3" }), "GLM 5.3");
assert.equal(createdName({ id: "glm-5.3" }), "glm-5.3");

// ── 4. 编辑合并语义 ──────────────────────────────────────────────────────
function mergeEdit(base, formModels, displayName, keyValue) {
	const priorModels = Array.isArray(base.models) ? base.models : [];
	const keyRef = "X_API_KEY";
	const clearsKey = keyValue === "" && typeof base.apiKeyEnv === "string" && base.apiKeyEnv !== "";
	const next = {
		...base,
		...(displayName.trim() === "" ? {} : { displayName: displayName.trim() }),
		api: "openai-completions",
		baseURL: "https://x/v1",
		models: formModels.map((model) => {
			const formName = (model.name ?? "").trim();
			const prior = priorModels.find((c) => c !== null && typeof c === "object" && c.id === model.id);
			if (prior === undefined) return { id: model.id, name: formName || model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) };
			return { ...prior, name: formName || prior.name || model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) };
		})
	};
	if (clearsKey) delete next.apiKeyEnv;
	else if (keyValue !== "") next.apiKeyEnv = keyRef;
	return { next, clearsKey };
}
{
	const base = {
		apiKeyEnv: "X_API_KEY",
		exotic: "keep-me",
		models: [{ id: "m1", name: "M1", input: ["text", "image"], maxTokens: 4096 }]
	};
	const { next, clearsKey } = mergeEdit(base, [{ id: "m1", name: "  " }], "", "");
	assert.equal(clearsKey, true, "empty key over existing apiKeyEnv clears it");
	assert.equal(next.apiKeyEnv, undefined, "apiKeyEnv removed");
	assert.equal(next.exotic, "keep-me", "unknown profile fields preserved");
	assert.deepEqual(next.models[0].input, ["text", "image"], "model input modalities preserved");
	assert.equal(next.models[0].maxTokens, 4096, "model maxTokens preserved");
	assert.equal(next.models[0].name, "M1", "empty form name falls back to prior name");
	assert.equal(next.displayName, undefined, "empty displayName not written");
}
{
	const base = { models: [{ id: "m1", name: "M1" }] };
	const { next, clearsKey } = mergeEdit(base, [{ id: "m1", name: "Renamed" }, { id: "m2", name: "" }], "Show", "k");
	assert.equal(clearsKey, false);
	assert.equal(next.apiKeyEnv, "X_API_KEY", "typed key re-attaches reference");
	assert.equal(next.displayName, "Show");
	assert.equal(next.models[0].name, "Renamed", "form name wins");
	assert.equal(next.models[1].name, "m2", "new row falls back to id");
}

// ── 5. 失效隐藏规则统计与清理 ────────────────────────────────────────────
function countStale(rulesMap, groups) {
	return groups.reduce((sum, group) => {
		const hidden = rulesMap.get(group.id);
		if (hidden === undefined) return sum;
		const active = (group.models ?? []).filter((m) => hidden.has(m.id)).length;
		return sum + (hidden.size - active);
	}, 0);
}
{
	const rules = new Map([["maas", new Set(["spark-x2.6-4b", "spark-x2.5", "xopglm5"])]]);
	const groups = [{ id: "maas", models: [{ id: "spark-x2.6" }, { id: "spark-x2.6-4b" }] }];
	assert.equal(countStale(rules, groups), 2, "two rules point to removed models");
	// 徽章只数仍然存在的隐藏模型
	const badge = groups[0].models.filter((m) => rules.get("maas").has(m.id)).length;
	assert.equal(badge, 1, "badge counts only live hidden models");
}
{
	// 整厂不在目录时保留其规则（厂商可能暂时缺席）
	const rules = new Map([["stepfun", new Set(["step-3.5-flash"])]]);
	const groups = [{ id: "maas", models: [{ id: "spark-x2.6" }] }];
	assert.equal(countStale(rules, groups), 0, "provider absent from catalog keeps its rules");
}

// ── 6. Host 半身的 parseRevealedKeys / mergeEnvKeys ──────────────────────
const hostSource = readFileSync(join(here, "..", "lib", "index.js"), "utf8");
const hostFactory = new Function("z", "require", `
${hostSource.replace(/^import[^;]+;/gm, "").replace(/^export \{[^}]*\};?/gm, "")}
return { parseRevealedKeys, mergeEnvKeys, Config };`);
const noopSchema = new Proxy(function () {}, { get: () => noopSchema, apply: () => noopSchema });
const { parseRevealedKeys, mergeEnvKeys } = hostFactory(noopSchema, () => noopSchema);
{
	const text = [
		"version: 1",
		"records:",
		"  some/thing:",
		"    kind: grant",
		"refs:",
		"  SENSENOVA_API_KEY: sk-abc123",
		"  MAAS_API_KEY: 'ak-quoted'",
		"  MINIMAX_ACCOUNT_79135CC8: '{\"access_token\":\"x\"}'",
		"  EMPTY_KEY_API_KEY:",
		"next-section:",
		"  AFTER_KEY_API_KEY: sk-nope",
	].join("\n");
	const parsed = parseRevealedKeys(text);
	assert.equal(parsed.SENSENOVA_API_KEY, "sk-abc123");
	assert.equal(parsed.MAAS_API_KEY, "ak-quoted", "quotes stripped");
	assert.equal(parsed.MINIMAX_ACCOUNT_79135CC8, undefined, "non *_API_KEY refs excluded");
	assert.equal(parsed.EMPTY_KEY_API_KEY, undefined, "empty values skipped");
	assert.equal(parsed.AFTER_KEY_API_KEY, undefined, "stops at next top-level section");
}
{
	const merged = mergeEnvKeys({ A_API_KEY: "from-file" }, { A_API_KEY: "from-env", B_API_KEY: "env-only", NOPE: "x" });
	assert.equal(merged.A_API_KEY, "from-file", "file wins over env");
	assert.equal(merged.B_API_KEY, "env-only");
	assert.equal(merged.NOPE, undefined);
}

// ── 7. zh/en 文案键集合一致 ──────────────────────────────────────────────
{
	const zhStart = clientSource.indexOf("const zh = {");
	const enStart = clientSource.indexOf("const en = {");
	const enEnd = clientSource.indexOf("//#endregion", enStart);
	const keyRe = /^\t\t\t"([^"]+)":/gm;
	const zhKeys = [...clientSource.slice(zhStart, enStart).matchAll(keyRe)].map((m) => m[1]).sort();
	const enKeys = [...clientSource.slice(enStart, enEnd).matchAll(keyRe)].map((m) => m[1]).sort();
	assert.ok(zhKeys.length > 60, `zh keys found: ${zhKeys.length}`);
	const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
	const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
	assert.deepEqual(missingInZh, [], "keys missing in zh");
	assert.deepEqual(missingInEn, [], "keys missing in en");
	// 代码里引用的每个 t("...") 静态键都必须存在
	const usedKeys = [...new Set([...clientSource.matchAll(/\bt\("([^"]+)"(?:,|\))/g)].map((m) => m[1]))];
	const absent = usedKeys.filter((k) => !zhKeys.includes(k));
	assert.deepEqual(absent, [], `t() keys not in dictionary: ${absent.join(", ")}`);
}

console.log("presets: 全部断言通过");
