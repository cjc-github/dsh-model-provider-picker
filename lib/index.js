import z from "@deepseek-ai/schemastery";
import { readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
//#region lib/types/index.js
/**
 * 隐藏规则：两个数组都是「可见性白名单的反面」——
 * `hiddenProviders` 列出完全不显示的厂商 id，`hiddenModels` 列出
 * `provider/model` 组合（只在该厂商下隐藏这一个模型）。
 *
 * 两组值都是普通字符串数组，没有嵌套结构，因此可以被 Host 的 settings
 * 文档安全地投影、编辑与持久化。
 *
 * 凭证回显是 **opt-in** 的：
 * - `revealKeysEnabled` 开关默认关闭，关闭时 `revealedKeys` 恒为空映射；
 * - 开启时 Host 半身才读取本地凭证写入投影，并监听凭证文件实时刷新。
 *
 * 注意：settings 通道（含 volatile 字段）会落盘到 profile 的
 * `cordis.patch.yml`，所以开启期间明文 Key 会进入该文件——这是该功能
 * 的已知代价。用完请关闭开关，关闭即把投影写回空映射清除。
 */
const Config = z.object({
	hiddenProviders: z.array(z.string()).default([]).volatile(),
	hiddenModels: z.array(z.string()).default([]).volatile(),
	revealKeysEnabled: z.boolean().default(false).volatile(),
	revealedKeys: z.dict(z.string()).default({}).volatile()
});
/** 只有形如 `*_API_KEY` 的引用才允许被回显；OAuth 类记录一律排除。 */
const KEY_REF_PATTERN = /^[A-Z0-9_]+_API_KEY$/;
/**
 * 从凭证文件文本解析 refs 段的明文 Key（纯函数，便于测试）。
 *
 * refs 段是扁平的 `  NAME: value`（两空格缩进）映射，这里按行读取而不
 * 引入 YAML 依赖——本插件只依赖 node 内置，避免安装环境差异导致解析失败。
 */
function parseRevealedKeys(text) {
	const out = {};
	let inRefs = false;
	for (const line of String(text ?? "").split(/\r?\n/)) {
		if (/^refs:\s*$/.test(line)) {
			inRefs = true;
			continue;
		}
		// 顶格内容意味着已离开 refs 段。
		if (inRefs && line.length > 0 && !/^\s/.test(line)) break;
		if (!inRefs) continue;
		const match = line.match(/^ {2}([A-Za-z0-9_]+):\s*(.+?)\s*$/);
		if (match === null) continue;
		const [, name, raw] = match;
		if (!KEY_REF_PATTERN.test(name)) continue;
		const value = raw.replace(/^['"]|['"]$/g, "").trim();
		if (value.length > 0) out[name] = value;
	}
	return out;
}
/**
 * 合并进程环境变量来源（LocalCredentialProvider.resolve 的 inherit 分支
 * 是合法来源之一）。纯函数，便于测试。
 *
 * 同名的文件值优先——文件比进程环境更显式、更稳定。
 */
function mergeEnvKeys(base, env) {
	const out = { ...base };
	for (const [name, value] of Object.entries(env ?? {})) {
		if (!KEY_REF_PATTERN.test(name)) continue;
		if (typeof value !== "string" || value.length === 0) continue;
		if (out[name] === undefined) out[name] = value;
	}
	return out;
}
function credentialsPath() {
	return join(homedir(), ".dsh", ".credentials.yaml");
}
/** 读取本地凭证明文（文件 refs 段 + 环境变量）；任何异常静默降级。 */
function readRevealedKeys() {
	let parsed = {};
	try {
		parsed = parseRevealedKeys(readFileSync(credentialsPath(), "utf8"));
	} catch {
		// 文件缺失或不可读：继续走环境变量。
	}
	return mergeEnvKeys(parsed, process.env);
}
/**
 * Host 半身声明偏好存储与凭证回显。
 *
 * 自动生成设置页被关闭：本插件自己在设置中提供一个专用页面，
 * 而不是让 Host 生成一份通用表单。
 *
 * 回显链路只在 `revealKeysEnabled` 为真时工作：读取明文、写入投影、
 * 监听凭证文件变化（400ms 防抖）实时刷新；开关关闭时把投影写回空
 * 映射并停止监听。`refresh` 自带等值守卫，避免「写投影 → 事件 → 再写」
 * 的回环；写入失败时清掉守卫，允许下次重试。
 * @param ctx 插件上下文。
 */
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
		const state = {
			watcher: null,
			timer: 0,
			last: null
		};
		const enabled = () => {
			try {
				return ctx.config.revealKeysEnabled === true;
			} catch {
				return false;
			}
		};
		const stopWatch = () => {
			if (state.watcher === null) return;
			try {
				state.watcher.close();
			} catch {
				// 已经关闭。
			}
			state.watcher = null;
		};
		const refresh = async () => {
			const keys = enabled() ? readRevealedKeys() : {};
			const serialized = JSON.stringify(keys);
			if (serialized === state.last) return;
			state.last = serialized;
			try {
				await child.settings.mutate("model-provider-picker", [
					{ op: "set", path: ["revealedKeys"], value: keys }
				], undefined);
			} catch {
				// 投影不可写时保持原样，不影响其余功能；清掉守卫允许重试。
				state.last = null;
			}
		};
		const startWatch = () => {
			if (state.watcher !== null) return;
			try {
				// 监听目录而非单文件：原子写（rename 替换）会让单文件 watcher 失效。
				const dir = join(homedir(), ".dsh");
				state.watcher = watch(dir, (_event, filename) => {
					if (filename !== undefined && filename !== ".credentials.yaml") return;
					clearTimeout(state.timer);
					state.timer = setTimeout(() => {
						refresh().catch(() => {});
					}, 400);
				});
				state.watcher.on("error", () => {
					stopWatch();
				});
			} catch {
				state.watcher = null;
			}
		};
		const sync = async () => {
			await refresh();
			if (enabled()) startWatch();
			else stopWatch();
		};
		child.effect(() => {
			sync().catch(() => {});
			return () => {
				clearTimeout(state.timer);
				stopWatch();
			};
		});
		// 配置变化（含开关翻转）后重算。
		child.on("loader/volatile-update", () => {
			sync().catch(() => {});
		});
	});
}
//#endregion
export { Config, apply, mergeEnvKeys, parseRevealedKeys };
