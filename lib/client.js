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
		const { createElement: h, Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
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
/* 设置页里厂商行的模型数量：固定一列、右对齐、等宽数字，避免随厂商名长短漂移 */
.mpp_groupCount{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;min-width:2.5ch;text-align:right;font-variant-numeric:tabular-nums}
.mpp_badge{font-size:11px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;white-space:nowrap;flex:none}
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
				ready: false
			});
			const sync = () => {
				const value = form.getSnapshot().value;
				const next = new VisibilityRules(value?.hiddenProviders ?? [], value?.hiddenModels ?? []);
				const current = store.getSnapshot();
				if (current.ready) {
					const a = current.rules.toArrays();
					const b = next.toArrays();
					if (a.hiddenProviders.join(" ") === b.hiddenProviders.join(" ") && a.hiddenModels.join(" ") === b.hiddenModels.join(" ")) return;
				}
				store.set({ rules: next, ready: true });
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
			useEffect(() => {
				if (!open) {
					setMenuPos(null);
					return;
				}
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect === undefined) return;
					const MARGIN = 12;
					const lw = menuRef.current?.offsetWidth ?? 0;
					const lh = menuRef.current?.offsetHeight ?? 0;
					let x = rect.right - lw;
					let y = rect.top - 8 - lh;
					if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
					if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
					setMenuPos({ left: x, top: y });
				};
				place();
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				return () => {
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
			// 触发器：模型名与推理等级用不同样式，等级更小更淡。
			const triggerAria = state.current === null ? t("trigger.fallback") : currentEffort === undefined ? t("trigger.aria", { model: currentLabel }) : t("trigger.ariaEffort", { model: currentLabel, effort: currentEffort });
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
					}), h("span", { className: "mpp_headTitle" }, t("menu.effort")), h("span", { className: "mpp_headSub" }, model?.name ?? pending.model));
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
					title: currentEffort === undefined ? currentLabel : `${currentLabel} ${currentEffort}`,
					"aria-busy": busy,
					disabled: locked,
					onClick: () => {
						if (open) close(true);
						else show();
					},
					children: [h(primitives.IconDataOutlineRegular, { size: 16 }), h("span", { className: "mpp_triggerLabel" }, currentLabel), currentEffort === undefined ? null : h("span", { className: "mpp_triggerEffort" }, currentEffort), busy ? h(primitives.StateDot, { state: "ongoing" }) : h(primitives.IconChevronDownOutlineRegular, { className: open ? "mpp_chevron mpp_chevronOpen" : "mpp_chevron" })]
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
		//#region settings page
		/**
		 * 设置页：厂商可见性开关 + 每个厂商下的模型可见性开关。
		 *
		 * 厂商开关是主开关：关掉后该厂商及其全部模型都不出现在选择器里；
		 * 厂商开着时，下面的模型开关可以单独藏掉某个模型。
		 */
		function SettingsPage(props) {
			const { t, rules, groups, onToggleProvider, onToggleModel, busy, status, error, loadCatalog, catalogStatus } = props;
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
		return h("div", { className: "mpp_settings" }, h("p", { className: "mpp_hint" }, t("hint")), status !== null ? h("p", { className: "mpp_hint" }, status) : null, error !== null ? h("p", { className: "mpp_error" }, error) : null, h("div", { className: "mpp_section" }, h("h3", { className: "mpp_sectionTitle" }, t("providersTitle")), emptyNotice !== null ? h("p", { className: "mpp_hint" }, emptyNotice) : groups.map((group) => {
			const providerHidden = rules.providers.has(group.id);
			const isExpanded = expanded.has(group.id);
			const hiddenModelCount = rules.models.get(group.id)?.size ?? 0;
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
		})));
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
			"remote.session"
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
					onToggleModel: toggleModel
				})
			}, (sectionProps) => {
				const useRules = sectionProps.useRules ?? useEmptyRules;
				const useCatalog = sectionProps.useCatalog ?? useEmptyCatalog;
				const rules = useRules((snapshot) => snapshot.rules);
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
					onToggleModel: sectionProps.onToggleModel
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
