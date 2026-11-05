/**
 * dsh-model-provider-picker —— 浏览器半身。
 *
 * 两件事：
 *   1. 把 composer 的模型位换成「先选厂商、再选该厂商下的模型」两级选择器；
 *   2. 在设置里提供一个页面，用复选框决定哪些厂商或模型不显示。
 *
 * 隐藏规则存在 Host 的设置命名空间 `model-provider-picker` 里，因此
 * 「设置里改的」与「选择器里隐藏的」是同一份事实，两侧共享同一套
 * 过滤语义。
 *
 * 手写的 ModuleLoader 半身，无构建步骤：只依赖 React 与 shell 已经
 * 提供的 cordis / primitives / client-store。
 */
window.__ModuleLoader__.load({
	id: "dsh-model-provider-picker",
	factory: (require) => {
		const module = { exports: {} };
		const exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const { createElement: h, Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");
		//#region visibility
		/** 隐藏规则解析：厂商级规则没有模型段，模型级规则是 `provider/model`。 */
		function parseRule(rule) {
			const text = String(rule ?? "").trim();
			if (text === "") return { provider: "", model: undefined };
			const at = text.indexOf("/");
			if (at < 0) return { provider: text, model: undefined };
			const provider = text.slice(0, at);
			const model = text.slice(at + 1);
			return { provider, model: model === "" ? undefined : model };
		}
		/** 构造一条模型级隐藏规则。 */
		function modelRule(provider, model) {
			return `${provider}/${model}`;
		}
		/**
		 * 一组隐藏规则：整厂商隐藏 + 单模型隐藏。
		 *
		 * 厂商被整体隐藏后，它下面的模型规则自然失效，因此判断模型是否
		 * 隐藏时先看厂商级规则。
		 */
		class VisibilityRules {
			/**
			 * @param {Iterable<string>} providers 整厂商隐藏的厂商 id。
			 * @param {Iterable<string>} models 模型级隐藏规则原文。
			 */
			constructor(providers = [], models = []) {
				this.providers = new Set();
				for (const value of providers) {
					const text = String(value ?? "").trim();
					if (text !== "") this.providers.add(text);
				}
				this.models = new Map();
				for (const value of models) {
					const text = String(value ?? "").trim();
					if (text === "") continue;
					const { provider, model } = parseRule(text);
					if (provider === "" || model === undefined) continue;
					let bucket = this.models.get(provider);
					if (bucket === undefined) {
						bucket = new Set();
						this.models.set(provider, bucket);
					}
					bucket.add(model);
				}
			}
			/** 厂商是否被整体隐藏。 */
			isProviderHidden(provider) {
				return this.providers.has(provider);
			}
			/** 模型是否被隐藏。 */
			isModelHidden(provider, model) {
				if (this.providers.has(provider)) return true;
				const bucket = this.models.get(provider);
				return bucket !== undefined && bucket.has(model);
			}
			/** 过滤一个目录分组；整厂商隐藏时返回 undefined。 */
			filterGroup(group) {
				if (this.providers.has(group.id)) return undefined;
				const bucket = this.models.get(group.id);
				const models = (group.models ?? []).filter((model) => bucket === undefined || !bucket.has(model.id));
				return { ...group, models };
			}
			/** 过滤整份目录，并丢弃没有模型的分组。 */
			filterGroups(groups) {
				const out = [];
				for (const group of groups ?? []) {
					const filtered = this.filterGroup(group);
					if (filtered === undefined) continue;
					if (filtered.models.length === 0) continue;
					out.push(filtered);
				}
				return out;
			}
			/** 导出成可写回 Host 的两组数组。 */
			toArrays() {
				const models = [];
				for (const [provider, bucket] of this.models) for (const model of bucket) models.push(modelRule(provider, model));
				models.sort();
				return {
					hiddenProviders: [...this.providers].sort(),
					hiddenModels: models
				};
			}
		}
		/** 厂商的展示名：DeepSeek 账号用固定名字，其余用目录自带的名字。 */
		function providerName(group, accountName) {
			return group.id === "deepseek-account" ? accountName : group.name ?? group.id;
		}
		/** 把当前规则摊平成「厂商 id → 模型 id 集合」的等价形式，便于增删单项。 */
		function flattenModels(rules) {
			const out = [];
			for (const [provider, bucket] of rules.models) for (const model of bucket) out.push(modelRule(provider, model));
			return out;
		}
		//#endregion
		//#region styles
		const CSS = `
.mpp_root{min-width:0;position:relative}
.mpp_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:5px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}
.mpp_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mpp_trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.mpp_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.mpp_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary)}
/* 触发器里的厂商名：比模型名更淡、更短，最多占 9em，超长省略 */
.mpp_triggerProvider{max-width:9em;text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);flex:none}
.mpp_triggerSep{color:var(--dsw-alias-label-caption);flex:none}
.mpp_triggerEffort{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;line-height:16px}
.mpp_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.mpp_chevronOpen{transform:rotate(180deg)}
.mpp_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}
.mpp_status,.mpp_empty{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:12px;line-height:18px}
.mpp_error{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);padding:8px;font-size:12px;line-height:18px}
.mpp_check{flex:none;display:flex;align-items:center;color:var(--dsw-alias-state-business-primary)}
.mpp_head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:4px}
.mpp_headTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);min-width:0;flex:none}
.mpp_headSub{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_backButton{display:flex;align-items:center;border:none;background:0 0;cursor:pointer;padding:3px;color:var(--dsw-alias-label-caption);border-radius:var(--dsw-radius-sm);line-height:0;flex:none}
.mpp_backButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mpp_searchRow{display:flex;align-items:center;gap:4px;padding:0 4px 6px}
.mpp_search{flex:1;min-width:0}
.mpp_tree{display:flex;flex-direction:column;min-height:0;overflow-y:auto;padding-right:2px}
.mpp_children{display:flex;flex-direction:column}
.mpp_row{display:flex;align-items:center;gap:6px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;outline:none;padding:7px 10px;font-size:13px;font-weight:400;line-height:20px;width:100%;text-align:left}
.mpp_row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.mpp_row:disabled{cursor:default}
.mpp_rowProvider{font-weight:500;color:var(--dsw-alias-label-primary)}
.mpp_rowCurrent{background:var(--dsw-alias-interactive-bg-hover)}
.mpp_rowModel{padding-left:26px;color:var(--dsw-alias-label-secondary)}
.mpp_rowSelected{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mpp_rowLabel{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_effortTag{font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap}
.mpp_count{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap;flex:none}
.mpp_rowEffort{padding:8px 12px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.mpp_rowEffortActive{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
.mpp_effortDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-border-l1)}
.mpp_rowEffortActive .mpp_effortDot{background:var(--dsw-alias-state-business-primary)}
.mpp_settings{display:flex;flex-direction:column;gap:16px;padding:4px 0}
.mpp_section{display:flex;flex-direction:column;gap:8px}
.mpp_sectionHead{display:flex;align-items:center;gap:8px}
.mpp_cleanupLink{font-size:11px;color:var(--dsw-alias-state-business-primary);background:0 0;border:none;cursor:pointer;padding:2px 6px;border-radius:var(--dsw-radius-sm)}
.mpp_cleanupLink:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mpp_sectionTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.mpp_hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0;line-height:18px}
.mpp_group{border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l1);padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.mpp_groupHead{display:flex;align-items:center;gap:8px}
.mpp_expandButton{display:flex;align-items:center;border:none;background:0 0;cursor:pointer;padding:2px;color:var(--dsw-alias-label-caption);border-radius:var(--dsw-radius-sm)}
.mpp_expandButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mpp_groupName{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);min-width:0;max-width:40%;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_groupId{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_models{display:flex;flex-direction:column;gap:2px;padding-left:22px}
.mpp_modelRow{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mpp_modelName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_switchCell{flex:none;display:flex;align-items:center}
.mpp_revealRow{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px}
.mpp_revealText{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}
.mpp_revealWarn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-primary));margin:0}
/* 设置页里厂商行的模型数量：固定一列、右对齐、等宽数字，避免随厂商名长短漂移 */
.mpp_groupCount{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;min-width:2.5ch;text-align:right;font-variant-numeric:tabular-nums}
.mpp_badge{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;white-space:nowrap;flex:none}
/* 厂商预设库：设置页里的一键添加区块 */
.mpp_presets{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px}
.mpp_presetsHead{display:flex;align-items:center;gap:8px}
.mpp_presetsTitle{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);flex:1;min-width:0}
.mpp_catChips{display:flex;gap:6px;flex-wrap:wrap}
.mpp_chip{font-size:12px;line-height:20px;padding:1px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mpp_chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mpp_chipActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.mpp_presetList{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;padding-right:2px}
.mpp_presetRow{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:7px 10px}
.mpp_customRow{border-style:dashed}
.mpp_presetInfo{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.mpp_presetName{font-size:13px;color:var(--dsw-alias-label-primary);display:flex;gap:6px;align-items:center;min-width:0}
.mpp_presetMeta{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpp_presetActions{display:flex;gap:6px;flex:none}
.mpp_badgeOk{color:var(--dsw-alias-state-business-primary)}
.mpp_miniButton{font-size:12px;line-height:18px;padding:2px 10px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;flex:none}
.mpp_miniButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mpp_miniButton:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}
.mpp_miniButtonDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mpp_iconButton{width:26px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}
.mpp_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mpp_iconButton:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}
.mpp_iconButtonDanger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.mpp_primary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary)}
.mpp_formGrid{display:flex;flex-direction:column;gap:10px}
.mpp_formRow{display:flex;flex-direction:column;gap:4px;min-width:0}
.mpp_formRow2{display:flex;gap:8px}
.mpp_formRow2>.mpp_formRow{flex:1 1 0%;width:0;min-width:0}
.mpp_formLabel{font-size:12px;color:var(--dsw-alias-label-secondary)}
.mpp_formInput{width:100%}
/* 宿主 Input 自带默认宽度会压过单类选择器，这里用两级选择器钉死铺满 */
.mpp_formRow .mpp_formInput{width:100%;max-width:100%;box-sizing:border-box}
select.mpp_formInput{height:var(--dsw-control-height,32px)}
.mpp_submitRow{justify-content:flex-end}
.mpp_modelRowEdit{display:flex;gap:6px;align-items:center}
.mpp_modelRowEdit .mpp_formInput{width:auto}
.mpp_modelHead{display:flex;gap:6px;padding:0 0 2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.mpp_colId{flex:1.15}
.mpp_colName{flex:1}
.mpp_colCtx{width:84px}
.mpp_colBtn{width:26px}
.mpp_modelId{flex:1.15;min-width:0}
.mpp_modelName{flex:1;min-width:0}
.mpp_modelContext{width:84px;flex:none}
.mpp_keyRow{display:flex;gap:6px;align-items:center}
.mpp_keyRow .mpp_formInput{flex:1 1 0%;width:0;min-width:0}
.mpp_formActions{display:flex;gap:8px;align-items:center}
`;
		const styleTagId = "dsh-model-provider-picker";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(styleTagId)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = styleTagId;
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region locales
		/** 本插件拥有的字典命名空间。 */
		const NS = "modelProviderPicker";
		/** 简体中文文案（键集合的来源）。 */
		const zh = {
			"nav": "模型选择器",
			"hint": "模型选择器是两级列表：默认只显示厂商，点厂商整行就在下方展开它的模型；点模型后再选推理等级。顶部的搜索框可按厂商名、模型名或强度名过滤。此处关掉的厂商或模型不会出现在选择器里。",
			"providersTitle": "厂商",
			"providerHidden": "已隐藏",
			"providerVisible": "显示中",
			"hideProvider": "隐藏该厂商",
			"showProvider": "显示该厂商",
			"hideModel": "隐藏该模型",
			"showModel": "显示该模型",
			"hiddenModels": "已隐藏 {count} 个模型",
			"cleanupStale": "清理 {count} 条失效规则",
			"cleanupStaleTitle": "这些隐藏规则指向的模型已不在当前目录里（多为配置精简后的遗留），点击一并清掉。",
			"effortCount": "{count} 档强度",
			"emptyProviders": "当前没有可用的厂商。请先在「模型」设置里配置至少一个提供方。",
			"emptyModels": "该厂商下没有可显示的模型。",
			"saveFailed": "保存失败：{message}",
			"saving": "保存中…",
			"saved": "已保存",
			"loadingProviders": "正在读取厂商目录…",
			"trigger.fallback": "请选择模型",
			"trigger.loading": "正在加载模型…",
			"trigger.aria": "选择模型，当前 {model}",
			"trigger.ariaEffort": "选择模型，当前 {model}，推理等级 {effort}",
			"menu.aria": "选择厂商与模型",
			"menu.models": "选择模型",
			"menu.effort": "选择推理等级",
			"menu.back": "返回模型列表",
			"menu.expandHint": "点厂商展开模型",
			"effort.providerDefault": "默认",
			"status.loading": "正在加载模型列表…",
			"status.empty": "暂无可用模型",
			"empty.efforts": "当前模型未提供推理等级。",
			"error.action": "模型操作失败：{message}",
			"error.sessionInUse": "当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。",
			"action.reload": "重新加载",
			"search.placeholder": "搜索厂商、模型或强度…",
			"search.empty": "没有匹配的厂商、模型或强度。",
			"preset.title": "厂商预设库",
			"preset.hint": "从常见厂商一键添加模型配置：选预设、填 API Key 即可写入，添加后立即出现在选择器里。已有配置不会被覆盖；模型清单可稍后用「从 API 拉取」刷新。",
			"preset.add": "添加厂商",
			"preset.close": "收起",
			"preset.back": "返回预设列表",
			"preset.loading": "读取中…",
			"preset.search": "搜索厂商…",
			"preset.searchEmpty": "没有匹配的预设。",
			"preset.cat.all": "全部",
			"preset.cat.cn": "国内官方",
			"preset.cat.global": "海外/聚合",
			"preset.modelCount": "{count} 个模型",
			"preset.added": "已添加",
			"preset.registeredBadge": "已注册",
			"preset.removedButDeclared": "已提交删除，但 {route} 由基础配置（cordis.patch.yml）声明，可能仍然保留，请到官方「模型」页确认。",
			"preset.addRow": "添加",
			"preset.edit": "编辑",
			"preset.editTitle": "编辑 {name}",
			"preset.updated": "已更新 {route}",
			"preset.updatedKeyCleared": "已更新 {route}：Key 已清空，凭证引用已移除。",
			"preset.remove": "删除",
			"preset.confirmRemove": "确认删除",
			"preset.removed": "已删除 {route}",
			"preset.notDeletable": "未找到该厂商的配置位置（可能是基础层声明），未执行删除。",
			"preset.loadFailed": "读取厂商目录失败：{message}",
			"preset.formTitle": "添加 {name}",
			"preset.route": "路由 ID",
			"preset.routeHint": "小写字母开头，可含数字与连字符；同时决定凭证名 <ROUTE>_API_KEY。",
			"preset.routeInvalid": "路由 ID 需为小写字母开头的小写字母、数字或连字符组合。",
			"preset.routeTaken": "该路由 ID 已被占用，请换一个。",
			"preset.displayName": "显示名（可选）",
			"preset.baseURL": "Base URL",
			"preset.baseURLInvalid": "Base URL 需为合法的 http(s) 地址。",
			"preset.api": "接口协议",
			"preset.key": "API Key（留空则不写入凭证）",
			"preset.keyConfigured": "已从本地凭证回填该厂商的 Key；留空则保持原值不变。",
			"preset.models": "模型清单",
			"preset.modelId": "模型 ID",
			"preset.modelName": "模型名称",
			"preset.modelNamePlaceholder": "默认与 ID 一致",
			"preset.showKey": "显示 API Key",
			"preset.hideKey": "隐藏 API Key",
			"preset.modelContext": "上下文",
			"preset.pullHint": "清单为空：点「从 API 拉取」获取该厂商的真实模型列表，或手动添加一行。",
			"preset.pull": "从 API 拉取",
			"preset.pulling": "拉取中…",
			"preset.pulled": "已拉取 {count} 个模型",
			"preset.pullEmpty": "接口没有返回任何模型。",
			"preset.pullNeedsKey": "该路由还没有已存凭证：请先在上方填入 API Key 再拉取（已添加过的厂商可留空，会自动使用已存凭证）。",
			"preset.addModel": "手动添加一行",
			"preset.submit": "创建",
			"preset.adding": "创建中…",
			"preset.added.ok": "已添加 {route}，目录已刷新。",
			"preset.modelsRequired": "至少保留一个模型。",
			"preset.failed": "操作失败：{message}",
			"preset.customTitle": "自定义 API",
			"preset.customRow": "自定义 API",
			"preset.customDesc": "厂商不在预设里？手动填写 Base URL、协议与模型清单即可，流程与预设相同。",
			"reveal.title": "凭证回显",
			"reveal.off.hint": "关闭时，编辑厂商不会预填已存的 API Key（宿主凭证接口本身是只写的，官方设置页也从不回显）。需要核对本地已存的 Key 时再打开。",
			"reveal.on.hint": "已开启：Host 半身正在读取本地凭证（~/.dsh/.credentials.yaml 的 refs 段与 *_API_KEY 环境变量），编辑厂商时自动预填，并随凭证文件变化实时刷新。",
			"reveal.warn": "⚠ 开启期间明文 Key 会写入本插件的设置投影（落盘到 profile 的 cordis.patch.yml），关闭开关即清除。核对完请关闭；不要把开启状态的配置分发出去。",
			"reveal.enable": "开启凭证回显",
			"reveal.disable": "关闭凭证回显",
			"provider.account": "DeepSeek 账号"
		};
		/** 英文文案（键集合与 zh 一致）。 */
		const en = {
			"nav": "Model Picker",
			"hint": "The model picker is a two-level list: providers only by default, click a provider to expand its models underneath, then pick a reasoning effort after choosing a model. The search box filters by provider name, model name, or effort name. Providers and models turned off here do not appear in the picker.",
			"providersTitle": "Providers",
			"providerHidden": "Hidden",
			"providerVisible": "Shown",
			"hideProvider": "Hide this provider",
			"showProvider": "Show this provider",
			"hideModel": "Hide this model",
			"showModel": "Show this model",
			"hiddenModels": "{count} models hidden",
			"cleanupStale": "Clean up {count} stale rules",
			"cleanupStaleTitle": "These hidden-model rules point to models no longer in the catalog (usually leftovers after trimming a provider's config); click to remove them all.",
			"effortCount": "{count} efforts",
			"emptyProviders": "No providers are available yet. Configure at least one provider in the Models settings first.",
			"emptyModels": "This provider has no visible models.",
			"saveFailed": "Save failed: {message}",
			"saving": "Saving…",
			"saved": "Saved",
			"loadingProviders": "Reading provider directory…",
			"trigger.fallback": "Select model",
			"trigger.loading": "Loading models…",
			"trigger.aria": "Select model, current {model}",
			"trigger.ariaEffort": "Select model, current {model}, reasoning effort {effort}",
			"menu.aria": "Select provider and model",
			"menu.models": "Select model",
			"menu.effort": "Select reasoning effort",
			"menu.back": "Back to models",
			"menu.expandHint": "Click a provider to expand",
			"effort.providerDefault": "Default",
			"status.loading": "Refreshing model list…",
			"status.empty": "No models available",
			"empty.efforts": "This model provides no reasoning effort levels.",
			"error.action": "Model operation failed: {message}",
			"error.sessionInUse": "This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.",
			"action.reload": "Reload",
			"search.placeholder": "Search models…",
			"search.empty": "No matching models.",
			"preset.title": "Provider Presets",
			"preset.hint": "Add common providers in one click: pick a preset, paste an API key, and it is written through the host — the picker lists it immediately. Existing configurations are never overwritten; refresh model lists later via \"Fetch from API\".",
			"preset.add": "Add provider",
			"preset.close": "Collapse",
			"preset.back": "Back to presets",
			"preset.loading": "Loading…",
			"preset.search": "Search providers…",
			"preset.searchEmpty": "No matching presets.",
			"preset.cat.all": "All",
			"preset.cat.cn": "CN official",
			"preset.cat.global": "Global",
			"preset.modelCount": "{count} models",
			"preset.added": "Added",
			"preset.registeredBadge": "Registered",
			"preset.removedButDeclared": "Removal submitted, but {route} is declared in a base layer (cordis.patch.yml) and may persist; confirm on the official Models page.",
			"preset.addRow": "Add",
			"preset.edit": "Edit",
			"preset.editTitle": "Edit {name}",
			"preset.updated": "Updated {route}",
			"preset.updatedKeyCleared": "Updated {route}: the key was cleared and its credential reference removed.",
			"preset.remove": "Delete",
			"preset.confirmRemove": "Confirm delete",
			"preset.removed": "Removed {route}",
			"preset.notDeletable": "Could not locate this provider's configuration (it may be declared in a base layer); nothing was deleted.",
			"preset.loadFailed": "Failed to read the provider directory: {message}",
			"preset.formTitle": "Add {name}",
			"preset.route": "Route ID",
			"preset.routeHint": "Starts with a lowercase letter; lowercase letters, digits and hyphens only. Also derives the credential name <ROUTE>_API_KEY.",
			"preset.routeInvalid": "The route ID must start with a lowercase letter and use only lowercase letters, digits and hyphens.",
			"preset.routeTaken": "This route ID is already taken; pick another.",
			"preset.displayName": "Display name (optional)",
			"preset.baseURL": "Base URL",
			"preset.baseURLInvalid": "The base URL must be a valid http(s) address.",
			"preset.api": "Wire protocol",
			"preset.key": "API key (leave blank to skip storing)",
			"preset.keyConfigured": "The stored key for this provider was filled in from local credentials; leaving it unchanged keeps the current value.",
			"preset.models": "Models",
			"preset.modelId": "Model ID",
			"preset.modelName": "Model name",
			"preset.modelNamePlaceholder": "Defaults to the ID",
			"preset.showKey": "Show API key",
			"preset.hideKey": "Hide API key",
			"preset.modelContext": "Context",
			"preset.pullHint": "The list is empty: use \"Fetch from API\" to load this provider's real model list, or add a row manually.",
			"preset.pull": "Fetch from API",
			"preset.pulling": "Fetching…",
			"preset.pulled": "Fetched {count} models",
			"preset.pullEmpty": "The endpoint returned no models.",
			"preset.pullNeedsKey": "This route has no stored credential yet: enter an API key above before fetching (existing providers can leave it blank — the stored credential is used automatically).",
			"preset.addModel": "Add row manually",
			"preset.submit": "Create",
			"preset.adding": "Creating…",
			"preset.added.ok": "Added {route}; the directory has been refreshed.",
			"preset.modelsRequired": "Keep at least one model.",
			"preset.failed": "Operation failed: {message}",
			"preset.customTitle": "Custom API",
			"preset.customRow": "Custom API",
			"preset.customDesc": "Provider not in the presets? Fill in the base URL, protocol and model list manually — same flow as a preset.",
			"reveal.title": "Credential Reveal",
			"reveal.off.hint": "While off, editing a provider never pre-fills the stored API key (the host credential API is write-only and the official Models page never echoes it either). Turn on only when you need to check a locally stored key.",
			"reveal.on.hint": "On: the host half is reading local credentials (the refs section of ~/.dsh/.credentials.yaml plus *_API_KEY environment variables), pre-filling them when editing a provider, and refreshes live as the file changes.",
			"reveal.warn": "⚠ While on, plaintext keys are written into this plugin's settings projection (persisted to cordis.patch.yml) and cleared when you turn it off. Turn it off after checking; never distribute a config left in this state.",
			"reveal.enable": "Enable credential reveal",
			"reveal.disable": "Disable credential reveal",
			"provider.account": "DeepSeek Account"
		};
		//#endregion
		//#region stores
		/** 规则注入缺失时的兜底：一条恒等的空规则选择器。 */
		const EMPTY_RULES = new VisibilityRules();
		/** 目录注入缺失时的兜底：一份空的目录状态。 */
		const EMPTY_CATALOG = { status: "idle", groups: [], error: null };
		/** 兜底选择器：永远返回空规则，签名与真实的规则 Hook 一致。 */
		function useEmptyRules(selector) {
			const value = selector(EMPTY_RULES);
			return value;
		}
		/** 兜底选择器：永远返回空目录状态，签名与真实的目录 Hook 一致。 */
		function useEmptyCatalog(selector) {
			const value = selector(EMPTY_CATALOG);
			return value;
		}
		/**
		 * 隐藏规则的共享状态。
		 *
		 * 规则来自 Host 的设置文档；文档变化即刷新。选择器与设置页读的是
		 * 同一份快照，因此「设置里隐藏的」与「选择器里不显示的」永远一致。
		 */
		function createRulesStore(form) {
			const store = createSnapshotStore({
				rules: new VisibilityRules(),
				reveal: false,
				revealed: {},
				ready: false
			});
			const sync = () => {
				const value = form.getSnapshot().value;
				const next = new VisibilityRules(value?.hiddenProviders ?? [], value?.hiddenModels ?? []);
				const reveal = value?.revealKeysEnabled === true;
				const revealed = value?.revealedKeys !== null && typeof value?.revealedKeys === "object" ? value.revealedKeys : {};
				const current = store.getSnapshot();
				if (current.ready) {
					const a = current.rules.toArrays();
					const b = next.toArrays();
					const sameRules = a.hiddenProviders.join(" ") === b.hiddenProviders.join(" ") && a.hiddenModels.join(" ") === b.hiddenModels.join(" ");
					if (sameRules && current.reveal === reveal && JSON.stringify(current.revealed) === JSON.stringify(revealed)) return;
				}
				store.set({ rules: next, reveal, revealed, ready: true });
			};
			sync();
			form.subscribe(sync);
			return store;
		}
		/**
		 * 全局模型目录：设置页用它列出所有厂商与模型。
		 *
		 * 它直接读 Host 的目录接口，因此与选择器看到的是同一份事实。
		 */
		function createCatalogStore(ctx) {
			const store = createSnapshotStore({
				status: "idle",
				groups: [],
				error: null
			});
			const load = () => {
				store.update((draft) => {
					draft.status = "loading";
					draft.error = null;
				});
				return ctx.remote.session.modelCatalog().then((response) => {
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					return response.value;
				}).then((value) => {
					store.set({ status: "ready", groups: value.groups ?? [], error: null });
				}).catch((error) => {
					store.set({ status: "error", groups: store.getSnapshot().groups, error: error instanceof Error ? error.message : String(error) });
				});
			};
			return { store, load };
		}
		//#endregion
		//#region picker
		/**
		 * 某个模型当前生效的强度档位 id。
		 *
		 * 强度绑定到「厂商 + 模型」：显式选择只对当前选中的那一个模型有效，
		 * 因此只有在「这个模型正是当前选中的模型」时才用显式值，否则一律
		 * 取该模型自己的默认档。同名模型在不同厂商下互不串台。
		 * @param {object} state 会话目录快照。
		 * @param {object} model 目录里的模型条目。
		 * @param {string} providerId 该条目所属的厂商 id。
		 * @returns {string | undefined} 档位 id，模型不提供强度时为 undefined。
		 */
		function effectiveEffortOf(state, model, providerId) {
			if (!model) return undefined;
			const isCurrent = state.current?.model === model.id &&
				(providerId === undefined || state.current?.provider === providerId);
			if (isCurrent && state.current?.reasoningEffort !== undefined) return state.current.reasoningEffort;
			return model.reasoning?.defaultEffort;
		}
		/** 强度档位的展示名。 */
		function effortLabelOf(state, model, providerId) {
			if (!model?.reasoning) return undefined;
			const id = effectiveEffortOf(state, model, providerId);
			if (id === undefined) return undefined;
			return model.reasoning.efforts.find((level) => level.id === id)?.name ?? id;
		}
		/**
		 * 模型选择器：一个两级列表 + 一个强度选择屏。
		 *
		 * 第一屏是两级列表——默认只显示厂商，点厂商整行就在下方展开它的模型
		 * （不是右侧箭头展开）。点模型时：该模型提供推理等级就切到第二屏选
		 * 等级，不提供就直接选中。第二屏带返回按钮，标题旁显示正在选等级的
		 * 模型名。搜索框匹配厂商名、模型名或强度名，命中时厂商自动展开。
		 *
		 * 目录与提交复用官方 model-selection 插件持有的会话目录，因此这里
		 * 看到的分组与官方 `/model` 命令是同一份事实，唯一区别是多了一层
		 * 可见性过滤。
		 */
		function ModelPicker(props) {
			const { locked, available, directory, load, select, t } = props;
			const state = useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			// 规则来自共享的可见性状态；注入缺失时按「不隐藏任何东西」处理。
			// Hook 必须无条件调用，因此这里始终走同一个 selector 形状。
			const useRules = props.useRules ?? useEmptyRules;
			const rules = useRules((snapshot) => snapshot.rules);
			const [open, setOpen] = useState(false);
			const [pane, setPane] = useState("providers");
			const [pending, setPending] = useState(null);
			const [query, setQuery] = useState("");
			const [expanded, setExpanded] = useState(() => new Set());
			const [toast, setToast] = useState(null);
			const toastSeq = useRef(0);
			const rootRef = useRef(null);
			const triggerRef = useRef(null);
			const menuRef = useRef(null);
			const searchRef = useRef(null);
			const [menuPos, setMenuPos] = useState(null);
			const accountProviderName = t("provider.account");
			// 可见的分组：先按隐藏规则过滤，再按搜索词过滤。
			const visibleGroups = useMemo(() => {
				const visible = rules.filterGroups(state.groups);
				const needle = query.trim().toLowerCase();
				return visible.map((group) => {
					const label = providerName(group, accountProviderName);
					const providerHit = needle !== "" && (label.toLowerCase().includes(needle) || group.id.toLowerCase().includes(needle));
					const models = needle === "" ? group.models : group.models.filter((model) => providerHit || String(model.id).toLowerCase().includes(needle) || String(model.name ?? "").toLowerCase().includes(needle) || (model.reasoning?.efforts ?? []).some((level) => String(level.id).toLowerCase().includes(needle) || String(level.name).toLowerCase().includes(needle)));
					return {
						id: group.id,
						label,
						models: needle === "" ? models : models
					};
				}).filter((group) => needle === "" || group.models.length > 0);
			}, [state.groups, rules, query, accountProviderName]);
			const currentGroup = useMemo(() => visibleGroups.find((group) => group.id === state.current?.provider) ?? null, [visibleGroups, state.current]);
			const currentModel = useMemo(() => {
				if (currentGroup === null || state.current === null) return null;
				return currentGroup.models.find((model) => model.id === state.current.model) ?? null;
			}, [currentGroup, state.current]);
			// 强度是模型独有的，因此只有当前选中的模型才有强度文案。
			const currentEffort = currentModel === null ? undefined : effortLabelOf(state, currentModel, currentGroup?.id);
			const currentLabel = currentModel?.name ?? (state.current === null ? t("trigger.fallback") : state.current.model);
			// 触发器里的厂商名：取自未过滤的完整目录（不是 visibleGroups），
			// 这样即便当前厂商被可见性规则藏起来，也已照实显示它的名字，
			// 不会出现一个「没有来源」的模型名。目录还没读完时先不显示，
			// 免得一闪而过的内部 id（如 deepseek-account）。
			const currentProviderLabel = useMemo(() => {
				const providerId = state.current?.provider;
				if (providerId === undefined || providerId === null) return undefined;
				const group = state.groups.find((candidate) => candidate.id === providerId);
				if (group !== undefined) return providerName(group, accountProviderName);
				return state.status === "ready" ? String(providerId) : undefined;
			}, [state.groups, state.current, accountProviderName, state.status]);
			const { pending: inflight } = state;
			const busy = inflight !== null;
			const searching = query.trim() !== "";
			const close = useCallback((restoreFocus = false) => {
				setOpen(false);
				setPane("providers");
				setPending(null);
				setQuery("");
				if (restoreFocus) queueMicrotask(() => {
					triggerRef.current?.focus();
				});
			}, []);
			const show = useCallback(() => {
				triggerRef.current?.focus();
				setPane("providers");
				setPending(null);
				setQuery("");
				setOpen(true);
				load();
			}, [load]);
			useEffect(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (rootRef.current?.contains(event.target) === true) return;
					if (menuRef.current?.contains(event.target) === true) return;
					close();
				};
				document.addEventListener("mousedown", closeOutside);
				return () => {
					document.removeEventListener("mousedown", closeOutside);
				};
			}, [open, close]);
			useLayoutEffect(() => {
				if (!open) {
					setMenuPos(null);
					return;
				}
				const MARGIN = 12;
				const GAP = 8;
				let raf = 0;
				let tries = 0;
				let disposed = false;
				const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
				const place = () => {
					if (disposed) return;
					const trigger = triggerRef.current;
					const menu = menuRef.current;
					if (trigger === null || menu === null) return;
					const rect = trigger.getBoundingClientRect();
					if (rect.width === 0 && rect.height === 0) return;
					const lw = menu.offsetWidth;
					const lh = menu.offsetHeight;
					// 菜单还没完成布局时等下一帧再量，最多重试十次。
					if (lw === 0 || lh === 0) {
						if (tries++ < 10) raf = requestAnimationFrame(place);
						return;
					}
					// 期望的视口坐标：优先贴着触发器下方展开，下方放不下再翻到上方。
					const x = clamp(rect.right - lw, MARGIN, window.innerWidth - lw - MARGIN);
					const below = rect.bottom + GAP;
					const y = window.innerHeight - below >= lh + MARGIN
						? below
						: clamp(rect.top - GAP - lh, MARGIN, window.innerHeight - lh - MARGIN);
					// 自校正：composer 的祖先带 container/transform/backdrop-filter 时，
					// position:fixed 的包含块不再是视口，同一组坐标会被解释到别的位置
					// （弹窗被甩到窗口右下角的根因）。先把菜单摆到期望坐标，量出实际
					// 落点，把差值补回 style——无论包含块是谁，两三步内都能精确贴到。
					let left = x;
					let top = y;
					for (let i = 0; i < 3; i++) {
						menu.style.left = `${left}px`;
						menu.style.top = `${top}px`;
						const actual = menu.getBoundingClientRect();
						const dx = left - actual.left;
						const dy = top - actual.top;
						if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
						left += dx;
						top += dy;
					}
					setMenuPos({ left, top });
				};
				place();
				// 展开厂商、目录异步到达都会改菜单高度，尺寸变了也要重新贴。
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
				if (observer !== null && menuRef.current !== null) observer.observe(menuRef.current);
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
					disposed = true;
					if (raf !== 0) cancelAnimationFrame(raf);
					if (observer !== null) observer.disconnect();
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
				};
			}, [open, pane, visibleGroups]);
			const settle = useCallback((result) => {
				if (result === void 0) return;
				if (result.ok) {
					close(true);
					return;
				}
				const { error } = result;
				toastSeq.current += 1;
				setToast({
					seq: toastSeq.current,
					text: error.code === "session/writer-held" ? t("error.sessionInUse") : t("error.action", { message: `${error.code}: ${error.message}` })
				});
			}, [t, close]);
			const choose = useCallback((selection) => {
				select(selection).then(settle);
			}, [select, settle]);
			const toggleProvider = useCallback((providerId) => {
				setExpanded((previous) => {
					const next = new Set(previous);
					if (next.has(providerId)) next.delete(providerId);
					else next.add(providerId);
					return next;
				});
			}, []);
			// 点模型：有等级进第二屏，无等级直接选中。
			const pickModel = useCallback((providerId, modelId) => {
				const group = visibleGroups.find((candidate) => candidate.id === providerId);
				const model = group?.models.find((candidate) => candidate.id === modelId);
				if (model?.reasoning !== undefined && model.reasoning.efforts.length > 0) {
					setPending({ provider: providerId, model: modelId });
					setPane("effort");
					return;
				}
				choose({ provider: providerId, model: modelId });
			}, [visibleGroups, choose]);
			if (!available) return null;
			// 触发器：厂商、模型名与推理等级用不同样式，厂商最淡、等级更小更淡。
			const triggerModelText = currentProviderLabel === undefined ? currentLabel : `${currentProviderLabel} · ${currentLabel}`;
			const triggerAria = state.current === null ? t("trigger.fallback") : currentEffort === undefined ? t("trigger.aria", { model: triggerModelText }) : t("trigger.ariaEffort", { model: triggerModelText, effort: currentEffort });
			const renderHead = () => {
				if (pane === "effort" && pending !== null) {
					const group = visibleGroups.find((candidate) => candidate.id === pending.provider);
					const model = group?.models.find((candidate) => candidate.id === pending.model);
					return h("div", { className: "mpp_head" }, h("button", {
						type: "button",
						className: "mpp_backButton",
						"aria-label": t("menu.back"),
						disabled: busy,
						onClick: () => {
							setPane("providers");
							setPending(null);
						},
						children: h(primitives.IconChevronLeftOutlineRegular, { size: 14 })
					}), h("span", { className: "mpp_headTitle" }, t("menu.effort")), h("span", { className: "mpp_headSub" }, `${group === undefined ? pending.provider : providerName(group, accountProviderName)} · ${model?.name ?? pending.model}`));
				}
				return h("div", { className: "mpp_head" }, h("span", { className: "mpp_headTitle" }, t("menu.models")), h("span", { className: "mpp_headSub" }, t("menu.expandHint")));
			};
			const renderEffortPane = () => {
				const group = visibleGroups.find((candidate) => candidate.id === pending?.provider);
				const model = group?.models.find((candidate) => candidate.id === pending?.model);
				if (model?.reasoning === undefined || model.reasoning.efforts.length === 0) return h("div", { className: "mpp_empty", role: "status" }, t("empty.efforts"));
				const active = effectiveEffortOf(state, model, group.id);
				return h(Fragment, null, model.reasoning.efforts.map((level) => {
					const isActive = level.id === active;
					return h("button", {
						key: level.id,
						type: "button",
						className: isActive ? "mpp_row mpp_rowEffort mpp_rowEffortActive" : "mpp_row mpp_rowEffort",
						role: "menuitemradio",
						"aria-checked": isActive,
						disabled: busy,
						title: level.name,
						onClick: () => {
							choose({ provider: group.id, model: model.id, reasoningEffort: level.id });
						},
						children: [h("span", { className: "mpp_effortDot" }), h("span", { className: "mpp_rowLabel" }, level.name)]
					});
				}));
			};
			const renderProviderPane = () => {
				if (state.status === "loading" && visibleGroups.length === 0) return h("div", { className: "mpp_status" }, t("status.loading"));
				if (visibleGroups.length === 0) return h("div", { className: "mpp_empty", role: "status" }, searching ? t("search.empty") : t("status.empty"));
				return h(Fragment, null, visibleGroups.map((group) => {
					// 搜索时厂商强制展开，否则看点击状态。
					const isOpen = searching || expanded.has(group.id);
					const hasCurrent = state.current?.provider === group.id;
					return h(Fragment, { key: group.id }, h("button", {
						type: "button",
						className: hasCurrent ? "mpp_row mpp_rowProvider mpp_rowCurrent" : "mpp_row mpp_rowProvider",
						role: "treeitem",
						"aria-expanded": isOpen ? "true" : "false",
						"aria-level": "1",
						disabled: busy,
						title: group.id,
						onClick: () => {
							toggleProvider(group.id);
						},
						children: [h("span", { className: "mpp_rowLabel" }, group.label), h("span", { className: "mpp_count" }, String(group.models.length))]
					}), isOpen ? h("div", { className: "mpp_children", role: "group" }, group.models.map((model) => {
						const selected = hasCurrent && state.current.model === model.id;
						const isPending = inflight?.provider === group.id && inflight.model === model.id;
						const effort = selected ? effortLabelOf(state, model, group.id) : undefined;
						return h("button", {
							key: model.id,
							type: "button",
							className: selected ? "mpp_row mpp_rowModel mpp_rowSelected" : "mpp_row mpp_rowModel",
							role: "menuitemradio",
							"aria-checked": selected,
							"aria-level": "2",
							disabled: busy,
							title: model.name,
							onClick: () => {
								pickModel(group.id, model.id);
							},
							children: [h("span", { className: "mpp_rowLabel" }, model.name), effort === undefined ? null : h("span", { className: "mpp_effortTag" }, effort), h("span", { className: "mpp_check" }, isPending ? h(primitives.StateDot, { state: "ongoing" }) : selected ? h(primitives.IconCheckOutlineRegular, {}) : null)]
						});
					})) : null);
				}));
			};
			return h("div", {
				ref: rootRef,
				className: "mpp_root",
				children: [h("button", {
					ref: triggerRef,
					type: "button",
					className: "mpp_trigger",
					"aria-label": triggerAria,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-controls": open ? "mpp-menu" : void 0,
					title: currentEffort === undefined ? triggerModelText : `${triggerModelText} ${currentEffort}`,
					"aria-busy": busy,
					disabled: locked,
					onClick: () => {
						if (open) close(true);
						else show();
					},
					children: [h(primitives.IconDataOutlineRegular, { size: 16 }), currentProviderLabel === undefined ? null : h("span", { className: "mpp_triggerProvider" }, currentProviderLabel), currentProviderLabel === undefined ? null : h("span", { className: "mpp_triggerSep" }, "·"), h("span", { className: "mpp_triggerLabel" }, currentLabel), currentEffort === undefined ? null : h("span", { className: "mpp_triggerEffort" }, currentEffort), busy ? h(primitives.StateDot, { state: "ongoing" }) : h(primitives.IconChevronDownOutlineRegular, { className: open ? "mpp_chevron mpp_chevronOpen" : "mpp_chevron" })]
				}), open && h(primitives.MenuSurface, {
					ref: menuRef,
					id: "mpp-menu",
					className: "mpp_menu",
					style: menuPos ?? { visibility: "hidden", left: 0, top: 0 },
					role: "menu",
					"aria-label": t("menu.aria"),
					children: [renderHead(), h("div", { className: "mpp_searchRow" }, h(primitives.Input, {
						ref: searchRef,
						className: "mpp_search",
						type: "text",
						role: "searchbox",
						"aria-label": t("search.placeholder"),
						placeholder: t("search.placeholder"),
						value: query,
						readOnly: busy,
						autoFocus: true,
						onChange: (event) => {
							setQuery(event.target.value);
						}
					})), h("div", { className: "mpp_tree scrollable", role: "tree", "aria-label": t("menu.aria") }, pane === "effort" ? renderEffortPane() : renderProviderPane())]
				}), toast !== null && h(primitives.Toast, {
					text: toast.text,
					icon: h(primitives.IconWarningOutlineRegular, {}),
					anchor: rootRef.current?.closest("[data-composer-card]") ?? null,
					onDone: () => {
						setToast(null);
					}
				}, toast.seq)]
			});
		}
		//#endregion
		//#region presets
		/** 预设 route 的命名规则：小写字母开头，仅小写字母、数字与连字符（与官方一致）。 */
		const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
		/** 预设支持的接口协议。 */
		const PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];
		/** 由 route 推导凭证引用名（与官方模型设置页的 deriveKeyRef 一致）。 */
		function deriveKeyRef(route) {
			return `${String(route).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
		}
		function isHttpUrl(value) {
			try {
				const protocol = new URL(value).protocol;
				return protocol === "http:" || protocol === "https:";
			} catch {
				return false;
			}
		}
		/**
		 * 常见厂商预设库。
		 *
		 * contextWindow 只在可靠时填写（来自实测或官方配置），拿不准的留给
		 * 「从 API 拉取」补全；模型清单本身随时可在表单里增删改。
		 */
		const PRESETS = [
			{
				route: "sensenova", name: "Sensenova 商汤", category: "cn",
				baseURL: "https://token.sensenova.cn/v1", api: "openai-completions", website: "https://platform.sensenova.cn",
				models: [
					{ id: "sensenova-6.8-flash-lite", contextWindow: 262144 },
					{ id: "sensenova-6.8-flash", contextWindow: 262144 },
					{ id: "glm-5.2", contextWindow: 1048576 },
					{ id: "glm-5.3", contextWindow: 1048576 },
					{ id: "deepseek-v4-flash", contextWindow: 1048576 },
					{ id: "deepseek-flash", contextWindow: 1048576 },
					{ id: "kimi-k3", contextWindow: 1048576 }
				]
			},
			{
				route: "loomy", name: "讯飞星火 MaaS", category: "cn",
				baseURL: "https://maas-api.cn-huabei-1.xf-yun.com/v1", api: "openai-completions", website: "https://training.xfyun.cn",
				models: [
					{ id: "spark-x2.6" },
					{ id: "spark-x2.5" },
					{ id: "spark-x2.6-4b" },
					{ id: "xsparkx2flash" }
				]
			},
			{
				route: "stepfun", name: "阶跃星辰 StepFun", category: "cn",
				baseURL: "https://api.stepfun.com/v1", api: "openai-completions", website: "https://platform.stepfun.com",
				models: [
					{ id: "step-5-preview", contextWindow: 1024000 },
					{ id: "step-3.7-flash", contextWindow: 262144 },
					{ id: "step-3.5-flash", contextWindow: 262144 }
				]
			},
			{
				route: "minimax-cn", name: "MiniMax", category: "cn",
				baseURL: "https://api.minimaxi.com/v1", api: "openai-completions", website: "https://platform.minimaxi.com",
				models: [
					{ id: "MiniMax-M2.7", contextWindow: 204800 },
					{ id: "MiniMax-M2.7-highspeed", contextWindow: 204800 },
					{ id: "MiniMax-M3", contextWindow: 1000000 },
					{ id: "MiniMax-M3.1-Flash" }
				]
			},
			{
				route: "moonshot", name: "月之暗面 Kimi", category: "cn",
				baseURL: "https://api.moonshot.cn/v1", api: "openai-completions", website: "https://platform.moonshot.cn",
				models: [
					{ id: "kimi-k3" },
					{ id: "kimi-k2.6" },
					{ id: "kimi-latest" }
				]
			},
			{
				route: "zhipu", name: "智谱 GLM", category: "cn",
				baseURL: "https://open.bigmodel.cn/api/paas/v4", api: "openai-completions", website: "https://open.bigmodel.cn",
				models: [
					{ id: "glm-5.2" },
					{ id: "glm-5.3" },
					{ id: "glm-4.7-flash" }
				]
			},
			{
				route: "deepseek", name: "DeepSeek 官方", category: "cn",
				baseURL: "https://api.deepseek.com/v1", api: "openai-completions", website: "https://platform.deepseek.com",
				models: [
					{ id: "deepseek-chat" },
					{ id: "deepseek-reasoner" }
				]
			},
			{
				route: "bailian", name: "阿里云百炼 Qwen", category: "cn",
				baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", api: "openai-completions", website: "https://bailian.console.aliyun.com",
				models: [
					{ id: "qwen-max" },
					{ id: "qwen-plus" }
				]
			},
			{
				route: "volcengine", name: "火山方舟 豆包", category: "cn",
				baseURL: "https://ark.cn-beijing.volces.com/api/v3", api: "openai-completions", website: "https://console.volcengine.com/ark",
				models: []
			},
			{
				route: "siliconflow", name: "硅基流动 SiliconFlow", category: "cn",
				baseURL: "https://api.siliconflow.cn/v1", api: "openai-completions", website: "https://siliconflow.cn",
				models: []
			},
			{
				route: "openai", name: "OpenAI", category: "global",
				baseURL: "https://api.openai.com/v1", api: "openai-completions", website: "https://platform.openai.com",
				models: [
					{ id: "gpt-5.5" },
					{ id: "gpt-5.5-mini" }
				]
			},
			{
				route: "anthropic", name: "Anthropic", category: "global",
				baseURL: "https://api.anthropic.com", api: "anthropic-messages", website: "https://console.anthropic.com",
				models: [
					{ id: "claude-sonnet-4-5" },
					{ id: "claude-haiku-4-5" }
				]
			},
			{
				route: "gemini", name: "Google Gemini", category: "global",
				baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", api: "openai-completions", website: "https://aistudio.google.com",
				models: [
					{ id: "gemini-3-pro" },
					{ id: "gemini-2.5-pro" }
				]
			},
			{
				route: "openrouter", name: "OpenRouter", category: "global",
				baseURL: "https://openrouter.ai/api/v1", api: "openai-completions", website: "https://openrouter.ai",
				models: [
					{ id: "openrouter/auto" }
				]
			},
			{
				route: "groq", name: "Groq", category: "global",
				baseURL: "https://api.groq.com/openai/v1", api: "openai-completions", website: "https://console.groq.com",
				models: [
					{ id: "llama-3.3-70b-versatile" }
				]
			}
		];
		/**
		 * 预设库要用的 Host 操作，全部走官方模型设置页同一条 Remote 通道：
		 * 厂商目录、凭证读写、设置写入（llm-pi-ai 的 providers 段）与模型发现。
		 */
		function createProviderOperations(ctx) {
			return {
				listRegistered: async () => {
					const response = await ctx.remote.llm.listProviders();
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					return response.value ?? [];
				},
				listDirectory: async () => {
					const response = await ctx.remote.llm.listConfigurableProviders();
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					return response.value ?? [];
				},
				credentialState: async (refs) => {
					const response = await ctx.remote.credentials.describe(refs);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					return response.value ?? {};
				},
				storeCredential: async (ref, value) => {
					const response = await ctx.remote.credentials.set(ref, value);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
				},
				removeCredential: async (ref) => {
					const response = await ctx.remote.credentials.unset(ref);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
				},
				writeProvider: async (route, profile) => {
					const response = await ctx.remote.settings.mutate("llm-pi-ai", [{ op: "set", path: ["providers", route], value: profile }], void 0);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
				},
				unsetProvider: async (ns, path) => {
					const response = await ctx.remote.settings.mutate(ns, [{ op: "unset", path }], void 0);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
				},
				discoverModels: async (request) => {
					const response = await ctx.remote.llm.discoverModels("llm-pi-ai", request);
					if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
					return response.value ?? [];
				},
				/** 读某个 route 当前的 profile（合并视图），编辑时用于保留表单管不到的字段。 */
				readProfile: (route) => {
					try {
						const snapshot = ctx.configForms.get("llm-pi-ai").getSnapshot();
						const profile = snapshot?.value?.providers?.[route];
						return profile !== null && typeof profile === "object" ? profile : null;
					} catch {
						return null;
					}
				},
				/** 读 Host 半身回显的本地凭证明文（volatile，未落盘）。 */
				revealedKeys: () => {
					try {
						const snapshot = ctx.configForms.get(NAMESPACE).getSnapshot();
						const value = snapshot?.value?.revealedKeys;
						return value !== null && typeof value === "object" ? value : {};
					} catch {
						return {};
					}
				}
			};
		}
		/** 预设库面板：列表（搜索/分类/已添加标记/删除）与添加表单（含拉取模型）。 */
		/** API Key 的显隐图标：眼睛 / 带斜杠的眼睛（宿主图标库没有现成的，内联 SVG）。 */
		const EyeIcon = () => h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" }), h("circle", { cx: "12", cy: "12", r: "3" }));
		const EyeOffIcon = () => h("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: "M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" }), h("path", { d: "M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 8 10 8a9.74 9.74 0 0 0 5.39-1.61" }), h("path", { d: "M2 2l20 20" }), h("path", { d: "M14.12 14.12a3 3 0 1 1-4.24-4.24" }));
		function PresetManager({ t, ops, loadCatalog, revealEnabled }) {
			const [panel, setPanel] = useState("closed");
			const [showKey, setShowKey] = useState(false);
			const [dir, setDir] = useState(() => ({ status: "idle", providers: new Map(), known: new Set() }));
			const [draft, setDraft] = useState(null);
			const [busy, setBusy] = useState(false);
			const [pulling, setPulling] = useState(false);
			const [failure, setFailure] = useState(null);
			const [notice, setNotice] = useState(null);
			const [confirmRoute, setConfirmRoute] = useState(null);
			const [query, setQuery] = useState("");
			const [category, setCategory] = useState("all");
			const [keyConfigured, setKeyConfigured] = useState(null);
			/** 读当前已声明/已注册的厂商：标记「已添加」，并给删除提供配置定位。返回 providers 映射供删除后复核。 */
			const loadDir = useCallback(async () => {
				setDir((previous) => ({ ...previous, status: "loading" }));
				try {
					const [registered, entries] = await Promise.all([ops.listRegistered(), ops.listDirectory()]);
					const providers = new Map();
					for (const entry of entries) {
						if (entry.settingsNs === "llm-pi-ai" && Array.isArray(entry.settingsPath) && entry.settingsPath.length === 2 && entry.settingsPath[0] === "providers") {
							providers.set(entry.settingsPath[1], entry);
						}
					}
					const known = new Set((registered ?? []).map((entry) => entry.id));
					setDir({ status: "ready", providers, known });
					return providers;
				} catch (error) {
					setDir({ status: "error", providers: new Map(), known: new Set() });
					setFailure(t("preset.loadFailed", { message: String(error.message ?? error) }));
					return new Map();
				}
			}, [ops, t]);
			const openList = useCallback(() => {
				setPanel("list");
				setFailure(null);
				setNotice(null);
				setConfirmRoute(null);
				loadDir();
			}, [loadDir]);
			/**
			 * 打开添加表单。preset 为 null 表示「自定义 API」：全空白起填，
			 * 其余校验/拉取/写入流程与预设完全一致。
			 */
			const openForm = useCallback((preset) => {
				setFailure(null);
				setNotice(null);
				setConfirmRoute(null);
				setShowKey(false);
				setDraft(preset === null ? {
					preset: null,
					editing: false,
					route: "",
					displayName: "",
					baseURL: "",
					api: "openai-completions",
					key: "",
					models: []
				} : {
					preset,
					editing: false,
					route: preset.route,
					displayName: preset.name,
					baseURL: preset.baseURL,
					api: preset.api,
					key: "",
					models: preset.models.map((model) => ({ id: model.id, name: model.name ?? model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) }))
				});
				if (preset === null) {
					setKeyConfigured(null);
				} else {
					const ref = deriveKeyRef(preset.route);
					ops.credentialState([ref]).then((states) => {
						setKeyConfigured(states[ref]?.configured === true ? ref : null);
					}).catch(() => {
						setKeyConfigured(null);
					});
				}
				setPanel("form");
			}, [ops]);
			/**
			 * 编辑已添加的厂商：从既有 profile 预填（读不到时退回预设值），
			 * 路由锁定——改名等于删除重建，不在编辑里做。
			 */
			const openEdit = useCallback((preset) => {
				setFailure(null);
				setNotice(null);
				setConfirmRoute(null);
				setShowKey(false);
				const profile = ops.readProfile(preset.route);
				const source = profile !== null && typeof profile === "object" ? profile : preset;
				const ref = typeof profile?.apiKeyEnv === "string" && profile.apiKeyEnv !== "" ? profile.apiKeyEnv : deriveKeyRef(preset.route);
				// 只有用户在设置页开启了「回显本地凭证」才预填明文；默认关闭时保持空白。
				const revealed = revealEnabled === true ? ops.revealedKeys() : {};
				setDraft({
					preset,
					editing: true,
					route: preset.route,
					displayName: typeof source.displayName === "string" && source.displayName !== "" ? source.displayName : preset.name,
					baseURL: typeof source.baseURL === "string" && source.baseURL !== "" ? source.baseURL : preset.baseURL,
					api: typeof source.api === "string" && source.api !== "" ? source.api : preset.api,
					key: typeof revealed[ref] === "string" ? revealed[ref] : "",
					models: (Array.isArray(source.models) ? source.models : preset.models).map((model) => ({ id: String(model?.id ?? ""), name: String(model?.name ?? model?.id ?? ""), ...(model?.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) }))
				});
				ops.credentialState([ref]).then((states) => {
					setKeyConfigured(states[ref]?.configured === true ? ref : null);
				}).catch(() => {
					setKeyConfigured(null);
				});
				setPanel("form");
			}, [ops, revealEnabled]);
			/** 路由改动后（失焦时）复查该 route 推导出的凭证是否已存在。 */
			const recheckKeyConfigured = useCallback(() => {
				const route = draft?.route?.trim() ?? "";
				if (!ROUTE_PATTERN.test(route)) {
					setKeyConfigured(null);
					return;
				}
				const ref = deriveKeyRef(route);
				ops.credentialState([ref]).then((states) => {
					setKeyConfigured(states[ref]?.configured === true ? ref : null);
				}).catch(() => {
					setKeyConfigured(null);
				});
			}, [draft, ops]);
			const routeTaken = draft !== null && !draft.editing && (dir.providers.has(draft.route.trim()) || dir.known.has(draft.route.trim()));
			const routeInvalid = draft !== null && draft.route.length > 0 && !ROUTE_PATTERN.test(draft.route.trim());
			const baseURLInvalid = draft !== null && draft.baseURL.length > 0 && !isHttpUrl(draft.baseURL.trim());
			const updateModel = useCallback((index, patch) => {
				setDraft((current) => ({
					...current,
					models: current.models.map((model, at) => at === index ? { ...model, ...patch } : model)
				}));
			}, []);
			const addModel = useCallback(() => {
				setDraft((current) => ({ ...current, models: [...current.models, { id: "", name: "" }] }));
			}, []);
			const removeModel = useCallback((index) => {
				setDraft((current) => ({ ...current, models: current.models.filter((_, at) => at !== index) }));
			}, []);
			/** 用表单里的 Key 一次性向该端点询问真实模型清单（凭证不会被存储）。 */
			const pull = useCallback(async () => {
				if (draft === null) return;
				if (!isHttpUrl(draft.baseURL.trim())) {
					setFailure(t("preset.baseURLInvalid"));
					return;
				}
				setPulling(true);
				setFailure(null);
				try {
					const route = draft.route.trim();
					const routeExists = dir.providers.has(route) || dir.known.has(route);
					const discovered = await ops.discoverModels({
						// 路由已存在时把 provider 交给宿主：请求没带 apiKey 时，
						// 适配器会自动解析该路由已存的凭证来发请求（编辑场景无需手填 Key）。
						...(routeExists ? { provider: route } : {}),
						baseURL: draft.baseURL.trim(),
						api: draft.api,
						...(draft.key.trim() === "" ? {} : { apiKey: draft.key.trim() })
					});
					setDraft((current) => ({
						...current,
						models: discovered.map((model) => ({
							id: String(model.id),
							name: String(model.name ?? model.id),
							...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow })
						}))
					}));
					setNotice(discovered.length === 0 ? t("preset.pullEmpty") : t("preset.pulled", { count: String(discovered.length) }));
				} catch (error) {
					const text = String(error.message ?? error);
					// 新路由没带 Key 拉取必然 401/403，给一句可操作的提示。
					if (/401|403/.test(text) && draft.key.trim() === "" && !dir.providers.has(draft.route.trim()) && !dir.known.has(draft.route.trim())) {
						setFailure(t("preset.pullNeedsKey"));
					} else {
						setFailure(t("preset.failed", { message: text }));
					}
				} finally {
					setPulling(false);
				}
			}, [draft, dir, ops, t]);
			/** 创建：写 provider 配置（llm-pi-ai），填了 Key 再落一条凭证。 */
			const submit = useCallback(async () => {
				if (draft === null) return;
				const route = draft.route.trim();
				if (!ROUTE_PATTERN.test(route)) {
					setFailure(t("preset.routeInvalid"));
					return;
				}
				if (!draft.editing && (dir.providers.has(route) || dir.known.has(route))) {
					setFailure(t("preset.routeTaken"));
					return;
				}
				if (!isHttpUrl(draft.baseURL.trim())) {
					setFailure(t("preset.baseURLInvalid"));
					return;
				}
				// 去掉尾部斜杠，避免和端点路径拼接出 `//chat/completions`。
				const baseURL = draft.baseURL.trim().replace(/\/+$/, "");
				// 模型 id 去空白、去空行、去重复——重复 id 会原样写进配置。
				const seen = new Set();
				const models = [];
				for (const model of draft.models) {
					const id = model.id.trim();
					if (id === "" || seen.has(id)) continue;
					seen.add(id);
					models.push({ ...model, id });
				}
				if (models.length === 0) {
					setFailure(t("preset.modelsRequired"));
					return;
				}
				setBusy(true);
				setFailure(null);
				try {
					const keyRef = deriveKeyRef(route);
					if (draft.editing) {
						// 编辑：以既有 profile 为底合并——表单管不到的字段（如模型的
						// input/maxTokens、自定义 name）原样保留；删掉的模型行才会消失。
						const existing = ops.readProfile(route);
						const base = existing !== null && typeof existing === "object" ? existing : {};
						const priorModels = Array.isArray(base.models) ? base.models : [];
						const priorRef = typeof base.apiKeyEnv === "string" && base.apiKeyEnv !== "" ? base.apiKeyEnv : keyRef;
						const keyValue = draft.key.trim();
						// 原本有 Key、现在被清空 = 明确要求移除该凭证引用。
						const clearsKey = keyValue === "" && typeof base.apiKeyEnv === "string" && base.apiKeyEnv !== "";
						const nextProfile = {
							...base,
							...(draft.displayName.trim() === "" ? {} : { displayName: draft.displayName.trim() }),
							api: draft.api,
							baseURL,
							models: models.map((model) => {
								// 编辑合并：表单的名称优先（用户改了就用），否则保留原名，最后退回 ID。
								const formName = (model.name ?? "").trim();
								const prior = priorModels.find((candidate) => candidate !== null && typeof candidate === "object" && candidate.id === model.id);
								if (prior === undefined) return { id: model.id, name: formName || model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) };
								return { ...prior, name: formName || prior.name || model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) };
							})
						};
						if (clearsKey) delete nextProfile.apiKeyEnv;
						else if (keyValue !== "") nextProfile.apiKeyEnv = keyRef;
						await ops.writeProvider(route, nextProfile);
						if (clearsKey) {
							// 只在凭证确实归本页管理（引用名即推导名）时删除，避免误删共享 Key。
							if (priorRef === keyRef) {
								try { await ops.removeCredential(priorRef); } catch { /* 凭证不存在时忽略 */ }
							}
							setNotice(t("preset.updatedKeyCleared", { route }));
						} else if (keyValue !== "") {
							await ops.storeCredential(keyRef, keyValue);
							setNotice(t("preset.updated", { route }));
						} else {
							setNotice(t("preset.updated", { route }));
						}
					} else {
						await ops.writeProvider(route, {
							...(draft.displayName.trim() === "" ? {} : { displayName: draft.displayName.trim() }),
							...(draft.key.trim() === "" ? {} : { apiKeyEnv: keyRef }),
							api: draft.api,
							baseURL,
							models: models.map((model) => ({ id: model.id, name: (model.name ?? "").trim() || model.id, ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }) }))
						});
						if (draft.key.trim() !== "") await ops.storeCredential(keyRef, draft.key.trim());
						setNotice(t("preset.added.ok", { route }));
					}
					setDraft(null);
					setPanel("list");
					await loadDir();
					loadCatalog();
				} catch (error) {
					setFailure(t("preset.failed", { message: String(error.message ?? error) }));
				} finally {
					setBusy(false);
				}
			}, [draft, dir, ops, t, loadDir, loadCatalog]);
			/** 删除：先清凭证（可选），再 unset 配置；两步都幂等，失败可重试。 */
			const removeProvider = useCallback(async (route) => {
				const entry = dir.providers.get(route);
				if (entry === undefined) {
					setFailure(t("preset.notDeletable"));
					return;
				}
				setBusy(true);
				setFailure(null);
				try {
					const ref = deriveKeyRef(route);
					try {
						const states = await ops.credentialState([ref]);
						if (states[ref]?.configured === true) await ops.removeCredential(ref);
					} catch {
						// 凭证检查失败不阻断配置删除；删除配置后可到官方「模型」页补删。
					}
					await ops.unsetProvider(entry.settingsNs, entry.settingsPath);
					const after = await loadDir();
					setConfirmRoute(null);
					setNotice(after.has(route) ? t("preset.removedButDeclared", { route }) : t("preset.removed", { route }));
					if (!after.has(route)) loadCatalog();
				} catch (error) {
					setFailure(t("preset.failed", { message: String(error.message ?? error) }));
				} finally {
					setBusy(false);
				}
			}, [dir, ops, t, loadDir, loadCatalog]);
			if (panel === "closed") {
				return h("div", { className: "mpp_presets" },
					h("div", { className: "mpp_presetsHead" },
						h("span", { className: "mpp_presetsTitle" }, t("preset.title")),
						h("button", { type: "button", className: "mpp_miniButton mpp_primary", onClick: openList }, t("preset.add"))),
					h("p", { className: "mpp_hint" }, t("preset.hint")));
			}
			if (panel === "form" && draft !== null) {
				return h("div", { className: "mpp_presets" },
					h("div", { className: "mpp_presetsHead" },
						h("button", {
							type: "button",
							className: "mpp_backButton",
							"aria-label": t("preset.back"),
							disabled: busy || pulling,
							onClick: () => {
								setDraft(null);
								setPanel("list");
								setFailure(null);
								setNotice(null);
							},
							children: h(primitives.IconChevronLeftOutlineRegular, { size: 14 })
						}),
						h("span", { className: "mpp_presetsTitle" }, draft.editing ? t("preset.editTitle", { name: draft.preset.name }) : draft.preset === null ? t("preset.customTitle") : t("preset.formTitle", { name: draft.preset.name }))),
					failure !== null ? h("p", { className: "mpp_error" }, failure) : null,
					notice !== null ? h("p", { className: "mpp_hint" }, notice) : null,
					h("div", { className: "mpp_formGrid" },
						h("div", { className: "mpp_formRow2" },
							h("div", { className: "mpp_formRow" },
								h("span", { className: "mpp_formLabel" }, t("preset.route")),
								h(primitives.Input, { className: "mpp_formInput", type: "text", value: draft.route, "aria-label": t("preset.route"), disabled: busy || draft.editing === true, onBlur: recheckKeyConfigured, onChange: (event) => setDraft({ ...draft, route: event.target.value }) })),
							h("div", { className: "mpp_formRow" },
								h("span", { className: "mpp_formLabel" }, t("preset.displayName")),
								h(primitives.Input, { className: "mpp_formInput", type: "text", value: draft.displayName, "aria-label": t("preset.displayName"), disabled: busy, onChange: (event) => setDraft({ ...draft, displayName: event.target.value }) }))),
						routeInvalid ? h("p", { className: "mpp_error" }, t("preset.routeInvalid")) : null,
						routeTaken ? h("p", { className: "mpp_error" }, t("preset.routeTaken")) : null,
						h("p", { className: "mpp_hint" }, t("preset.routeHint")),
						h("div", { className: "mpp_formRow" },
							h("span", { className: "mpp_formLabel" }, t("preset.baseURL")),
							h(primitives.Input, { className: "mpp_formInput", type: "text", value: draft.baseURL, "aria-label": t("preset.baseURL"), disabled: busy, onChange: (event) => setDraft({ ...draft, baseURL: event.target.value }) })),
						baseURLInvalid ? h("p", { className: "mpp_error" }, t("preset.baseURLInvalid")) : null,
						h("div", { className: "mpp_formRow2" },
							h("div", { className: "mpp_formRow" },
								h("span", { className: "mpp_formLabel" }, t("preset.api")),
								h("select", { className: "mpp_formInput", value: draft.api, "aria-label": t("preset.api"), disabled: busy, onChange: (event) => setDraft({ ...draft, api: event.target.value }) }, PROTOCOLS.map((protocol) => h("option", { key: protocol, value: protocol }, protocol)))),
							h("div", { className: "mpp_formRow" },
								h("span", { className: "mpp_formLabel" }, t("preset.key")),
								h("div", { className: "mpp_keyRow" },
									h(primitives.Input, { className: "mpp_formInput", type: showKey ? "text" : "password", value: draft.key, "aria-label": t("preset.key"), disabled: busy, autoComplete: "off", onChange: (event) => setDraft({ ...draft, key: event.target.value }) }),
									h("button", {
										type: "button",
										className: "mpp_iconButton",
										"aria-label": showKey ? t("preset.hideKey") : t("preset.showKey"),
										title: showKey ? t("preset.hideKey") : t("preset.showKey"),
										onClick: () => setShowKey((current) => !current),
										children: showKey ? h(EyeOffIcon, {}) : h(EyeIcon, {})
									})))),
						keyConfigured !== null && keyConfigured === deriveKeyRef(draft.route.trim()) ? h("p", { className: "mpp_hint" }, t("preset.keyConfigured")) : null,
						h("div", { className: "mpp_formRow" },
							h("span", { className: "mpp_formLabel" }, t("preset.models")),
							draft.models.length === 0 ? h("p", { className: "mpp_hint" }, t("preset.pullHint")) : null,
							draft.models.length > 0 ? h("div", { className: "mpp_modelHead", "aria-hidden": "true" },
								h("span", { className: "mpp_colId" }, t("preset.modelId")),
								h("span", { className: "mpp_colName" }, t("preset.modelName")),
								h("span", { className: "mpp_colCtx" }, t("preset.modelContext")),
								h("span", { className: "mpp_colBtn" })) : null,
							draft.models.map((model, index) => h("div", { key: index, className: "mpp_modelRowEdit" },
								h(primitives.Input, { className: "mpp_formInput mpp_modelId", type: "text", value: model.id, placeholder: t("preset.modelId"), "aria-label": t("preset.modelId"), disabled: busy, onChange: (event) => updateModel(index, { id: event.target.value }) }),
								h(primitives.Input, { className: "mpp_formInput mpp_modelName", type: "text", value: model.name ?? "", placeholder: t("preset.modelNamePlaceholder"), "aria-label": t("preset.modelName"), disabled: busy, onChange: (event) => updateModel(index, { name: event.target.value }) }),
								h(primitives.Input, {
									className: "mpp_formInput mpp_modelContext",
									type: "text",
									value: model.contextWindow === undefined ? "" : String(model.contextWindow),
									placeholder: t("preset.modelContext"),
									"aria-label": t("preset.modelContext"),
									disabled: busy,
									onChange: (event) => {
										const text = event.target.value.trim();
										const value = text === "" ? undefined : Number(text);
										updateModel(index, { contextWindow: value === undefined || !Number.isFinite(value) ? undefined : value });
									}
								}),
								h("button", { type: "button", className: "mpp_miniButton", disabled: busy, "aria-label": t("preset.remove"), onClick: () => removeModel(index) }, "×"))),
							h("div", { className: "mpp_formActions" },
								h("button", { type: "button", className: "mpp_miniButton", disabled: busy || pulling, onClick: addModel }, t("preset.addModel")),
								h("button", { type: "button", className: "mpp_miniButton", disabled: busy || pulling, onClick: pull }, pulling ? t("preset.pulling") : t("preset.pull")))),
						h("div", { className: "mpp_formActions mpp_submitRow" },
							h("button", { type: "button", className: "mpp_miniButton mpp_primary", disabled: busy || pulling, onClick: submit }, busy ? t("preset.adding") : t("preset.submit")))));
			}
			// 列表：搜索 + 分类过滤 + 已添加标记 + 添加/删除。
			const needle = query.trim().toLowerCase();
			const filtered = PRESETS.filter((preset) => (category === "all" || preset.category === category) && (needle === "" || preset.name.toLowerCase().includes(needle) || preset.route.toLowerCase().includes(needle) || preset.baseURL.toLowerCase().includes(needle)));
			return h("div", { className: "mpp_presets" },
				h("div", { className: "mpp_presetsHead" },
					h("span", { className: "mpp_presetsTitle" }, t("preset.title")),
					dir.status === "loading" ? h("span", { className: "mpp_effortTag" }, t("preset.loading")) : null,
					h("button", { type: "button", className: "mpp_miniButton", onClick: () => setPanel("closed") }, t("preset.close"))),
				failure !== null ? h("p", { className: "mpp_error" }, failure) : null,
				notice !== null ? h("p", { className: "mpp_hint" }, notice) : null,
				h("div", { className: "mpp_searchRow" },
					h(primitives.Input, { className: "mpp_search", type: "text", "aria-label": t("preset.search"), placeholder: t("preset.search"), value: query, onChange: (event) => setQuery(event.target.value) })),
				h("div", { className: "mpp_catChips" }, ["all", "cn", "global"].map((id) => h("button", { key: id, type: "button", className: category === id ? "mpp_chip mpp_chipActive" : "mpp_chip", onClick: () => setCategory(id) }, t(`preset.cat.${id}`)))),
				h("div", { className: "mpp_presetRow mpp_customRow" },
					h("div", { className: "mpp_presetInfo" },
						h("div", { className: "mpp_presetName" }, t("preset.customRow")),
						h("div", { className: "mpp_presetMeta" }, t("preset.customDesc"))),
					h("div", { className: "mpp_presetActions" },
						h("button", { type: "button", className: "mpp_miniButton", disabled: busy, onClick: () => openForm(null) }, t("preset.addRow")))),
				h("div", { className: "mpp_presetList" }, filtered.map((preset) => {
					// 已声明（llm-pi-ai，可删除）与已注册（宿主其他来源，仅提示占用）分开标记。
					const declared = dir.providers.has(preset.route);
					const registered = dir.known.has(preset.route);
					return h("div", { key: preset.route, className: "mpp_presetRow" },
						h("div", { className: "mpp_presetInfo" },
							h("div", { className: "mpp_presetName" }, preset.name, declared ? h("span", { className: "mpp_badge mpp_badgeOk" }, t("preset.added")) : registered ? h("span", { className: "mpp_badge" }, t("preset.registeredBadge")) : null),
							h("div", { className: "mpp_presetMeta" }, `${preset.route} · ${preset.baseURL} · ${t("preset.modelCount", { count: String(preset.models.length) })}`)),
						h("div", { className: "mpp_presetActions" },
							declared ? h("button", { type: "button", className: "mpp_miniButton", disabled: busy, onClick: () => openEdit(preset) }, t("preset.edit")) : h("button", { type: "button", className: "mpp_miniButton", disabled: busy, onClick: () => openForm(preset) }, t("preset.addRow")),
							declared ? h("button", {
								type: "button",
								className: confirmRoute === preset.route ? "mpp_iconButton mpp_iconButtonDanger" : "mpp_iconButton",
								disabled: busy,
								"aria-label": confirmRoute === preset.route ? t("preset.confirmRemove") : t("preset.remove"),
								title: confirmRoute === preset.route ? t("preset.confirmRemove") : t("preset.remove"),
								onClick: () => {
									if (confirmRoute === preset.route) removeProvider(preset.route);
									else setConfirmRoute(preset.route);
								}
							}, h(primitives.IconTrashOutlineRegular, { size: 14 })) : null));
				})),
				filtered.length === 0 ? h("p", { className: "mpp_hint" }, t("preset.searchEmpty")) : null);
		}
		//#endregion
		//#region settings page
		/**
		 * 设置页：厂商可见性开关 + 每个厂商下的模型可见性开关。
		 *
		 * 厂商开关是主开关：关掉后该厂商及其全部模型都不出现在选择器里；
		 * 厂商开着时，下面的模型开关可以单独藏掉某个模型。
		 */
		function SettingsPage(props) {
			const { t, rules, groups, onToggleProvider, onToggleModel, onPruneStale, busy, status, error, loadCatalog, catalogStatus, presetOps, revealEnabled, onToggleReveal } = props;
			const [expanded, setExpanded] = useState(() => new Set());
			useEffect(() => {
				loadCatalog();
			}, [loadCatalog]);
			const toggleExpanded = (providerId) => {
				setExpanded((previous) => {
					const next = new Set(previous);
					if (next.has(providerId)) next.delete(providerId);
					else next.add(providerId);
					return next;
				});
			};
			// 空列表有三种成因，给用户的指引完全不同：
			// 还在读 → 等；读失败 → 看错误；读到了但没有厂商 → 去「模型」里配。
			const loading = catalogStatus === "loading" || catalogStatus === "idle";
			const emptyNotice = loading ? t("loadingProviders") : groups.length === 0 ? t("emptyProviders") : null;
			// 失效规则：隐藏规则指向的模型已不在当前目录里（多为配置精简后的遗留）。
			// 徽章只数仍然生效的隐藏；失效部分集中在标题旁提供一次性清理，
			// 不自动删——目录临时抖动时不至于丢掉用户的隐藏偏好。
			const totalStale = groups.reduce((sum, group) => {
				const hiddenRules = rules.models.get(group.id);
				if (hiddenRules === undefined) return sum;
				const active = (group.models ?? []).filter((model) => hiddenRules.has(model.id)).length;
				return sum + (hiddenRules.size - active);
			}, 0);
			// 凭证回显开关：默认关闭。开启期间 Host 半身才读取本地明文并写入
			// 投影（会落盘到 profile），关闭即清除，所以文案要把代价说清。
			const renderRevealSection = () => {
				if (onToggleReveal === undefined) return null;
				return h("div", { className: "mpp_section" },
					h("h3", { className: "mpp_sectionTitle" }, t("reveal.title")),
					h("div", { className: "mpp_revealRow" },
						h("div", { className: "mpp_revealText" },
							h("p", { className: "mpp_hint" }, revealEnabled ? t("reveal.on.hint") : t("reveal.off.hint")),
							revealEnabled ? h("p", { className: "mpp_revealWarn" }, t("reveal.warn")) : null),
						h(primitives.Switch, {
							checked: revealEnabled === true,
							disabled: busy,
							label: t("reveal.title"),
							title: revealEnabled ? t("reveal.disable") : t("reveal.enable"),
							onChange: () => {
								onToggleReveal();
							}
						})));
			};
		return h("div", { className: "mpp_settings" }, h("p", { className: "mpp_hint" }, t("hint")), status !== null ? h("p", { className: "mpp_hint" }, status) : null, error !== null ? h("p", { className: "mpp_error" }, error) : null, presetOps === undefined ? null : h(PresetManager, { t, ops: presetOps, loadCatalog, revealEnabled }), h("div", { className: "mpp_section" }, h("div", { className: "mpp_sectionHead" }, h("h3", { className: "mpp_sectionTitle" }, t("providersTitle")), totalStale > 0 ? h("button", { type: "button", className: "mpp_cleanupLink", title: t("cleanupStaleTitle"), onClick: () => onPruneStale && onPruneStale(groups) }, t("cleanupStale", { count: String(totalStale) })) : null), emptyNotice !== null ? h("p", { className: "mpp_hint" }, emptyNotice) : groups.map((group) => {
			const providerHidden = rules.providers.has(group.id);
			const isExpanded = expanded.has(group.id);
			const hiddenRules = rules.models.get(group.id);
			const hiddenModelCount = (group.models ?? []).filter((model) => hiddenRules !== undefined && hiddenRules.has(model.id)).length;
			return h("div", { key: group.id, className: "mpp_group" }, h("div", { className: "mpp_groupHead" }, h("button", {
				type: "button",
				className: "mpp_expandButton",
				"aria-expanded": isExpanded,
				"aria-label": group.name ?? group.id,
				onClick: () => {
					toggleExpanded(group.id);
				},
				children: h("span", { className: isExpanded ? "mpp_twisty mpp_twistyOpen" : "mpp_twisty" }, h(primitives.IconChevronRightOutlineRegular, { size: 12 }))
			}), h("span", { className: "mpp_groupName" }, group.name ?? group.id), h("span", { className: "mpp_groupId" }, group.id), hiddenModelCount > 0 ? h("span", { className: "mpp_badge" }, t("hiddenModels", { count: String(hiddenModelCount) })) : null, h("span", { className: "mpp_groupCount" }, String(group.models.length)), h("span", { className: "mpp_switchCell" }, h(primitives.Switch, {
				checked: !providerHidden,
				disabled: busy,
				label: group.name ?? group.id,
				title: providerHidden ? t("showProvider") : t("hideProvider"),
				onChange: () => {
					onToggleProvider(group.id);
				}
			}))), isExpanded ? h("div", { className: "mpp_models" }, group.models.map((model) => {
				const modelHidden = rules.models.get(group.id)?.has(model.id) === true;
				const effortCount = model.reasoning?.efforts.length ?? 0;
				return h("div", { key: `${group.id}/${model.id}`, className: "mpp_modelRow" }, h(primitives.Switch, {
					checked: !modelHidden,
					disabled: busy || providerHidden,
					label: model.name ?? model.id,
					title: modelHidden ? t("showModel") : t("hideModel"),
					onChange: () => {
						onToggleModel(group.id, model.id);
					}
				}), h("span", { className: "mpp_modelName" }, model.name ?? model.id), effortCount > 0 ? h("span", { className: "mpp_badge" }, t("effortCount", { count: String(effortCount) })) : null, h("span", { className: "mpp_groupId" }, model.id));
			})) : null);
		})), renderRevealSection());
		}
		//#region registration
		/** 本插件在 Host 设置里的命名空间。 */
		const NAMESPACE = "model-provider-picker";
		/**
		 * 所需服务：插槽、语言、会话、设置表单、Remote 目录接口。
		 *
		 * 官方的会话目录服务（`modelDirectories`）不在这里列出：它由
		 * ui-model-selection 插件提供，缺席时不应让整个插件停摆，因此
		 * 选择器那一侧改用 `ctx.inject` 单独等待它。
		 */
		const inject = [
			"slots",
			"locale",
			"sessions",
			"configForms",
			"remote",
			"remote.session",
			"remote.llm",
			"remote.settings",
			"remote.credentials"
		];
		/**
		 * 客户端主体：注册字典、共享规则状态、composer 两级选择器与设置页。
		 * @param {object} ctx 客户端根上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "model-provider-picker: dictionaries");
			const t = ctx.locale.bind(NS);
			const form = ctx.configForms.get(NAMESPACE);
			const rulesStore = createRulesStore(form);
			const catalog = createCatalogStore(ctx);
			// 预设库要用的 Host 操作（官方同款 Remote 通道：目录/凭证/设置/发现）。
			const providerOps = createProviderOperations(ctx);
			// 写回 Host：整组替换两个数组字段。
			const writeRules = async (providers, models) => {
				const ok = await form.mutate([{ op: "set", path: ["hiddenProviders"], value: providers }, { op: "set", path: ["hiddenModels"], value: models }]);
				if (!ok) throw new Error("host refused the visibility write");
			};
			const toggleProvider = async (providerId) => {
				const current = rulesStore.getSnapshot().rules;
				const providers = new Set(current.providers);
				if (providers.has(providerId)) providers.delete(providerId);
				else providers.add(providerId);
				const next = new VisibilityRules(providers, flattenModels(current));
				const arrays = next.toArrays();
				await writeRules(arrays.hiddenProviders, arrays.hiddenModels);
			};
			const toggleModel = async (providerId, modelId) => {
				const current = rulesStore.getSnapshot().rules;
				const next = new VisibilityRules(current.providers, flattenModels(current));
				const bucket = next.models.get(providerId);
				if (bucket === undefined) next.models.set(providerId, new Set([modelId]));
				else if (bucket.has(modelId)) bucket.delete(modelId);
				else bucket.add(modelId);
				const arrays = next.toArrays();
				await writeRules(arrays.hiddenProviders, arrays.hiddenModels);
			};
			// 清理失效的模型级隐藏规则：目录里已不存在的模型，其规则不再有意义。
			// 不在目录里的厂商整组保留（厂商可能只是暂时缺席，回来时偏好仍生效）。
			const pruneStale = async (catalogGroups) => {
				const current = rulesStore.getSnapshot().rules;
				const catalogIds = new Map((catalogGroups ?? []).map((group) => [group.id, new Set((group.models ?? []).map((model) => model.id))]));
				const models = [];
				for (const [provider, bucket] of current.models) {
					const ids = catalogIds.get(provider);
					for (const id of bucket) {
						if (ids === undefined || ids.has(id)) models.push(modelRule(provider, id));
					}
				}
				models.sort();
				await writeRules([...current.providers].sort(), models);
			};
			// 凭证回显开关：翻转布尔字段。Host 半身收到 volatile-update 后负责
			// 读取/清除明文与文件监听；这里只改开关本身。
			const toggleReveal = async () => {
				const next = !rulesStore.getSnapshot().reveal;
				const ok = await form.mutate([{ op: "set", path: ["revealKeysEnabled"], value: next }]);
				if (!ok) throw new Error("host refused the reveal toggle write");
			};
			// composer 的模型位：两级选择器（遮蔽官方那一条）。
			//
			// 官方会话目录服务由 ui-model-selection 提供；它缺席时这一段
			// 保持等待，而不是让整个插件停摆。
			ctx.inject(["modelDirectories"], (scope) => {
				scope.slots.inject("conversation.input.model", () => scope.slots.register({
					name: "conversation.input.model",
					priority: -10,
					locale: NS,
					inject: (sessionId) => {
						const directory = scope.modelDirectories.directoryFor(sessionId);
						const available = scope.sessions.subagentAddress(sessionId) === void 0;
						return {
							available,
							directory: directory.store,
							load: () => {
								if (available) directory.load().catch(() => {});
							},
							select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0),
							hooks: { rules: rulesStore }
						};
					}
				}, ModelPicker));
			});
			// 设置页：列出所有厂商与模型，勾选隐藏。
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "model-provider-picker",
				order: 40,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({
					// 只有 `hooks` 里的 observable 会被渲染层转成 `use<Name>` 选择器
					// Hook；平铺返回的 observable 只是普通 prop，组件拿不到订阅。
					hooks: {
						catalog: catalog.store,
						rules: rulesStore
					},
					loadCatalog: () => {
						catalog.load();
					},
					onToggleProvider: toggleProvider,
					onToggleModel: toggleModel,
					onPruneStale: pruneStale,
					onToggleReveal: toggleReveal,
					presetOps: providerOps
				})
			}, (sectionProps) => {
				const useRules = sectionProps.useRules ?? useEmptyRules;
				const useCatalog = sectionProps.useCatalog ?? useEmptyCatalog;
				const rules = useRules((snapshot) => snapshot.rules);
				const revealEnabled = useRules((snapshot) => snapshot.reveal);
				const catalogState = useCatalog((snapshot) => snapshot);
				const groups = catalogState.groups ?? [];
				// 加载与空态都由 SettingsPage 统一显示，这里只报真正的失败。
				const status = null;
				const error = catalogState.error === null ? null : t("saveFailed", { message: catalogState.error });
				return h(SettingsPage, {
					t,
					rules,
					groups,
					busy: false,
					status,
					error,
					catalogStatus: catalogState.status,
					loadCatalog: sectionProps.loadCatalog,
					onToggleProvider: sectionProps.onToggleProvider,
					onToggleModel: sectionProps.onToggleModel,
					onPruneStale: sectionProps.onPruneStale,
					onToggleReveal: sectionProps.onToggleReveal,
					revealEnabled,
					presetOps: sectionProps.presetOps
				});
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = "dsh-model-provider-picker";
		return module.exports;
	}
});
