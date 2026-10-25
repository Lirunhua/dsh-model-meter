import { createHash } from "node:crypto";

const TTL_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REF = /^[A-Za-z_][A-Za-z0-9_]*$/u;

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

class UsageFailure extends Error {
	constructor(kind, status) { super(kind); this.kind = kind; this.status = status; }
}

function failureMessage(error, timedOut) {
	if (timedOut) return "请求超时，请稍后刷新";
	if (error?.kind === "authentication") return "认证失败，请检查模型设置中的 API Key";
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

function definitions(config) {
	if (config === null || typeof config !== "object" || Array.isArray(config)) config = {};
	const glmRegion = config.glmRegion ?? "zai";
	const kimiRegion = config.kimiRegion ?? "cn";
	return [
		{ id: "glm", label: "GLM Coding Plan", kind: "subscription", ref: config.glmCredentialRef ?? "ZAI_API_KEY", url: glmRegion === "zai" ? "https://api.z.ai/api/monitor/usage/quota/limit" : glmRegion === "bigmodel" ? "https://open.bigmodel.cn/api/monitor/usage/quota/limit" : undefined, parse: parseGlmUsage, bearer: false },
		{ id: "kimi", label: "Kimi Code", kind: "subscription", ref: config.kimiCredentialRef ?? "KIMI_CODING_API_KEY", url: kimiRegion === "cn" ? "https://api.kimi.com/coding/v1/usages" : kimiRegion === "international" ? "https://api.kimi.ai/coding/v1/usages" : undefined, parse: parseKimiUsage, bearer: true },
		{ id: "deepseek", label: "DeepSeek API", kind: "balance", ref: config.deepseekCredentialRef ?? "DEEPSEEK_API_KEY", url: "https://api.deepseek.com/user/balance", parse: parseDeepSeekBalance, bearer: true }
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

export function createUsageService({ resolveCredential, config = {}, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = TIMEOUT_MS, ttlMs = TTL_MS }) {
	const providers = definitions(config).map((definition) => ({ definition, cache: null, flights: new Map() }));
	let disposed = false;
	async function one(state, { refresh, signal }) {
		signal?.throwIfAborted();
		const def = state.definition;
		const base = { id: def.id, label: def.label, kind: def.kind, fetchedAt: now(), ...(def.url ? { sourceUrl: def.url } : {}), windows: [] };
		if (!def.url || typeof def.ref !== "string" || !REF.test(def.ref)) return { ...base, status: "unsupported", message: "服务商区域或凭据引用配置无效" };
		let hit;
		try { hit = await resolveCredential(def.ref); }
		catch { return { ...base, status: "error", message: "无法读取模型凭据，请检查模型设置" }; }
		signal?.throwIfAborted();
		if (disposed) throw new Error("Usage service disposed");
		const key = typeof hit?.value === "string" ? hit.value.trim() : "";
		if (!key) return { ...base, status: "no-key", message: `请在模型设置中配置 ${def.ref}` };
		const identity = createHash("sha256").update(def.url).update("\0").update(key).digest("hex");
		if (!refresh && state.cache?.identity === identity && now() - state.cache.at < ttlMs) return state.cache.value;
		let flight = state.flights.get(identity);
		if (!flight) {
			flight = { controller: new AbortController(), subscribers: 0, settled: false, promise: null };
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined = AbortSignal.any([flight.controller.signal, timeout]);
			flight.promise = (async () => {
				try {
					const response = await fetchImpl(def.url, { method: "GET", headers: { Authorization: def.bearer ? `Bearer ${key}` : key, Accept: "application/json" }, redirect: "error", signal: combined });
					if (!response.ok) {
						await response.body?.cancel();
						if (response.status === 401 || response.status === 403) throw new UsageFailure("authentication");
						if (response.status === 429) throw new UsageFailure("rate-limit");
						if (response.status === 404) return { ...base, fetchedAt: now(), status: "unsupported", message: "官方接口暂不支持此账户或查询" };
						throw new UsageFailure("http", response.status);
					}
					const body = await readJson(response);
					if (body?.success === false || (body?.code !== undefined && ![0, 200, "0", "200"].includes(body.code)) || body?.error) throw new UsageFailure("business");
					if (def.kind === "balance") {
						const balance = def.parse(body);
						return balance === undefined
							? { ...base, fetchedAt: now(), status: "unsupported", message: "官方接口未提供可识别的 API 余额" }
							: { ...base, fetchedAt: now(), status: "ok", ...balance };
					}
					const windows = def.parse(body);
					return { ...base, fetchedAt: now(), status: windows.length ? "ok" : "unsupported", ...(windows.length ? {} : { message: "官方接口未提供可识别的 Coding Plan 额度" }), windows };
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
		async snapshot({ refresh = false, signal } = {}) {
			if (disposed) throw new Error("Usage service disposed");
			return { providers: await Promise.all(providers.map((state) => one(state, { refresh, signal }))) };
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
