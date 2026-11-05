import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
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
 * `revealedKeys` 是运行时-only 的凭证回显映射（volatile，不落盘、不产生
 * 第二份明文文件）：Host 侧读 ~/.dsh/.credentials.yaml 的 refs 段，把
 * `*_API_KEY` 的明文按 ref 名放进这里，浏览器半身据此预填编辑表单。
 * 宿主 credentials/set 是「只写」的，官方没有读值接口；这里走的是插件
 * 自己的 Host 半身读本地文件，值只在会话内的设置投影里流转。
 */
const Config = z.object({
	hiddenProviders: z.array(z.string()).default([]).volatile(),
	hiddenModels: z.array(z.string()).default([]).volatile(),
	revealedKeys: z.dict(z.string()).default({}).volatile()
});
/**
 * 读取本地凭证的明文 Key：文件 refs 段 + 进程环境变量。
 *
 * refs 段是扁平的 `  NAME: value`（两空格缩进）映射，这里按行读取而不引入
 * 额外的 YAML 依赖——本插件只依赖 node 内置，避免安装环境差异导致解析
 * 失败。环境变量是 LocalCredentialProvider.resolve() 的另一条合法来源
 * （inherit 分支），有些 Key（如走 env 注入的）只存在于那里。
 *
 * 只收 ref 名形如 `*_API_KEY` 的项；任何异常都静默降级为空映射，
 * 绝不让插件启动失败。同名的环境变量不覆盖文件里的值（文件更显式）。
 */
function readRevealedKeys() {
	const out = {};
	try {
		const file = join(homedir(), ".dsh", ".credentials.yaml");
		const lines = readFileSync(file, "utf8").split(/\r?\n/);
		let inRefs = false;
		for (const line of lines) {
			if (/^refs:\s*$/.test(line)) { inRefs = true; continue; }
			if (inRefs && line.length > 0 && !/^\s/.test(line)) break; // 离开 refs 段
			if (!inRefs) continue;
			const match = line.match(/^ {2}([A-Za-z0-9_]+):\s*(.+?)\s*$/);
			if (match === null) continue;
			const [, name, raw] = match;
			if (!/^[A-Z0-9_]+_API_KEY$/.test(name)) continue;
			const value = raw.replace(/^['"]|['"]$/g, "").trim();
			if (value.length > 0) out[name] = value;
		}
	} catch {
		// 文件缺失或不可读：继续走环境变量。
	}
	for (const [name, value] of Object.entries(process.env)) {
		if (!/^[A-Z0-9_]+_API_KEY$/.test(name)) continue;
		if (typeof value !== "string" || value.length === 0) continue;
		if (out[name] === undefined) out[name] = value;
	}
	return out;
}
/**
 * Host 半身只声明偏好存储；浏览器半身通过配置的表单投影读写这两组值。
 *
 * 自动生成设置页被关闭：本插件自己在设置中提供一个专用页面，
 * 而不是让 Host 生成一份通用表单。
 *
 * 启动时把本地凭证明文写入 volatile 的 revealedKeys 字段，供浏览器半身
 * 的编辑表单预填。用 settings.mutate 定点写入，不触碰 hiddenProviders /
 * hiddenModels 等已保存的用户偏好。
 * @param ctx 插件上下文，用于关闭自动生成的设置页。
 */
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
		child.effect(async () => {
			const keys = readRevealedKeys();
			try {
				await child.settings.mutate("model-provider-picker", [
					{ op: "set", path: ["revealedKeys"], value: keys }
				], undefined);
			} catch {
				// 设置投影不可写时保持空映射即可，不影响其余功能。
			}
		});
	});
}
//#endregion
export { Config, apply };
