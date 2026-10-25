window.__ModuleLoader__.load({
	id: "dsh-model-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const react_jsx_runtime = require("react/jsx-runtime");
		const jsx = react_jsx_runtime.jsx;
		const jsxs = react_jsx_runtime.jsxs;
		const { useEffect, useRef, useState } = react;

		/** Dictionary namespace owned by this plugin. */
		const NS = "usage-panel";
		/** This tab type implementation's identity in the tab system. */
		const ID = "dsh-usage-panel/usage";
		/** Page kind: opened by kind from the guide / add control. */
		const KIND = "usage";
		/** Balance auto-refresh interval. */
		const BALANCE_REFRESH_MS = 60_000;
		const RPC_TIMEOUT_MS = 12_000;

		/** 中文词典（键集与 en 完全一致）。 */
		const zh = {
			"tab.title": "用量",
			"guide.title": "用量",
			"guide.description": "当前选中模型的服务商额度与余额",
			"providers.title": "当前模型用量",
			"providers.currentModel": "当前模型：{model}",
			"providers.scope": "服务商账号层面的套餐额度 / API 余额，每 60 秒自动刷新。",
			"providers.refresh": "刷新",
			"providers.refreshing": "获取中…",
			"providers.noKey": "请先在模型设置中配置此账号",
			"providers.error": "暂时无法查询账号用量",
			"providers.unsupported": "该模型的服务商暂不提供用量查询",
			"providers.accountUnsupported": "暂不支持查询 DeepSeek 账号登录额度；API 余额仅适用于 API Key 模型",
			"providers.selectModel": "选择模型后，这里显示该模型的用量",
			"providers.rpcUnavailable": "用量服务暂不可用，请重启 Harness 后刷新",
			"providers.rpcFailed": "暂时无法更新，已显示的数据可能已过期",
			"providers.fetchedAt": "更新于 {time}",
			"balance.total": "总可用余额",
			"balance.granted": "赠送余额",
			"balance.toppedUp": "充值余额",
			"balance.scope": "API 余额",
			"balance.available": "余额可用于 API 调用",
			"balance.unavailable": "余额不足，暂不可用于 API 调用",
			"balance.empty": "服务商尚未提供可显示的余额",
			"balance.unknown": "未提供",
			"quota.used": "已用 {percent}%",
			"quota.unknown": "服务商未提供使用比例",
			"quota.resetAt": "重置：{time}",
			"quota.resetUnknown": "服务商未提供重置时间",
			"quota.resetDue": "已到重置时间，等待服务商更新",
			"quota.resetIn": "距重置 {time}",
			"quota.empty": "服务商尚未返回可显示的额度窗口",
			"quota.5h": "5 小时窗口",
			"quota.7d": "7 天窗口",
			"quota.monthTotal": "月度总额度",
			"quota.monthCode": "月度编程额度",
			"quota.unknownWindow": "套餐窗口",
			"hook.unavailable": "用量插件未能读取会话投影。",
			"locale.tag": "zh-CN"
		};

		/** English dictionary (key set mirrors zh). */
		const en = {
			"tab.title": "Usage",
			"guide.title": "Usage",
			"guide.description": "Quotas and balances for the selected model's provider",
			"providers.title": "Selected model usage",
			"providers.currentModel": "Selected model: {model}",
			"providers.scope": "Account-level plan quotas / API balance, refreshed every 60s.",
			"providers.refresh": "Refresh",
			"providers.refreshing": "Fetching…",
			"providers.noKey": "Configure this account in Models settings first",
			"providers.error": "Account usage is temporarily unavailable",
			"providers.unsupported": "This model's provider does not expose usage queries",
			"providers.accountUnsupported": "DeepSeek account-login quota queries are not supported; API balances apply only to API-key models",
			"providers.selectModel": "Pick a model and its usage appears here",
			"providers.rpcUnavailable": "Usage service unavailable. Restart Harness and refresh.",
			"providers.rpcFailed": "Could not refresh; displayed data may be out of date",
			"providers.fetchedAt": "Updated {time}",
			"balance.total": "Total available balance",
			"balance.granted": "Granted balance",
			"balance.toppedUp": "Topped-up balance",
			"balance.scope": "API balance",
			"balance.available": "Balance available for API calls",
			"balance.unavailable": "Insufficient balance for API calls",
			"balance.empty": "Provider has not returned any balances",
			"balance.unknown": "Not provided",
			"quota.used": "{percent}% used",
			"quota.unknown": "Provider did not report a usage percentage",
			"quota.resetAt": "Resets: {time}",
			"quota.resetUnknown": "Provider did not report a reset time",
			"quota.resetDue": "Reset time reached; waiting for provider update",
			"quota.resetIn": "Resets in {time}",
			"quota.empty": "Provider has not returned any quota windows",
			"quota.5h": "5-hour window",
			"quota.7d": "7-day window",
			"quota.monthTotal": "Monthly total quota",
			"quota.monthCode": "Monthly coding quota",
			"quota.unknownWindow": "Plan window",
			"hook.unavailable": "The usage panel could not read session projections.",
			"locale.tag": "en-US"
		};

		/** Locale-bound translate, set once apply() runs. */
		let bound = null;
		/** Translate in this plugin's namespace. */
		const T = (key, params) => {
			if (bound) return bound(key, params);
			let text = zh[key] ?? key;
			if (params) for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
			return text;
		};
		/** Remote RPC transport, set once apply() runs. */
		let rpc = null;

		/** Services required by the client plugin. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"sidebarRight",
			"sidebarRightTabs"
		];

		/** Tone for a usage percent. */
		function toneOf(percent) {
			if (percent >= 95) return "danger";
			if (percent >= 80) return "warn";
			return "ok";
		}

		const TONE_COLOR = {
			ok: "var(--dsw-alias-fill-accent-bold, #4c6ef5)",
			warn: "var(--dsw-alias-fill-warning, #e8a33d)",
			danger: "var(--dsw-alias-fill-danger, #d9480f)"
		};

		/** One card section. */
		function Section({ title, extra, children }) {
			return jsxs("section", {
				style: {
					border: "1px solid var(--dsw-alias-stroke-secondary, rgba(0,0,0,0.10))",
					borderRadius: "var(--dsw-radius-lg, 10px)",
					padding: "10px 12px",
					display: "flex",
					flexDirection: "column",
					gap: "8px"
				},
				children: [
					title === undefined ? null : jsxs("div", {
						style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
						children: [
							jsx("h3", {
								style: {
									margin: 0,
									fontSize: "var(--dsh-content-font-size-secondary, 13px)",
									fontWeight: 600,
									color: "var(--dsw-alias-label-primary, inherit)"
								},
								children: title
							}),
							extra ?? null
						]
					}),
					children
				]
			});
		}

		/** Label/value row. */
		function Row({ label, value, muted }) {
			return jsxs("div", {
				style: {
					display: "flex",
					justifyContent: "space-between",
					gap: "12px",
					fontSize: "var(--dsh-content-font-size-secondary, 13px)",
					color: "var(--dsw-alias-label-secondary, inherit)"
				},
				children: [
					jsx("span", { style: { flexShrink: 0 }, children: label }),
					jsx("span", {
						style: {
							fontVariantNumeric: "tabular-nums",
							color: muted === true ? "var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))" : "var(--dsw-alias-label-primary, inherit)",
							textAlign: "right",
							overflowWrap: "anywhere"
						},
						children: value
					})
				]
			});
		}

		/** Muted footnote text. */
		function Note({ children }) {
			return jsx("p", {
				style: {
					margin: 0,
					fontSize: "var(--dsh-content-font-size-tertiary, 12px)",
					lineHeight: 1.5,
					color: "var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))"
				},
				children
			});
		}

		/** Small inline refresh button. */
		function RefreshButton({ busy, onClick }) {
			return jsx("button", {
				type: "button",
				disabled: busy,
				onClick,
				style: {
					border: "none",
					background: "transparent",
					color: "var(--dsw-alias-label-secondary, rgba(0,0,0,0.55))",
					fontSize: "var(--dsh-content-font-size-tertiary, 12px)",
					padding: "2px 6px",
					borderRadius: "var(--dsw-radius-sm, 6px)",
					cursor: busy === true ? "default" : "pointer"
				},
				children: busy === true ? T("providers.refreshing") : T("providers.refresh")
			});
		}

		/** Relative fetch time for a provider card. */
		function relTime(at) {
			if (!Number.isFinite(at)) return "";
			const diff = Date.now() - at;
			if (diff < 30_000) return T("providers.fetchedAt", { time: new Date(at).toLocaleTimeString(T("locale.tag"), { hour: "2-digit", minute: "2-digit" }) });
			return T("providers.fetchedAt", { time: `${Math.max(1, Math.round(diff / 60_000))} min` });
		}

		function fmtPercent(value) {
			return String(Math.round(value * 100) / 100);
		}

		function windowLabel(window) {
			const labels = {
				"5h": "quota.5h", "limit_5h": "quota.5h",
				"7d": "quota.7d", "limit_7d": "quota.7d",
				"month-total": "quota.monthTotal", "limit_month_total": "quota.monthTotal",
				"month-code": "quota.monthCode", "limit_month_code": "quota.monthCode"
			};
			return labels[window.id] ? T(labels[window.id]) : window.label || T("quota.unknownWindow");
		}

		/** Provider-supplied reset times; no reset schedule is inferred locally. */
		function QuotaWindow({ window, now }) {
			const percent = typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)
				&& window.usedPercent >= 0 && window.usedPercent <= 100 ? window.usedPercent : null;
			const reset = typeof window.resetAt === "string" ? Date.parse(window.resetAt) : NaN;
			const delta = reset - now;
			const minutes = Math.max(1, Math.ceil(delta / 60_000));
			const countdown = minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
				: minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
			const label = windowLabel(window);
			return jsxs("div", {
				"data-quota-window": window.id,
				style: { display: "flex", flexDirection: "column", gap: "5px" },
				children: [
					jsx(Row, { label, value: percent === null ? "–" : T("quota.used", { percent: fmtPercent(percent) }) }),
					percent === null ? jsx(Note, { children: T("quota.unknown") }) : jsx("div", {
						role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100,
						"aria-valuenow": percent, "aria-valuetext": T("quota.used", { percent: fmtPercent(percent) }),
						style: { height: "6px", borderRadius: "999px", background: "var(--dsw-alias-fill-tertiary, rgba(0,0,0,.08))", overflow: "hidden" },
						children: jsx("div", { style: { height: "100%", width: `${percent}%`, background: TONE_COLOR[toneOf(percent)] } })
					}),
					jsx(Note, { children: Number.isFinite(reset)
						? T("quota.resetAt", { time: new Date(reset).toLocaleString(T("locale.tag"), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) })
						: T("quota.resetUnknown") }),
					!Number.isFinite(reset) ? null : jsx(Note, { children: delta <= 0 ? T("quota.resetDue") : T("quota.resetIn", { time: countdown }) })
				]
			});
		}

		/** Keep the provider's decimal string intact, including currency and precision. */
		function fmtMoney(value, currency) {
			if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/u.test(value) || !["CNY", "USD"].includes(currency)) return T("balance.unknown");
			return `${currency} ${value}`;
		}

		function BalanceBody({ provider }) {
			const balances = Array.isArray(provider.balances) ? provider.balances : [];
			return jsxs("div", {
				style: { display: "flex", flexDirection: "column", gap: "8px" },
				children: [
					balances.length === 0 ? jsx(Note, { children: T("balance.empty") }) : null,
					balances.map((balance, index) => jsxs("div", {
						"data-usage-currency": balance.currency,
						style: { display: "flex", flexDirection: "column", gap: "5px" },
						children: [
							jsx(Row, { label: T("balance.total"), value: fmtMoney(balance.total, balance.currency) }),
							jsx(Row, { label: T("balance.toppedUp"), value: fmtMoney(balance.toppedUp, balance.currency) }),
							jsx(Row, { label: T("balance.granted"), value: fmtMoney(balance.granted, balance.currency) })
						]
					}, `${balance.currency}-${index}`)),
					typeof provider.isAvailable !== "boolean" ? null : jsx("span", {
						style: { fontSize: "12px", color: provider.isAvailable ? "var(--dsw-alias-label-secondary, inherit)" : TONE_COLOR.danger },
						children: T(provider.isAvailable ? "balance.available" : "balance.unavailable")
					})
				]
			});
		}

		/** Account quotas and balances for the selected model, fetched over the authenticated /api bridge. */
		function ProviderSection({ provider, model }) {
			const [snapshot, setState] = useState({ provider, busy: true, providers: [], unsupported: "", error: "" });
			// A newly selected provider must never display a previous provider's snapshot.
			const state = snapshot.provider === provider ? snapshot : { busy: true, providers: [], unsupported: "", error: "" };
			const [now, setNow] = useState(Date.now());
			const refresh = useRef(null);

			useEffect(() => {
				if (rpc === null) {
					setState({ provider, busy: false, providers: [], unsupported: "", error: T("providers.rpcUnavailable") });
					return undefined;
				}
				const controller = new AbortController();
				let alive = true;
				let pending = false;
				const load = async (force) => {
					if (pending || !alive) return;
					pending = true;
					if (alive) setState((prev) => prev.provider === provider ? { ...prev, busy: true } : { provider, busy: true, providers: [], unsupported: "", error: "" });
					try {
						const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]);
						const response = await rpc.call("/api", "usage-panel/balances", { refresh: force, provider }, requestSignal);
						if (!alive) return;
						if (response?.ok !== true) {
							setState((prev) => ({ ...prev, busy: false, error: T("providers.rpcFailed") }));
							return;
						}
						setState({
							provider,
							busy: false,
							providers: Array.isArray(response.value?.providers) ? response.value.providers : [],
							unsupported: typeof response.value?.unsupportedProvider === "string" ? response.value.unsupportedProvider : "",
							error: ""
						});
					} catch (error) {
						if (!alive) return;
						setState((prev) => ({ ...prev, busy: false, error: T("providers.rpcFailed") }));
					} finally {
						pending = false;
					}
				};
				refresh.current = () => { load(true); };
				load(false);
				const timer = setInterval(() => { load(false); }, BALANCE_REFRESH_MS);
				const clock = setInterval(() => { setNow(Date.now()); }, 15_000);
				return () => {
					alive = false;
					refresh.current = null;
					controller.abort();
					clearInterval(timer);
					clearInterval(clock);
				};
			}, [provider]);

			return jsxs(Section, {
				title: T("providers.title"),
				extra: jsx(RefreshButton, { busy: state.busy, onClick: () => { refresh.current?.(); } }),
				children: [
					model === undefined || model === "" ? null : jsx(Note, { children: T("providers.currentModel", { model }) }),
					jsx(Note, { children: T("providers.scope") }),
					state.error === "" ? null : jsx(Note, { children: state.error }),
					state.unsupported ? jsx(Note, { children: T(state.unsupported === "deepseek-account" ? "providers.accountUnsupported" : "providers.unsupported") }) : null,
					state.busy && state.providers.length === 0 && state.error === "" && !state.unsupported ? jsx(Note, { children: T("providers.refreshing") }) : null,
					state.providers.map((entry) => {
						return jsxs("div", {
							"data-usage-provider": entry.id,
							style: { display: "flex", flexDirection: "column", gap: "10px", padding: "10px 0", borderTop: "1px solid var(--dsw-alias-stroke-secondary, rgba(0,0,0,.08))" },
							children: [
								jsx("strong", { style: { fontSize: "13px", fontWeight: 600 }, children: entry.label }),
								entry.kind === "balance" ? jsx(Note, { children: T("balance.scope") }) : null,
								entry.status === "no-key" ? jsx(Note, { children: T("providers.noKey") }) : null,
								entry.status !== "ok" && entry.status !== "no-key" ? jsx(Note, { children: entry.message || T("providers.error") }) : null,
								entry.status === "ok" && entry.kind === "balance" ? jsx(BalanceBody, { provider: entry }) : null,
								entry.status === "ok" && entry.kind !== "balance" && (!Array.isArray(entry.windows) || entry.windows.length === 0) ? jsx(Note, { children: T("quota.empty") }) : null,
								entry.status === "ok" && entry.kind !== "balance" && Array.isArray(entry.windows) ? entry.windows.map((window) => jsx(QuotaWindow, { window, now }, window.id)) : null,
								entry.warning ? jsx(Note, { children: entry.warning }) : null,
								entry.status === "ok" ? jsx(Note, { children: relTime(entry.fetchedAt) }) : null
							]
						}, entry.id);
					})
				]
			});
		}

		/** The usage panel body registered under `sidebar.right.pane.tab`. */
		function UsageBody({ useProjection }) {
			if (typeof useProjection !== "function") {
				return jsxs("div", { style: { padding: "12px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto", height: "100%", boxSizing: "border-box" }, children: jsx(Note, { children: T("hook.unavailable") }) });
			}
			const selection = useProjection("modelSelection");
			const choice = selection?.next ?? selection?.lastUsed;
			const provider = typeof choice?.provider === "string" && choice.provider.trim() !== "" ? choice.provider : undefined;
			const model = typeof choice?.model === "string" ? choice.model : undefined;

			return jsx("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "10px",
					padding: "12px",
					overflowY: "auto",
					height: "100%",
					boxSizing: "border-box"
				},
				children: provider === undefined
					? jsx(Section, { children: jsx(Note, { children: T("providers.selectModel") }) })
					: jsx(ProviderSection, { provider, model })
			});
		}


		/**
		* Client plugin body: register the dictionaries, the `usage` page
		* tab type with its guide entry, and the tab body seat.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			bound = ctx.locale.bind(NS);
			try {
				rpc = ctx.get("connection").rpc;
			} catch {
				rpc = null;
			}
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage-panel: dictionaries");
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: ID,
				kind: KIND,
				title: () => bound("tab.title"),
				guide: [{
					id: "usage",
					order: 20,
					title: () => bound("guide.title"),
					description: () => bound("guide.description")
				}]
			}), "usage-panel: sidebar tab type");
			ctx.effect(() => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: ID,
				locale: NS
			}, UsageBody), "usage-panel: sidebar tab body");
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "dsh-model-meter/client";
		return module.exports;
	}
});
