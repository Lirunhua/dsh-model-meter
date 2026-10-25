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
			"tab.title": "Model Meter",
			"guide.title": "Model Meter",
			"guide.description": "DeepSeek 余额、GLM / Kimi 套餐与会话用量",
			"providers.title": "模型额度与余额",
			"providers.refresh": "刷新",
			"providers.refreshing": "获取中…",
			"providers.noKey": "请先在模型设置中配置此账号",
			"providers.error": "暂时无法查询账号用量",
			"providers.rpcUnavailable": "用量服务暂不可用，请重启 Harness 后刷新",
			"providers.rpcFailed": "暂时无法更新，已显示的数据可能已过期",
			"providers.fetchedAt": "更新于 {time}",
			"providers.shared": "账号层面的套餐额度和 API 余额；与下方的本会话 Token 统计分别计算。",
			"balance.total": "总可用余额",
			"balance.granted": "赠送余额",
			"balance.toppedUp": "充值余额",
			"balance.scope": "API 余额",
			"balance.available": "余额可用于 API 调用",
			"balance.unavailable": "余额不足，暂不可用于 API 调用",
			"balance.empty": "服务商尚未提供可显示的余额",
			"balance.unknown": "未提供",
			"quota.used": "已用 {percent}%",
			"quota.remaining": "剩余 {percent}%",
			"quota.unknown": "服务商未提供使用比例",
			"quota.resetAt": "重置：{time}",
			"quota.resetUnknown": "服务商未提供重置时间",
			"quota.resetDue": "已到重置时间，等待服务商更新",
			"quota.resetIn": "距重置 {time}",
			"quota.counts": "已用 {used} / {limit}",
			"quota.left": "剩余 {remaining}",
			"quota.empty": "服务商尚未返回可显示的额度窗口",
			"quota.5h": "5 小时窗口",
			"quota.7d": "7 天窗口",
			"quota.monthTotal": "月度总额度",
			"quota.monthCode": "月度编程额度",
			"quota.unknownWindow": "套餐窗口",
			"context.title": "上下文压力",
			"context.empty": "发送首条消息后，这里会出现上下文与用量数据",
			"context.estimate": "估算",
			"context.bar.aria": "上下文占用 {percent}%",
			"context.breakdown.system": "系统提示词",
			"context.breakdown.tools": "工具声明",
			"context.breakdown.messages": "对话消息",
			"tokens.title": "Token 用量（本会话累计）",
			"tokens.inUncached": "输入（未命中缓存）",
			"tokens.output": "输出",
			"tokens.cacheRead": "缓存读取",
			"tokens.cacheWrite": "缓存写入",
			"tokens.cacheHit": "缓存命中率",
			"session.title": "会话统计",
			"session.turns": "轮次",
			"session.steps": "步数",
			"session.llmMs": "模型耗时",
			"session.toolMs": "工具耗时",
			"note.approx": "额度与余额来自服务商，只读查询，每 60 秒刷新。Token 统计取决于模型上报；上下文构成为启发式估算（4 字符/token），中文可能低估。",
			"hook.unavailable": "当前会话的 Token 统计暂不可用。",
			"number.thousand": "{value}k",
			"number.million": "{value}M"
		};

		/** English dictionary (key set mirrors zh). */
		const en = {
			"tab.title": "Model Meter",
			"guide.title": "Model Meter",
			"guide.description": "DeepSeek balance, GLM / Kimi plan quotas, and session usage",
			"providers.title": "Model quotas & balances",
			"providers.refresh": "Refresh",
			"providers.refreshing": "Fetching…",
			"providers.noKey": "Configure this account in Models settings first",
			"providers.error": "Account usage is temporarily unavailable",
			"providers.rpcUnavailable": "Usage service unavailable. Restart Harness and refresh.",
			"providers.rpcFailed": "Could not refresh; displayed data may be out of date",
			"providers.fetchedAt": "Updated {time}",
			"providers.shared": "Account-wide plan quotas and API balances; session tokens below are counted separately.",
			"balance.total": "Total available balance",
			"balance.granted": "Granted balance",
			"balance.toppedUp": "Topped-up balance",
			"balance.scope": "API balance",
			"balance.available": "Balance available for API calls",
			"balance.unavailable": "Insufficient balance for API calls",
			"balance.empty": "Provider has not returned any balances",
			"balance.unknown": "Not provided",
			"quota.used": "{percent}% used",
			"quota.remaining": "{percent}% remaining",
			"quota.unknown": "Provider did not report a usage percentage",
			"quota.resetAt": "Resets: {time}",
			"quota.resetUnknown": "Provider did not report a reset time",
			"quota.resetDue": "Reset time reached; waiting for provider update",
			"quota.resetIn": "Resets in {time}",
			"quota.counts": "Used {used} / {limit}",
			"quota.left": "{remaining} remaining",
			"quota.empty": "Provider has not returned any quota windows",
			"quota.5h": "5-hour window",
			"quota.7d": "7-day window",
			"quota.monthTotal": "Monthly total quota",
			"quota.monthCode": "Monthly coding quota",
			"quota.unknownWindow": "Plan window",
			"context.title": "Context pressure",
			"context.empty": "Send the first message and context and usage data will appear here",
			"context.estimate": "estimated",
			"context.bar.aria": "Context occupancy {percent}%",
			"context.breakdown.system": "System prompt",
			"context.breakdown.tools": "Tool schemas",
			"context.breakdown.messages": "Messages",
			"tokens.title": "Token usage (session total)",
			"tokens.inUncached": "Input (uncached)",
			"tokens.output": "Output",
			"tokens.cacheRead": "Cache read",
			"tokens.cacheWrite": "Cache write",
			"tokens.cacheHit": "Cache hit rate",
			"session.title": "Session stats",
			"session.turns": "Turns",
			"session.steps": "Steps",
			"session.llmMs": "LLM time",
			"session.toolMs": "Tool time",
			"note.approx": "Quotas and balances are read from providers every 60s. Token totals depend on model reporting. Context composition is a heuristic estimate (4 chars/token) that may undercount CJK.",
			"hook.unavailable": "Session token statistics are temporarily unavailable.",
			"number.thousand": "{value}k",
			"number.million": "{value}M"
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

		/** Compact token count: 987 / 12.3k / 1.2M. */
		function fmtTokens(value) {
			if (value === undefined || value === null || !Number.isFinite(value)) return "–";
			if (value < 1e3) return String(Math.round(value));
			if (value < 1e6) return T("number.thousand", { value: (Math.round(value / 100) / 10).toString() });
			return T("number.million", { value: (Math.round(value / 1e5) / 10).toString() });
		}

		/** Compact wall time: 87 ms / 1.2 s / 3.4 min / 1h 05m. */
		function fmtDuration(ms) {
			if (!Number.isFinite(ms) || ms < 0) return "–";
			if (ms < 1e3) return `${Math.round(ms)} ms`;
			if (ms < 6e4) return `${(Math.round(ms / 100) / 10).toString()} s`;
			if (ms < 3.6e6) return `${(Math.round(ms / 6e3) / 10).toString()} min`;
			const h = Math.floor(ms / 3.6e6);
			const m = Math.round((ms % 3.6e6) / 6e4);
			return `${h}h ${String(m).padStart(2, "0")}m`;
		}

		/** Occupancy from the contextPressure projection (mirrors ui-conversation). */
		function contextOccupancy(pressure) {
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			if (!Number.isFinite(usedTokens) || usedTokens < 0 || !Number.isFinite(pressure?.contextWindow) || pressure.contextWindow <= 0) return null;
			return {
				percent: Math.min(100, Math.max(0, Math.round((usedTokens / pressure.contextWindow) * 100))),
				usedTokens,
				contextWindow: pressure.contextWindow
			};
		}

		/** Tone for an occupancy percent. */
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

		/** Horizontal occupancy meter. */
		function Meter({ percent, tone }) {
			return jsx("div", {
				role: "img",
				"aria-label": T("context.bar.aria", { percent: String(percent) }),
				style: {
					height: "6px",
					borderRadius: "999px",
					background: "var(--dsw-alias-fill-tertiary, rgba(0,0,0,0.08))",
					overflow: "hidden"
				},
				children: jsx("div", {
					style: {
						height: "100%",
						width: `${Math.max(0, Math.min(100, percent))}%`,
						borderRadius: "999px",
						background: TONE_COLOR[tone] ?? TONE_COLOR.ok,
						transition: "width 240ms ease"
					}
				})
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
			if (diff < 30_000) return T("providers.fetchedAt", { time: new Date(at).toLocaleTimeString() });
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
					percent === null ? null : jsx(Note, { children: T("quota.remaining", { percent: fmtPercent(100 - percent) }) }),
					Number.isFinite(window.used) && Number.isFinite(window.limit)
						? jsx(Note, { children: T("quota.counts", { used: window.used.toLocaleString(), limit: window.limit.toLocaleString() }) }) : null,
					Number.isFinite(window.remaining) ? jsx(Note, { children: T("quota.left", { remaining: window.remaining.toLocaleString() }) }) : null,
					window.warning ? jsx(Note, { children: window.warning }) : null,
					jsx(Note, { children: Number.isFinite(reset)
						? T("quota.resetAt", { time: new Date(reset).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) })
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

		/** Account quotas and balances, fetched over the authenticated /api bridge. */
		function ProviderSection() {
			const [state, setState] = useState({ busy: true, providers: [], error: "" });
			const [now, setNow] = useState(Date.now());
			const refresh = useRef(null);

			useEffect(() => {
				if (rpc === null) {
					setState({ busy: false, providers: [], error: T("providers.rpcUnavailable") });
					return undefined;
				}
				const controller = new AbortController();
				let alive = true;
				let pending = false;
				const load = async (refresh) => {
					if (pending || !alive) return;
					pending = true;
					if (alive) setState((prev) => ({ ...prev, busy: true }));
					try {
						const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(RPC_TIMEOUT_MS)]);
						const response = await rpc.call("/api", "usage-panel/balances", { refresh }, requestSignal);
						if (!alive) return;
						if (response?.ok !== true) {
							setState((prev) => ({ ...prev, busy: false, error: T("providers.rpcFailed") }));
							return;
						}
						setState({ busy: false, providers: Array.isArray(response.value?.providers) ? response.value.providers : [], error: "" });
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
			}, []);

			return jsxs(Section, {
				title: T("providers.title"),
				extra: jsx(RefreshButton, { busy: state.busy, onClick: () => { refresh.current?.(); } }),
				children: [
					jsx(Note, { children: T("providers.shared") }),
					state.error === "" ? null : jsx(Note, { children: state.error }),
					state.busy && state.providers.length === 0 && state.error === "" ? jsx(Note, { children: T("providers.refreshing") }) : null,
					state.providers.map((provider) => {
						return jsxs("div", {
							"data-usage-provider": provider.id,
							style: { display: "flex", flexDirection: "column", gap: "10px", padding: "10px 0", borderTop: "1px solid var(--dsw-alias-stroke-secondary, rgba(0,0,0,.08))" },
							children: [
								jsx("strong", { style: { fontSize: "13px", fontWeight: 600 }, children: provider.label }),
								provider.kind === "balance" ? jsx(Note, { children: T("balance.scope") }) : null,
								provider.status === "no-key" ? jsx(Note, { children: T("providers.noKey") }) : null,
								provider.status !== "ok" && provider.status !== "no-key" ? jsx(Note, { children: provider.message || T("providers.error") }) : null,
								provider.status === "ok" && provider.kind === "balance" ? jsx(BalanceBody, { provider }) : null,
								provider.status === "ok" && provider.kind !== "balance" && (!Array.isArray(provider.windows) || provider.windows.length === 0) ? jsx(Note, { children: T("quota.empty") }) : null,
								provider.status === "ok" && provider.kind !== "balance" && Array.isArray(provider.windows) ? provider.windows.map((window) => jsx(QuotaWindow, { window, now }, window.id)) : null,
								provider.warning ? jsx(Note, { children: provider.warning }) : null,
								provider.status === "ok" ? jsx(Note, { children: relTime(provider.fetchedAt) }) : null
							]
						}, provider.id);
					})
				]
			});
		}

		/** The usage panel body registered under `sidebar.right.pane.tab`. */
		function UsageBody({ useProjection }) {
			if (typeof useProjection !== "function") {
				return jsxs("div", { style: { padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }, children: [jsx(ProviderSection, {}), jsx(Note, { children: T("hook.unavailable") })] });
			}
			const pressure = useProjection("contextPressure");
			const breakdown = useProjection("contextBreakdown");
			const usage = useProjection("tokenUsage");
			const stats = useProjection("sessionStats");
			const occ = contextOccupancy(pressure);

			const inUncached = usage?.uncachedInputTokens;
			const output = usage?.outputTokens;
			const cacheRead = usage?.cacheReadTokens;
			const cacheWrite = usage?.cacheWriteTokens;
			const cacheBase = (cacheRead ?? 0) + (inUncached ?? 0);
			const cacheHit = cacheBase > 0 ? Math.round(((cacheRead ?? 0) / cacheBase) * 100) : null;

			const hasAny = occ !== null || usage !== undefined || stats !== undefined;

			return jsxs("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					gap: "10px",
					padding: "12px",
					overflowY: "auto",
					height: "100%",
					boxSizing: "border-box"
				},
				children: [
					jsx(ProviderSection, {}),

					!hasAny ? jsx(Section, { children: jsx(Note, { children: T("context.empty") }) }) : null,

					occ !== null ? jsxs(Section, { title: T("context.title"), children: [
						jsx(Meter, { percent: occ.percent, tone: toneOf(occ.percent) }),
						jsx(Row, { label: `${occ.percent}%`, value: `${fmtTokens(occ.usedTokens)} / ${fmtTokens(occ.contextWindow)}` }),
						breakdown === undefined ? null : jsxs("span", { children: [
							jsx("div", { style: { height: 1, background: "var(--dsw-alias-stroke-secondary, rgba(0,0,0,0.08))" } }),
							jsx(Row, { label: T("context.breakdown.system"), value: fmtTokens(breakdown.systemTokens) }),
							jsx(Row, { label: T("context.breakdown.tools"), value: fmtTokens(breakdown.toolsTokens) }),
							jsx(Row, { label: T("context.breakdown.messages"), value: fmtTokens(breakdown.messageTokens) }),
							jsx(Note, { children: `· ${T("context.estimate")}` })
						] })
					] }) : null,

					usage !== undefined ? jsxs(Section, { title: T("tokens.title"), children: [
						jsx(Row, { label: T("tokens.inUncached"), value: fmtTokens(inUncached) }),
						jsx(Row, { label: T("tokens.output"), value: fmtTokens(output) }),
						jsx(Row, { label: T("tokens.cacheRead"), value: fmtTokens(cacheRead) }),
						jsx(Row, { label: T("tokens.cacheWrite"), value: fmtTokens(cacheWrite) }),
						cacheHit === null ? null : jsx(Row, { label: T("tokens.cacheHit"), value: `${cacheHit}%` })
					] }) : null,

					stats !== undefined && stats !== null ? jsxs(Section, { title: T("session.title"), children: [
						jsx(Row, { label: T("session.turns"), value: String(stats.turns ?? 0) }),
						jsx(Row, { label: T("session.steps"), value: String(stats.steps ?? 0) }),
						jsx(Row, { label: T("session.llmMs"), value: fmtDuration(stats.llmMs) }),
						jsx(Row, { label: T("session.toolMs"), value: fmtDuration(stats.toolMs) })
					] }) : null,

					jsx(Note, { children: T("note.approx") })
				]
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
