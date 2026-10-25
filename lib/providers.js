import { createHash } from "node:crypto";

const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REF = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const USER_AGENT = "dsh-model-meter/0.6.1";

function numeric(value) {
	if (typeof value === "string") {
		if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())) return undefined;
		value = Number(value);
	}
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function percent(value, scale = 1) {
	const number = numeric(value);
	return number === undefined || number > 100 / scale ? null : Math.round(number * scale * 100) / 100;
}

/** Accept an ISO instant, or an explicitly millisecond epoch; never infer resets. */
function resetTime(value) {
	let milliseconds;
	if (typeof value === "string" && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/u.test(value)) milliseconds = Date.parse(value);
	else {
		const number = numeric(value);
		if (number !== undefined && number >= 1e12) milliseconds = number;
	}
	return Number.isFinite(milliseconds) && milliseconds < 8.64e15 ? new Date(milliseconds).toISOString() : undefined;
}

/** Epoch seconds (the ChatGPT usage dialect) or an epoch-millisecond value. */
function resetEpoch(value) {
	const number = numeric(value);
	if (number === undefined || number < 0) return undefined;
	const milliseconds = number >= 1e12 ? number : number >= 1e9 ? number * 1e3 : undefined;
	return milliseconds !== undefined && milliseconds < 8.64e15 ? new Date(milliseconds).toISOString() : undefined;
}

function counts(value) {
	const limit = numeric(value?.limit);
	let used = numeric(value?.used);
	let remaining = numeric(value?.remaining);
	if (used === undefined && limit !== undefined && remaining !== undefined && remaining <= limit) used = limit - remaining;
	if (remaining === undefined && limit !== undefined && used !== undefined) remaining = Math.max(0, limit - used);
	return {
		...(used === undefined ? {} : { used }),
		...(limit === undefined ? {} : { limit }),
		...(remaining === undefined ? {} : { remaining }),
		usedPercent: limit !== undefined && limit > 0 && used !== undefined ? Math.min(100, Math.round(used / limit * 10_000) / 100) : null
	};
}

function durationId(window, index) {
	const duration = numeric(window?.duration);
	const unit = String(window?.timeUnit ?? "").toUpperCase();
	const hours = unit.includes("MINUTE") ? duration / 60 : unit.includes("SECOND") ? duration / 3600 : unit.includes("HOUR") ? duration : unit.includes("DAY") ? duration * 24 : undefined;
	if (hours === 5) return { id: "5h", label: "5 小时额度" };
	if (hours === 168) return { id: "7d", label: "每周额度" };
	return { id: `window-${index}`, label: "其他套餐额度" };
}

export function parseKimiUsage(body) {
	let windows = [];
	if (body?.usages && typeof body.usages === "object" && !Array.isArray(body.usages)) {
		windows = [
			["limit_5h", "5h", "5 小时额度"],
			["limit_7d", "7d", "每周额度"],
			["limit_month_total", "month-total", "每月总额度"],
			["limit_month_code", "month-code", "每月代码额度"]
		].flatMap(([key, id, label]) => {
			const value = body.usages[key];
			if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
			const resetAt = resetTime(value.reset_time);
			return [{ id, label, usedPercent: percent(value.used_ratio, 100), ...(resetAt ? { resetAt } : {}) }];
		});
	}
	const legacy = [];
	if (body?.usage && typeof body.usage === "object" && !Array.isArray(body.usage)) {
		const resetAt = resetTime(body.usage.resetTime);
		legacy.push({ id: "7d", label: "每周额度", ...counts(body.usage), ...(resetAt ? { resetAt } : {}) });
	}
	for (const [index, item] of (Array.isArray(body?.limits) ? body.limits : []).entries()) {
		if (!item?.detail || typeof item.detail !== "object" || Array.isArray(item.detail)) continue;
		const identity = durationId(item.window, index);
		if (legacy.some((window) => window.id === identity.id)) continue;
		const resetAt = resetTime(item.detail.resetTime);
		legacy.push({ ...identity, ...counts(item.detail), ...(resetAt ? { resetAt } : {}) });
	}
	for (const record of legacy) {
		const index = windows.findIndex((window) => window.id === record.id);
		if (index < 0) { windows.push(record); continue; }
		// Older managed responses can carry real counts beside placeholder ratios.
		// Only a positively identified window with valid counts may replace its ratio.
		if (record.limit > 0 && record.used !== undefined && record.usedPercent !== null) {
			const modern = windows[index];
			const conflict = modern.usedPercent !== null && Math.abs(modern.usedPercent - record.usedPercent) > 0.01;
			const resetConflict = modern.resetAt && record.resetAt && modern.resetAt !== record.resetAt;
			windows[index] = { ...modern, ...record, ...(conflict || resetConflict ? { warning: "官方响应中的新旧窗口统计不一致，已按该窗口的原始已用/总量计算" } : {}) };
		}
	}
	return windows;
}

/** Historical TOKENS_LIMIT names can describe credits; never label them actual tokens. */
export function parseGlmUsage(body) {
	return (Array.isArray(body?.data?.limits) ? body.data.limits : []).flatMap((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return [];
		const unit = numeric(item.unit);
		const number = numeric(item.number);
		let id = `quota-${index}`;
		let label = item.type === "TIME_LIMIT" ? "每月工具调用额度" : "套餐额度";
		if (item.type !== "TIME_LIMIT" && unit === 3 && number === 5) { id = "5h"; label = "5 小时额度"; }
		else if (item.type !== "TIME_LIMIT" && unit === 6 && number === 1) { id = "7d"; label = "每周额度"; }
		const resetAt = resetTime(item.nextResetTime ?? item.resetTime);
		const detail = item.type === "TIME_LIMIT" ? counts({ limit: item.usage, used: item.currentValue }) : {};
		return [{ id, label, ...detail, ...(item.type === "TIME_LIMIT" ? { unit: "requests" } : {}), usedPercent: percent(item.percentage) ?? detail.usedPercent ?? null, ...(resetAt ? { resetAt } : {}) }];
	});
}

/** Keep provider decimal strings intact; binary floating point is not a money transport. */
function decimalAmount(value) {
	if (typeof value !== "string") return undefined;
	const amount = value.trim();
	return amount.length <= 128 && /^[+-]?\d+(?:\.\d+)?$/u.test(amount) ? amount : undefined;
}

/** Drop insignificant trailing zeros from a decimal string, keeping its exact value. */
function trimAmount(amount) {
	return amount.includes(".") ? amount.replace(/0+$/u, "").replace(/\.$/u, "") : amount;
}

/** Add two provider decimal strings without binary floating point. */
function addAmounts(left, right) {
	const decimals = (value) => { const [whole, fraction = ""] = value.split("."); return { whole, fraction }; };
	const a = decimals(left);
	const b = decimals(right);
	const scale = Math.max(a.fraction.length, b.fraction.length);
	const scaled = (value) => {
		const parts = decimals(value);
		const negative = parts.whole.startsWith("-");
		const digits = `${parts.whole.replace(/^[+-]/u, "")}${parts.fraction.padEnd(scale, "0")}`;
		return BigInt(`${negative ? "-" : ""}${digits}`);
	};
	const sum = scaled(left) + scaled(right);
	const negative = sum < 0n;
	const digits = (negative ? -sum : sum).toString().padStart(scale + 1, "0");
	const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
	return `${negative ? "-" : ""}${text}`;
}

/** DeepSeek reports account balances, without subscription usage windows or reset times. */
export function parseDeepSeekBalance(body) {
	if (typeof body?.is_available !== "boolean" || !Array.isArray(body.balance_infos) || body.balance_infos.length === 0) return undefined;
	const balances = [];
	const currencies = new Set();
	for (const info of body.balance_infos) {
		if (!info || !["CNY", "USD"].includes(info.currency) || currencies.has(info.currency)) return undefined;
		const total = decimalAmount(info.total_balance);
		const granted = decimalAmount(info.granted_balance);
		const toppedUp = decimalAmount(info.topped_up_balance);
		if (total === undefined || granted === undefined || toppedUp === undefined) return undefined;
		currencies.add(info.currency);
		balances.push({ currency: info.currency, total, granted, toppedUp });
	}
	return { isAvailable: body.is_available, balances };
}

/**
 * DeepSeek platform account wallets: normal (topped-up) plus bonus (granted)
 * money per currency. The total is the exact sum of both wallets.
 */
export function parseDeepSeekAccountBalance(body) {
	if (body?.data?.biz_code !== undefined && ![0, "0"].includes(body.data.biz_code)) return undefined;
	const data = [0, "0"].includes(body?.code) && body?.data?.biz_data !== undefined ? body.data.biz_data : body;
	if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
	if (!Array.isArray(data.normal_wallets) || !Array.isArray(data.bonus_wallets)) return undefined;
	const normal = data.normal_wallets;
	const bonus = data.bonus_wallets;
	if (normal.length === 0 && bonus.length === 0) return undefined;
	const byCurrency = new Map();
	for (const [field, list] of [["toppedUp", normal], ["granted", bonus]]) {
		for (const wallet of list) {
			if (!wallet || !["CNY", "USD"].includes(wallet.currency)) return undefined;
			const amount = decimalAmount(wallet.balance);
			if (amount === undefined) return undefined;
			const entry = byCurrency.get(wallet.currency) ?? { currency: wallet.currency, toppedUp: "0", granted: "0" };
			entry[field] = addAmounts(entry[field], amount);
			byCurrency.set(wallet.currency, entry);
		}
	}
	const balances = [...byCurrency.values()].map((entry) => ({
		currency: entry.currency,
		total: trimAmount(addAmounts(entry.toppedUp, entry.granted)),
		granted: trimAmount(entry.granted),
		toppedUp: trimAmount(entry.toppedUp)
	}));
	return balances.length === 0 ? undefined : { balances };
}

/**
 * ChatGPT subscription quota windows. Codex reports one or two rate-limit
 * windows with epoch-second resets and percentages already on a 0–100 scale.
 */
export function parseChatGptUsage(body, nowMs = Date.now()) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return [];
	const windows = [];
	const seen = new Set();
	const push = (value, name, feature) => {
		if (value === null || value === undefined) return;
		if (typeof value !== "object" || Array.isArray(value)) return;
		const used = numeric(value.used_percent);
		const seconds = numeric(value.limit_window_seconds);
		if (used === undefined || used > 100 || seconds === undefined || seconds <= 0) return;
		const after = numeric(value.reset_after_seconds);
		const relative = after === undefined ? NaN : nowMs + after * 1e3;
		const resetAt = resetEpoch(value.reset_at)
			?? (Number.isFinite(relative) && relative >= 0 && relative < 8.64e15 ? new Date(relative).toISOString() : undefined);
		const duration = seconds === 18_000 ? "5h" : seconds === 604_800 ? "7d" : `window-${Math.round(seconds)}s`;
		const id = feature === undefined ? duration : `additional-${feature}-${duration}`;
		const label = feature === undefined ? name : `${name || "Additional quota"} (${seconds === 18_000 ? "5h" : seconds === 604_800 ? "7d" : `${seconds}s`})`;
		if (seen.has(id)) return;
		seen.add(id);
		windows.push({ id, ...(label === undefined ? {} : { label }), usedPercent: Math.round(used * 100) / 100, ...(resetAt === undefined ? {} : { resetAt }) });
	};
	const rate = body.rate_limit && typeof body.rate_limit === "object" ? body.rate_limit : undefined;
	push(rate?.primary_window);
	push(rate?.secondary_window);
	for (const [index, entry] of (Array.isArray(body.additional_rate_limits) ? body.additional_rate_limits : []).entries()) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const name = typeof entry.limit_name === "string" && entry.limit_name.length > 0 ? entry.limit_name : undefined;
		const limit = entry.rate_limit;
		if (!limit || typeof limit !== "object") continue;
		push(limit.primary_window, name, index);
		push(limit.secondary_window, name, index);
	}
	return windows;
}

/** Plan and credit facts a subscription payload carries beside its windows. */
export function chatGptMeta(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return {};
	const plan = typeof body.plan_type === "string" && /^[a-z][a-z_]{0,31}$/u.test(body.plan_type) ? body.plan_type : undefined;
	let credits;
	const source = body.credits;
	if (source && typeof source === "object" && !Array.isArray(source) && typeof source.has_credits === "boolean") {
		if (source.has_credits === true) {
			const balance = decimalAmount(source.balance);
			credits = { unlimited: source.unlimited === true, ...(balance === undefined ? {} : { balance: trimAmount(balance) }) };
		}
	}
	return { ...(plan === undefined ? {} : { plan }), ...(credits === undefined ? {} : { credits }) };
}

class UsageFailure extends Error {
	constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}

function failureMessage(error, timedOut) {
	if (timedOut) return "请求超时，请稍后刷新";
	if (error?.kind === "authentication") return "认证失败，请检查模型设置中的凭据";
	if (error?.kind === "rate-limit") return "查询过于频繁，请稍后刷新";
	if (error?.kind === "http") return `官方服务暂不可用（HTTP ${error.status}）`;
	if (error?.kind === "business") return "官方接口返回查询失败，请检查账户状态";
	if (error?.kind === "invalid-response") return "官方接口返回的数据格式无法识别";
	return "网络请求失败，请稍后刷新";
}

async function readJson(response) {
	if (numeric(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
		await response.body?.cancel();
		throw new UsageFailure("invalid-response");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new UsageFailure("invalid-response");
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new UsageFailure("invalid-response"); }
			chunks.push(value);
		}
		const data = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
		return JSON.parse(new TextDecoder().decode(data));
	} catch (error) {
		if (error instanceof UsageFailure) throw error;
		if (error?.name === "SyntaxError") throw new UsageFailure("invalid-response");
		throw error;
	} finally { reader.releaseLock(); }
}

/** Claims of a JWT access token, without verifying it (the provider already issued it). */
function jwtClaims(token) {
	try {
		const payload = String(token).split(".")[1];
		if (typeof payload !== "string") return undefined;
		return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch { return undefined; }
}

/** The ChatGPT account id a subscription token acts for. */
function accountIdOf(credential) {
	if (typeof credential?.accountId === "string" && credential.accountId.length > 0) return credential.accountId;
	const claims = jwtClaims(credential?.access);
	const nested = claims?.["https://api.openai.com/auth"];
	return typeof nested?.chatgpt_account_id === "string" ? nested.chatgpt_account_id : undefined;
}

/**
 * Resolve one provider route's request credential.
 * @returns headers plus a cache identity, or undefined when nothing is configured.
 */
async function authorization(def, api) {
	const material = def.credentials;
	if (material === undefined) return undefined;
	if (material.kind === "ref") {
		const hit = await api.resolveCredential(material.ref);
		const key = typeof hit?.value === "string" ? hit.value.trim() : "";
		if (key.length === 0) return undefined;
		return { headers: material.header(key), identity: key };
	}
	if (material.kind === "grant") {
		const record = api.readRecord === undefined ? undefined : await api.readRecord(material.key);
		const payload = record?.kind === "grant" ? record.payload : undefined;
		const token = payload?.token;
		if (typeof token !== "string" || token.trim().length === 0 || payload.issuer !== "https://platform.deepseek.com") return undefined;
		return { headers: material.header(token), identity: token };
	}
	if (material.kind === "codex") {
		const record = api.readRecord === undefined ? undefined : await api.readRecord(material.accountsKey);
		const payload = record?.kind === "grant" ? record.payload : undefined;
		let credential;
		if (record !== undefined) {
			if (payload?.version !== 1 || !Array.isArray(payload.accounts) || typeof payload.activeId !== "string") return undefined;
			const active = payload.accounts.find((entry) => entry?.id === payload.activeId);
			if (typeof active?.credential?.access !== "string" || active.credential.access.trim().length === 0) return undefined;
			credential = active.credential;
		}
		if (credential === undefined) {
			const hit = await api.resolveCredential(material.ref);
			if (typeof hit?.value === "string") {
				try {
					const parsed = JSON.parse(hit.value);
					if (parsed && typeof parsed.access === "string") credential = parsed;
				} catch { /* malformed legacy record reads as missing */ }
			}
		}
		if (credential === undefined || credential.access.trim().length === 0) return undefined;
		const accountId = accountIdOf(credential);
		if (typeof accountId !== "string" || accountId.trim().length === 0 || /[\r\n]/u.test(accountId)) return undefined;
		return {
			headers: {
				Authorization: `Bearer ${credential.access}`,
				...(accountId === undefined ? {} : { "Chatgpt-Account-Id": accountId }),
				Originator: "pi",
				"User-Agent": USER_AGENT
			},
			identity: JSON.stringify([credential.access, accountId ?? ""])
		};
	}
	return undefined;
}

function definitions(config) {
	if (config === null || typeof config !== "object" || Array.isArray(config)) config = {};
	const glmRegion = config.glmRegion ?? "zai";
	const kimiRegion = config.kimiRegion ?? "cn";
	return [
		{ id: "glm", label: "GLM Coding Plan", kind: "subscription", url: glmRegion === "zai" ? "https://api.z.ai/api/monitor/usage/quota/limit" : glmRegion === "bigmodel" ? "https://open.bigmodel.cn/api/monitor/usage/quota/limit" : undefined, parse: parseGlmUsage, credentials: { kind: "ref", ref: config.glmCredentialRef ?? "ZAI_API_KEY", header: (key) => ({ Authorization: key }) }, missing: "请在模型设置中配置 ZAI_API_KEY" },
		{ id: "kimi", label: "Kimi Code", kind: "subscription", url: kimiRegion === "cn" ? "https://api.kimi.com/coding/v1/usages" : kimiRegion === "international" ? "https://api.kimi.ai/coding/v1/usages" : undefined, parse: parseKimiUsage, credentials: { kind: "ref", ref: config.kimiCredentialRef ?? "KIMI_CODING_API_KEY", header: (key) => ({ Authorization: `Bearer ${key}` }) }, missing: "请在模型设置中配置 KIMI_CODING_API_KEY" },
		{ id: "deepseek", label: "DeepSeek API", kind: "balance", url: "https://api.deepseek.com/user/balance", parse: parseDeepSeekBalance, credentials: { kind: "ref", ref: config.deepseekCredentialRef ?? "DEEPSEEK_API_KEY", header: (key) => ({ Authorization: `Bearer ${key}` }) }, missing: "请在模型设置中配置 DEEPSEEK_API_KEY" },
		{ id: "deepseek-account", label: "DeepSeek 账号", kind: "balance", scope: "account", url: "https://platform.deepseek.com/api/v0/users/get_user_summary", parse: parseDeepSeekAccountBalance, credentials: { kind: "grant", key: "deepseek-account-platform/default", header: (token) => ({ "X-Dsh-Auth-Token": token, "User-Agent": USER_AGENT }) }, missing: "请先在 Harness 中登录 DeepSeek 账号" },
		{ id: "chatgpt", label: "ChatGPT 订阅", kind: "subscription", url: "https://chatgpt.com/backend-api/wham/usage", parse: parseChatGptUsage, meta: chatGptMeta, credentials: { kind: "codex", ref: config.chatgptCredentialRef ?? "OPENAI_CODEX_SUBSCRIPTION_OAUTH", accountsKey: "codex-subscription/accounts" }, missing: "请先在模型设置中登录 ChatGPT 订阅" }
	];
}

/** Subscribers share work; cancelling one view must not cancel another view. */
function subscribe(flight, signal) {
	signal?.throwIfAborted();
	flight.subscribers += 1;
	let abort;
	return new Promise((resolve, reject) => {
		abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
		signal?.addEventListener("abort", abort, { once: true });
		flight.promise.then(resolve, reject);
	}).finally(() => {
		signal?.removeEventListener("abort", abort);
		flight.subscribers -= 1;
		if (flight.subscribers === 0 && !flight.settled) flight.controller.abort();
	});
}

/** Map a DSH model provider id to the usage source that can describe it. */
const PROVIDER_ALIASES = {
	zai: "glm",
	glm: "glm",
	bigmodel: "glm",
	"kimi-coding": "kimi",
	kimi: "kimi",
	deepseek: "deepseek",
	"deepseek-official": "deepseek",
	"deepseek-account": "deepseek-account",
	"openai-codex": "chatgpt",
	chatgpt: "chatgpt"
};

/**
 * Narrow the provider set to the one describing the selected model.
 * An absent selector keeps the full list (external consumers, tests).
 */
function selectProviders(states, provider) {
	if (typeof provider !== "string" || provider === "") return states;
	const id = PROVIDER_ALIASES[provider.toLowerCase()];
	if (id === undefined) return [];
	return states.filter((state) => state.definition.id === id);
}

export function createUsageService({ resolveCredential, readRecord, config = {}, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS }) {
	const providers = definitions(config).map((definition) => ({ definition, cache: null, flights: new Map() }));
	const api = { resolveCredential, readRecord };
	let disposed = false;
	async function one(state, { refresh, signal }) {
		signal?.throwIfAborted();
		const def = state.definition;
		const base = { id: def.id, label: def.label, kind: def.kind, ...(def.scope === undefined ? {} : { scope: def.scope }), fetchedAt: now(), ...(def.url ? { sourceUrl: def.url } : {}), windows: [] };
		if (!def.url || def.credentials === undefined || ["ref", "codex"].includes(def.credentials.kind) && (typeof def.credentials.ref !== "string" || !REF.test(def.credentials.ref))) return { ...base, status: "unsupported", message: "服务商区域或凭据引用配置无效" };
		let credential;
		try { credential = await authorization(def, api); }
		catch { return { ...base, status: "error", message: "无法读取模型凭据，请检查模型设置" }; }
		signal?.throwIfAborted();
		if (disposed) throw new Error("Usage service disposed");
		if (credential === undefined) return { ...base, status: "no-key", message: def.missing };
		const identity = createHash("sha256").update(def.url).update("\0").update(credential.identity).digest("hex");
		if (!refresh && state.cache?.identity === identity && now() - state.cache.at < ttlMs) return state.cache.value;
		let flight = state.flights.get(identity);
		if (!flight) {
			flight = { controller: new AbortController(), subscribers: 0, settled: false, promise: null };
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined = AbortSignal.any([flight.controller.signal, timeout]);
			flight.promise = (async () => {
				try {
					const response = await fetchImpl(def.url, { method: "GET", headers: { Accept: "application/json", ...credential.headers }, redirect: "error", signal: combined });
					if (!response.ok) {
						await response.body?.cancel();
						if (response.status === 401 || response.status === 403) throw new UsageFailure("authentication");
						if (response.status === 429) throw new UsageFailure("rate-limit");
						if (response.status === 404) return { ...base, fetchedAt: now(), status: "unsupported", message: "官方接口暂不支持此账户或查询" };
						throw new UsageFailure("http", response.status);
					}
					const body = await readJson(response);
					if (body?.success === false || (body?.code !== undefined && ![0, 200, "0", "200"].includes(body.code)) || (body?.data?.biz_code !== undefined && ![0, "0"].includes(body.data.biz_code)) || body?.error) throw new UsageFailure("business");
					const meta = typeof def.meta === "function" ? def.meta(body) : {};
					if (def.kind === "balance") {
						const balance = def.parse(body);
						return balance === undefined
							? { ...base, fetchedAt: now(), status: "unsupported", message: "官方接口未提供可识别的余额" }
							: { ...base, fetchedAt: now(), status: "ok", ...balance };
					}
					const windows = def.parse(body);
					return { ...base, fetchedAt: now(), status: windows.length ? "ok" : "unsupported", ...(windows.length ? {} : { message: "官方接口未提供可识别的套餐额度" }), ...meta, windows };
				} catch (error) {
					return { ...base, fetchedAt: now(), status: "error", message: failureMessage(error, timeout.aborted) };
				}
			})().then((value) => {
				if (!disposed && !combined.aborted && (value.status === "ok" || value.status === "unsupported")) state.cache = { identity, at: now(), value };
				return value;
			}).finally(() => { flight.settled = true; state.flights.delete(identity); });
			state.flights.set(identity, flight);
		}
		return subscribe(flight, signal);
	}
	return {
		async snapshot({ refresh = false, signal, provider } = {}) {
			if (disposed) throw new Error("Usage service disposed");
			const selected = selectProviders(providers, provider);
			const value = { providers: await Promise.all(selected.map((state) => one(state, { refresh, signal }))) };
			if (typeof provider === "string" && provider !== "" && selected.length === 0) value.unsupportedProvider = provider;
			return value;
		},
		dispose() {
			disposed = true;
			for (const state of providers) {
				state.cache = null;
				for (const flight of state.flights.values()) flight.controller.abort();
			}
		}
	};
}
