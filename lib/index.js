import z from "@deepseek-ai/schemastery";
//#region lib/types/index.js
/**
 * 隐藏规则：两个数组都是「可见性白名单的反面」——
 * `hiddenProviders` 列出完全不显示的厂商 id，`hiddenModels` 列出
 * `provider/model` 组合（只在该厂商下隐藏这一个模型）。
 *
 * 两组值都是普通字符串数组，没有嵌套结构，因此可以被 Host 的 settings
 * 文档安全地投影、编辑与持久化。
 */
const Config = z.object({
	hiddenProviders: z.array(z.string()).default([]).volatile(),
	hiddenModels: z.array(z.string()).default([]).volatile()
});
/**
 * Host 半身只声明偏好存储；浏览器半身通过配置的表单投影读写这两组值。
 *
 * 自动生成设置页被关闭：本插件自己在设置中提供一个专用页面，
 * 而不是让 Host 生成一份通用表单。
 * @param ctx 插件上下文，用于关闭自动生成的设置页。
 */
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}
//#endregion
export { Config, apply };
