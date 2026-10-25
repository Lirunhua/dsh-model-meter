import assert from "node:assert/strict";
import { setImmediate as immediate, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createUsageService, parseGlmUsage, parseKimiUsage, parseDeepSeekBalance, parseDeepSeekAccountBalance, parseChatGptUsage, chatGptMeta } from "../lib/providers.js";
import * as host from "../lib/index.js";

const KEYS = { ZAI_API_KEY: "fake-glm-key", KIMI_CODING_API_KEY: "fake-kimi-key", DEEPSEEK_API_KEY: "fake-deepseek-key" };
const GLM = { code: 200, success: true, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 38, nextResetTime: 1792936800000 }] } };
const KIMI = { usages: { limit_5h: { used_ratio: "0.35", reset_time: "2026-10-25T14:00:00Z" }, limit_7d: { used_ratio: 0.2 } } };
const DEEPSEEK = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] };
const PLATFORM = { code: 0, msg: "", data: { biz_code: 0, biz_msg: "", biz_data: { normal_wallets: [{ currency: "CNY", balance: "120.0000000000000000" }], bonus_wallets: [{ currency: "CNY", balance: "3.4567890100000000" }] } } };
const CHATGPT = {
	plan_type: "pro",
	rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 33, limit_window_seconds: 604800, reset_at: 1793513431 }, secondary_window: null },
	credits: { has_credits: true, unlimited: false, balance: "100.0000000000" }
};
const RECORDS = {
	"deepseek-account-platform/default": { kind: "grant", payload: { version: 1, token: "fake-platform-token", issuer: "https://platform.deepseek.com" } },
	"codex-subscription/accounts": { kind: "grant", payload: { version: 1, activeId: "acct-1", accounts: [{ id: "acct-1", credential: { type: "oauth", access: "fake-codex-token", accountId: "fake-chatgpt-account" } }] } }
};
const ALL_URLS = [
	"https://api.z.ai/api/monitor/usage/quota/limit",
	"https://api.kimi.com/coding/v1/usages",
	"https://api.deepseek.com/user/balance",
	"https://platform.deepseek.com/api/v0/users/get_user_summary",
	"https://chatgpt.com/backend-api/wham/usage"
];
const responseFor = (url) => Response.json(
	url.includes("chatgpt.com") ? CHATGPT
		: url.includes("platform.deepseek.com") ? PLATFORM
			: url.includes("deepseek.com") ? DEEPSEEK
				: url.includes("z.ai") || url.includes("bigmodel.cn") ? GLM : KIMI);
const credentials = async (ref) => ({ value: KEYS[ref] });
const readRecords = (records) => async (key) => records[key];
const makeService = (options = {}) => createUsageService({ resolveCredential: credentials, readRecord: readRecords(RECORDS), fetchImpl: async (url) => responseFor(url), ...options });

test("Kimi snake_case ratios retain 0, scale 0..1 to used percentages, and do not invent missing data", () => {
	const windows = parseKimiUsage({ usages: {
		limit_5h: { used_ratio: 0, reset_time: "2026-10-25T22:00:00+08:00" },
		limit_7d: { used_ratio: "0.6725" },
		limit_month_total: { used_ratio: "" },
		limit_month_code: { used_ratio: 20, reset_time: "invalid" }
	} });
	assert.deepEqual(windows.map((value) => [value.id, value.usedPercent]), [["5h", 0], ["7d", 67.25], ["month-total", null], ["month-code", null]]);
	assert.equal(windows[0].resetAt, "2026-10-25T14:00:00.000Z");
	assert.equal(windows[3].resetAt, undefined);
	assert.deepEqual(parseKimiUsage({}), []);
	assert.deepEqual(parseKimiUsage({ usage: [], limits: [{ detail: [] }] }), []);
});

test("legacy Kimi usage/limits support used or remaining without assigning undocumented units", () => {
	const windows = parseKimiUsage({ usage: { limit: 100, remaining: 60, resetTime: "2026-10-27T00:00:00Z" }, limits: [
		{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: 80, used: 20 } },
		{ window: { duration: 168, timeUnit: "HOUR" }, detail: { limit: 100, used: 10 } }
	] });
	assert.deepEqual(windows.map((value) => [value.id, value.usedPercent, value.remaining]), [["7d", 40, 60], ["5h", 25, 60]]);
	assert.equal(windows[0].unit, undefined);
	assert.equal(parseKimiUsage({ usage: { limit: 0, used: 0 } })[0].usedPercent, null);
});

test("hybrid Kimi responses prefer valid same-window counts and flag conflicting ratios", () => {
	const windows = parseKimiUsage({
		usages: { limit_5h: { used_ratio: 0.2 }, limit_7d: { used_ratio: 0 }, limit_month_total: { used_ratio: 0.1 } },
		usage: { limit: 100, used: 80 },
		limits: [
			{ window: { duration: 300, timeUnit: "MINUTE" }, detail: { limit: 100, remaining: 40 } },
			{ window: { duration: 12, timeUnit: "HOUR" }, detail: { limit: 100, used: 95 } }
		]
	});
	assert.deepEqual(windows.map((value) => [value.id, value.usedPercent]), [["5h", 60], ["7d", 80], ["month-total", 10], ["window-1", 95]]);
	assert.ok(windows[0].warning && windows[1].warning);
	assert.equal(windows[2].warning, undefined);
	const incomplete = parseKimiUsage({ usages: { limit_7d: { used_ratio: 0 } }, usage: { limit: 100 } });
	assert.equal(incomplete[0].usedPercent, 0);
	assert.equal(incomplete[0].warning, undefined);
});

test("GLM plan credits, optional reset epochs and monthly tool counts are distinct", () => {
	const windows = parseGlmUsage({ data: { limits: [
		{ type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: "12.5", nextResetTime: 1792936800000 },
		{ type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 0 },
		{ type: "TIME_LIMIT", percentage: 25, currentValue: 25, usage: 100 },
		{ type: "FUTURE_LIMIT", percentage: null, nextResetTime: 1792936800 }
	] } });
	assert.deepEqual(windows.map((value) => [value.id, value.usedPercent]), [["5h", 12.5], ["7d", 0], ["quota-2", 25], ["quota-3", null]]);
	assert.equal(windows[0].unit, undefined);
	assert.ok(windows[0].resetAt.endsWith("Z"));
	assert.equal(windows[3].resetAt, undefined);
	assert.deepEqual([windows[2].used, windows[2].limit, windows[2].remaining, windows[2].unit], [25, 100, 75, "requests"]);
	assert.deepEqual(parseGlmUsage({ data: { limits: [null, []] } }), []);
});

test("DeepSeek preserves precise decimal amounts, negative balances and separate currencies", () => {
	const parsed = parseDeepSeekBalance({ is_available: true, balance_infos: [
		{ currency: "CNY", total_balance: "9007199254740993.123456789", granted_balance: "0.000000001", topped_up_balance: "9007199254740993.123456788" },
		{ currency: "USD", total_balance: "-0.00123456789", granted_balance: "0.00", topped_up_balance: "-0.00123456789" }
	] });
	assert.deepEqual(parsed, { isAvailable: true, balances: [
		{ currency: "CNY", total: "9007199254740993.123456789", granted: "0.000000001", toppedUp: "9007199254740993.123456788" },
		{ currency: "USD", total: "-0.00123456789", granted: "0.00", toppedUp: "-0.00123456789" }
	] });
	assert.equal(parsed.usedPercent, undefined);
	assert.equal(parsed.resetAt, undefined);
});

test("DeepSeek rejects missing or malformed balances rather than fabricating zero", () => {
	const entry = DEEPSEEK.balance_infos[0];
	for (const body of [
		{}, { is_available: false, balance_infos: [] }, { balance_infos: [entry] },
		{ is_available: "false", balance_infos: [entry] },
		...[
			{ ...entry, total_balance: undefined }, { ...entry, total_balance: null },
			{ ...entry, total_balance: "" }, { ...entry, total_balance: "NaN" },
			{ ...entry, total_balance: "Infinity" }, { ...entry, total_balance: "1e3" },
			{ ...entry, total_balance: 110 }, { ...entry, currency: "EUR" },
			{ ...entry, granted_balance: "not-money" }
		].map((bad) => ({ is_available: true, balance_infos: [entry, bad] })),
		{ is_available: true, balance_infos: [entry, entry] }
	]) assert.equal(parseDeepSeekBalance(body), undefined);
});

test("ChatGPT subscription windows map epoch-second resets and keep plan and credits beside them", () => {
	const windows = parseChatGptUsage({ rate_limit: {
		primary_window: { used_percent: 33, limit_window_seconds: 604800, reset_at: 1793513431 },
		secondary_window: { used_percent: 120, limit_window_seconds: 18000 }
	} }, 1_700_000_000_000);
	assert.deepEqual(windows.map((value) => [value.id, value.usedPercent]), [["7d", 33]]);
	assert.equal(windows[0].resetAt, new Date(1793513431 * 1000).toISOString());
	const five = parseChatGptUsage({ rate_limit: { secondary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 600 } } }, 1_700_000_000_000);
	assert.deepEqual(five.map((value) => [value.id, value.usedPercent]), [["5h", 10]]);
	assert.equal(five[0].resetAt, new Date(1_700_000_000_000 + 600_000).toISOString());
	const extra = parseChatGptUsage({ additional_rate_limits: [{ limit_name: "Code review", metered_feature: "code_review", rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 3600 } } }] });
	assert.deepEqual(extra.map((value) => [value.id, value.label, value.usedPercent]), [["additional-0-window-3600s", "Code review (3600s)", 5]]);
	assert.deepEqual(parseChatGptUsage({ rate_limit: { primary_window: { used_percent: "x", limit_window_seconds: 0 } } }), []);
	assert.deepEqual(chatGptMeta({ plan_type: "pro", credits: { has_credits: true, unlimited: false, balance: "100.0000000000" } }), { plan: "pro", credits: { unlimited: false, balance: "100" } });
	assert.deepEqual(chatGptMeta({ credits: { has_credits: false, unlimited: false } }), {});
});

test("DeepSeek account wallets sum normal and bonus money per currency exactly", () => {
	assert.deepEqual(parseDeepSeekAccountBalance(PLATFORM), { balances: [
		{ currency: "CNY", total: "123.45678901", granted: "3.45678901", toppedUp: "120" }
	] });
	assert.deepEqual(parseDeepSeekAccountBalance({ data: { biz_data: { normal_wallets: [], bonus_wallets: [] } } }), undefined);
	assert.equal(parseDeepSeekAccountBalance({ code: 0, data: { biz_data: { normal_wallets: [{ currency: "EUR", balance: "1" }] } } }), undefined);
	assert.equal(parseDeepSeekAccountBalance({ code: 0, data: { biz_data: { normal_wallets: [{ currency: "USD", balance: "NaN" }] } } }), undefined);
});

test("a DeepSeek account with zero funds is a successful balance query, not an auth or subscription error", async () => {
	const service = makeService({ fetchImpl: async (url) => url === "https://api.deepseek.com/user/balance" ? Response.json({ is_available: false, balance_infos: [
		{ currency: "CNY", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" }
	] }) : responseFor(url) });
	const result = await service.snapshot();
	const deepseek = result.providers.find((provider) => provider.id === "deepseek");
	assert.equal(deepseek.status, "ok");
	assert.equal(deepseek.kind, "balance");
	assert.equal(deepseek.isAvailable, false);
	assert.deepEqual(deepseek.balances, [{ currency: "CNY", total: "0.00", granted: "0.00", toppedUp: "0.00" }]);
	assert.deepEqual(deepseek.windows, []);
	assert.ok(result.providers.filter((provider) => provider.id !== "deepseek").every((provider) => provider.status === "ok"));
	service.dispose();
});

test("missing DeepSeek credentials skip its network request while Kimi and GLM remain available", async () => {
	const urls = [];
	const service = makeService({ resolveCredential: async (ref) => ref === "DEEPSEEK_API_KEY" ? undefined : credentials(ref), fetchImpl: async (url) => { urls.push(url); return responseFor(url); } });
	const { providers } = await service.snapshot();
	assert.equal(providers.find((provider) => provider.id === "deepseek").status, "no-key");
	assert.ok(providers.filter((provider) => provider.id !== "deepseek").every((provider) => provider.status === "ok"));
	assert.equal(urls.length, 4);
	assert.ok(!urls.includes("https://api.deepseek.com/user/balance"));
	service.dispose();
});

test("DeepSeek auth and schema failures are isolated and never expose remote bodies or credentials", async () => {
	for (const [response, expectedStatus] of [
		[new Response(`SECRET ${KEYS.DEEPSEEK_API_KEY}`, { status: 401 }), "error"],
		[Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "unknown" }] }), "unsupported"]
	]) {
		const service = makeService({ fetchImpl: async (url) => url === "https://api.deepseek.com/user/balance" ? response : responseFor(url) });
		const { providers } = await service.snapshot();
		assert.equal(providers.find((provider) => provider.id === "deepseek").status, expectedStatus);
		assert.ok(providers.filter((provider) => provider.id !== "deepseek").every((provider) => provider.status === "ok"));
		assert.ok(!/SECRET|fake-deepseek-key/u.test(JSON.stringify(providers)));
		service.dispose();
	}
});

test("DeepSeek custom credential references and account replacement invalidate only its balance cache", async () => {
	let deepseekKey = "fake-deepseek-first";
	const calls = [];
	const service = makeService({ config: { deepseekCredentialRef: "CUSTOM_DEEPSEEK_KEY" }, resolveCredential: async (ref) => ref === "CUSTOM_DEEPSEEK_KEY" ? { value: deepseekKey } : credentials(ref), fetchImpl: async (url, options) => { calls.push({ url, auth: options.headers.Authorization }); return responseFor(url); } });
	await service.snapshot();
	await service.snapshot();
	assert.equal(calls.length, 5);
	assert.equal(calls.find((call) => call.url === "https://api.deepseek.com/user/balance").auth, "Bearer fake-deepseek-first");
	deepseekKey = "fake-deepseek-replacement";
	await service.snapshot();
	assert.equal(calls.length, 6);
	const balance = calls.filter((call) => call.url === "https://api.deepseek.com/user/balance").at(-1);
	assert.equal(balance.auth, "Bearer fake-deepseek-replacement");
	service.dispose();
});

test("fixed endpoints and provider-specific authorization never probe another region", async () => {
	const calls = [];
	const service = makeService({ fetchImpl: async (url, options) => { calls.push({ url, options }); return responseFor(url); } });
	const result = await service.snapshot();
	assert.deepEqual(result.providers.map((value) => [value.id, value.kind, value.status]), [
		["glm", "subscription", "ok"], ["kimi", "subscription", "ok"], ["deepseek", "balance", "ok"],
		["deepseek-account", "balance", "ok"], ["chatgpt", "subscription", "ok"]
	]);
	assert.deepEqual(calls.map((call) => call.url), ALL_URLS);
	assert.equal(calls[0].options.headers.Authorization, KEYS.ZAI_API_KEY);
	assert.equal(calls[1].options.headers.Authorization, `Bearer ${KEYS.KIMI_CODING_API_KEY}`);
	assert.equal(calls[2].options.headers.Authorization, `Bearer ${KEYS.DEEPSEEK_API_KEY}`);
	assert.equal(calls[3].options.headers["X-Dsh-Auth-Token"], "fake-platform-token");
	assert.equal(calls[4].options.headers.Authorization, "Bearer fake-codex-token");
	assert.equal(calls[4].options.headers["Chatgpt-Account-Id"], "fake-chatgpt-account");
	assert.ok(calls.every((call) => call.options.redirect === "error" && call.options.headers.Accept === "application/json"));
	assert.ok(!JSON.stringify(result).includes("fake-"));
	service.dispose();
});

test("explicit region changes select one official origin; invalid regions send no request or key", async () => {
	const calls = [];
	const service = makeService({ config: { glmRegion: "bigmodel", kimiRegion: "international" }, fetchImpl: async (url) => { calls.push(url); return responseFor(url); } });
	await service.snapshot();
	assert.deepEqual(calls, ["https://open.bigmodel.cn/api/monitor/usage/quota/limit", "https://api.kimi.ai/coding/v1/usages", "https://api.deepseek.com/user/balance", "https://platform.deepseek.com/api/v0/users/get_user_summary", "https://chatgpt.com/backend-api/wham/usage"]);
	service.dispose();
	const invalid = makeService({ config: { glmRegion: "toString", kimiRegion: "https://example.com", deepseekCredentialRef: "invalid-ref" }, readRecord: async () => undefined, resolveCredential: async () => undefined, fetchImpl() { throw new Error("must not send request"); } });
	const invalidProviders = (await invalid.snapshot()).providers;
	assert.deepEqual(invalidProviders.map((value) => [value.id, value.status]), [
		["glm", "unsupported"], ["kimi", "unsupported"], ["deepseek", "unsupported"],
		["deepseek-account", "no-key"], ["chatgpt", "no-key"]
	]);
	invalid.dispose();
});

test("missing credentials produce no-key cards without network requests", async () => {
	let calls = 0;
	const service = makeService({ resolveCredential: async () => undefined, readRecord: async () => undefined, fetchImpl: async () => { calls++; throw new Error("unexpected network"); } });
	assert.ok((await service.snapshot()).providers.every((value) => value.status === "no-key" && value.windows.length === 0));
	assert.equal(calls, 0);
	service.dispose();
});

test("TTL caching, manual refresh and credential replacement cannot reuse the old account snapshot", async () => {
	let clock = 1_000_000;
	let calls = 0;
	let glmKey = "first-fake-key";
	const service = makeService({ now: () => clock, ttlMs: 100, resolveCredential: async (ref) => ({ value: ref === "ZAI_API_KEY" ? glmKey : KEYS[ref] }), fetchImpl: async (url) => { calls++; return responseFor(url); } });
	await service.snapshot(); await service.snapshot();
	assert.equal(calls, 5);
	await service.snapshot({ refresh: true });
	assert.equal(calls, 10);
	clock += 101;
	await service.snapshot();
	assert.equal(calls, 15);
	glmKey = "replacement-fake-key";
	await service.snapshot();
	assert.equal(calls, 16);
	service.dispose();
});

function deferredFetch() {
	const calls = [];
	return { calls, fetchImpl: (url, options) => new Promise((resolve, reject) => {
		const call = { url, signal: options.signal, finish: () => resolve(responseFor(url)) };
		calls.push(call);
		options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
	}) };
}
async function ready(calls, count = 5) {
	for (let index = 0; calls.length < count && index < 20; index++) await immediate();
	assert.equal(calls.length, count);
}

test("concurrent subscribers share requests; aborting one preserves the other subscriber", async () => {
	const deferred = deferredFetch();
	const service = makeService({ fetchImpl: deferred.fetchImpl });
	const controller = new AbortController();
	const first = service.snapshot({ signal: controller.signal });
	const second = service.snapshot({ refresh: true });
	await ready(deferred.calls);
	controller.abort();
	await assert.rejects(first, { name: "AbortError" });
	assert.ok(deferred.calls.every((call) => !call.signal.aborted));
	deferred.calls.forEach((call) => call.finish());
	assert.ok((await second).providers.every((value) => value.status === "ok"));
	assert.equal(deferred.calls.length, 5);
	service.dispose();
});

test("cancelling every subscriber stops every provider request and does not cache cancelled work", async () => {
	const deferred = deferredFetch();
	const service = makeService({ fetchImpl: deferred.fetchImpl });
	const controller = new AbortController();
	const task = service.snapshot({ signal: controller.signal });
	await ready(deferred.calls);
	controller.abort();
	await assert.rejects(task, { name: "AbortError" });
	assert.ok(deferred.calls.every((call) => call.signal.aborted));
	await immediate();
	const retry = service.snapshot();
	await ready(deferred.calls, 10);
	deferred.calls.slice(5).forEach((call) => call.finish());
	assert.ok((await retry).providers.every((value) => value.status === "ok"));
	service.dispose();
});

test("timeouts become safe errors without exposing remote exception text or keys", async () => {
	const deferred = deferredFetch();
	const service = makeService({ fetchImpl: deferred.fetchImpl, timeoutMs: 20 });
	const task = service.snapshot();
	await delay(40);
	const result = await task;
	assert.ok(result.providers.every((value) => value.status === "error" && value.message.includes("超时")));
	assert.ok(!JSON.stringify(result).includes("fake-"));
	service.dispose();
});

test("business failures, HTTP errors, malformed JSON, redirects and unknown schemas stay distinct and sanitized", async () => {
	for (const [factory, status, message] of [
		[() => Response.json({ code: 500, msg: "fake-glm-key SECRET" }), "error", "账户状态"],
		[() => new Response("fake-key SECRET", { status: 401 }), "error", "认证"],
		[() => new Response("fake-key SECRET", { status: 429 }), "error", "频繁"],
		[() => new Response("fake-key SECRET", { status: 404 }), "unsupported", "暂不支持"],
		[() => new Response("not-json SECRET"), "error", "格式"],
		[() => Response.json({ unexpected: true }), "unsupported", "未提供"],
		[() => { throw new TypeError("redirect failed: fake-key SECRET"); }, "error", "网络"],
		[() => new Response("SECRET", { headers: { "content-length": "2000000" } }), "error", "格式"]
	]) {
		const service = makeService({ fetchImpl: async () => factory() });
		const result = await service.snapshot();
		assert.ok(result.providers.every((value) => value.status === status && value.message.includes(message)));
		assert.ok(!/SECRET|fake-key|fake-glm-key/u.test(JSON.stringify(result)));
		service.dispose();
	}
});

test("real Cordis mounts after dependencies arrive and disposes its exact RPC route", async () => {
	let Context;
	try { ({ Context } = await import("@deepseek-ai/cordis")); }
	catch (error) {
		if (!process.env.DSH_CORDIS_MODULE) throw new Error("Install development dependencies with npm ci before running host lifecycle tests", { cause: error });
		({ Context } = await import(process.env.DSH_CORDIS_MODULE));
	}
	assert.deepEqual(host.inject, ["connection", "credentials"]);
	assert.equal(host.name, "dsh-model-meter");
	const ctx = new Context();
	let route;
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (url) => responseFor(url);
	try {
		const fiber = ctx.plugin(host);
		await immediate();
		assert.equal(route, undefined);
		ctx.provide("credentials", { resolve: credentials, readRecord: readRecords(RECORDS) });
		ctx.provide("connection", { fetch: { register(value) { route = value; return () => { route = undefined; }; } } });
		await fiber;
		assert.equal(route.path, "/api/usage-panel/balances");
		const request = (body, contentType = "application/json") => new Request("http://localhost/api/usage-panel/balances", { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) });
		const envelope = { type: "client-request", rpcId: "offline-test", method: "usage-panel/balances", payload: {} };
		const response = await route.fetch(request(envelope));
		assert.equal(response.headers.get("cache-control"), "no-store");
		const result = await response.json();
		assert.equal(result.rpcId, envelope.rpcId);
		assert.ok(result.result.ok);
		assert.ok(result.result.value.providers.every((value) => value.status === "ok"));
		const narrowed = await (await route.fetch(request({ ...envelope, payload: { provider: "zai" } }))).json();
		assert.deepEqual(narrowed.result.value.providers.map((value) => value.id), ["glm"]);
		const unknown = await (await route.fetch(request({ ...envelope, payload: { provider: "openai" } }))).json();
		assert.deepEqual(unknown.result.value.providers, []);
		assert.equal(unknown.result.value.unsupportedProvider, "openai");
		assert.equal((await route.fetch(request({ ...envelope, method: "wrong" }))).status, 400);
		assert.equal((await route.fetch(request(envelope, "text/plain"))).status, 415);
		await fiber.dispose();
		assert.equal(route, undefined);
	} finally {
		globalThis.fetch = previousFetch;
		await ctx.fiber.dispose();
	}
});

test("a selected model provider narrows the query to its own usage source", async () => {
	const urls = [];
	const service = makeService({ fetchImpl: async (url) => { urls.push(url); return responseFor(url); } });
	const kimi = await service.snapshot({ provider: "kimi-coding" });
	assert.deepEqual(kimi.providers.map((value) => value.id), ["kimi"]);
	assert.equal(urls.length, 1);
	assert.match(urls[0], /kimi\.com/u);
	const glm = await service.snapshot({ provider: "zai" });
	assert.deepEqual(glm.providers.map((value) => value.id), ["glm"]);
	assert.equal(urls.length, 2);
	const deepseek = await service.snapshot({ provider: "deepseek-account" });
	assert.deepEqual(deepseek.providers.map((value) => value.id), ["deepseek-account"]);
	assert.equal(deepseek.unsupportedProvider, undefined);
	assert.equal(urls.length, 3);
	const chatgpt = await service.snapshot({ provider: "openai-codex" });
	assert.deepEqual(chatgpt.providers.map((value) => value.id), ["chatgpt"]);
	assert.match(urls[3], /chatgpt\.com/u);
	assert.equal(urls.length, 4);
	service.dispose();
});

test("an unknown model provider returns no accounts and names the unsupported provider", async () => {
	const urls = [];
	const service = makeService({ fetchImpl: async (url) => { urls.push(url); return responseFor(url); } });
	const result = await service.snapshot({ provider: "openai" });
	assert.deepEqual(result.providers, []);
	assert.equal(result.unsupportedProvider, "openai");
	assert.equal(urls.length, 0);
	service.dispose();
});

test("ChatGPT feature limits with matching durations remain independent and oversized reset offsets stay unknown", () => {
	const windows = parseChatGptUsage({
		rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 } },
		additional_rate_limits: [{ limit_name: "Code review", rate_limit: {
			primary_window: { used_percent: 20, limit_window_seconds: 18000 },
			secondary_window: { used_percent: 30, limit_window_seconds: 604800, reset_after_seconds: 1e300 }
		} }]
	});
	assert.deepEqual(windows.map((window) => window.usedPercent), [10, 20, 30]);
	assert.equal(new Set(windows.map((window) => window.id)).size, 3);
	assert.match(windows[1].label, /Code review.*5h/u);
	assert.match(windows[2].label, /Code review.*7d/u);
	assert.equal(windows[2].resetAt, undefined);
});

test("malformed or failed account wallet responses cannot produce partial or zero balances", () => {
	for (const body of [
		{ normal_wallets: {}, bonus_wallets: [{ currency: "CNY", balance: "10" }] },
		{ normal_wallets: [{ currency: "CNY", balance: "10" }] },
		{ code: 0, data: { biz_code: 1, biz_data: PLATFORM.data.biz_data } }
	]) assert.equal(parseDeepSeekAccountBalance(body), undefined);
});

test("ChatGPT cache identity includes the selected account even when its access token is shared", async () => {
	let accountId = "fake-workspace-a";
	const headers = [];
	const service = makeService({ readRecord: async (key) => key === "codex-subscription/accounts" ? {
		kind: "grant", payload: { version: 1, activeId: "active", accounts: [{ id: "active", credential: { access: "fake-shared-token", accountId } }] }
	} : undefined, fetchImpl: async (url, options) => { headers.push(options.headers); return responseFor(url); } });
	await service.snapshot({ provider: "openai-codex" });
	await service.snapshot({ provider: "openai-codex" });
	assert.equal(headers.length, 1);
	accountId = "fake-workspace-b";
	const result = await service.snapshot({ provider: "openai-codex" });
	assert.equal(headers.length, 2);
	assert.deepEqual(headers.map((header) => header["Chatgpt-Account-Id"]), ["fake-workspace-a", "fake-workspace-b"]);
	assert.ok(!JSON.stringify(result).includes("fake-"));
	service.dispose();
});

test("a missing active ChatGPT account never falls back to another stored or legacy account", async () => {
	const service = makeService({ readRecord: async () => ({ kind: "grant", payload: {
		version: 1, activeId: "missing", accounts: [{ id: "other", credential: { access: "fake-other-token", accountId: "fake-other-account" } }]
	} }), resolveCredential() { throw new Error("legacy fallback must not run"); }, fetchImpl() { throw new Error("must not query another account"); } });
	const { providers } = await service.snapshot({ provider: "openai-codex" });
	assert.equal(providers[0].status, "no-key");
	service.dispose();
});

test("legacy ChatGPT JSON credentials derive their account id from JWT claims without exposing credentials", async () => {
	const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fake-legacy-account" } })).toString("base64url");
	const token = `fake.${payload}.unsigned-fixture`;
	let sent;
	const service = makeService({ readRecord: async () => undefined, config: { chatgptCredentialRef: "CUSTOM_CODEX_OAUTH" },
		resolveCredential: async (ref) => { assert.equal(ref, "CUSTOM_CODEX_OAUTH"); return { value: JSON.stringify({ access: token }) }; },
		fetchImpl: async (url, options) => { sent = { url, options }; return responseFor(url); }
	});
	const result = await service.snapshot({ provider: "openai-codex" });
	assert.equal(sent.url, ALL_URLS[4]);
	assert.equal(sent.options.headers["Chatgpt-Account-Id"], "fake-legacy-account");
	assert.equal(sent.options.headers.Authorization, `Bearer ${token}`);
	assert.ok(!JSON.stringify(result).includes(token));
	service.dispose();
});

test("DeepSeek account grants are restricted to their issuer and cannot use an API key", async () => {
	const service = makeService({ readRecord: async () => ({ kind: "grant", payload: { token: "fake-other-issuer-token", issuer: "https://example.invalid" } }),
		resolveCredential() { throw new Error("account route must not use an API key"); }, fetchImpl() { throw new Error("must not send another issuer's token"); }
	});
	const result = await service.snapshot({ provider: "deepseek-account" });
	assert.equal(result.providers[0].status, "no-key");
	service.dispose();
});

test("DeepSeek API provider aliases remain separate and Moonshot API models do not read Kimi Code quotas", async () => {
	const urls = [];
	const service = makeService({ fetchImpl: async (url) => { urls.push(url); return responseFor(url); } });
	const api = await service.snapshot({ provider: "deepseek-official" });
	assert.deepEqual(api.providers.map((value) => value.id), ["deepseek"]);
	assert.deepEqual(urls, [ALL_URLS[2]]);
	for (const provider of ["moonshot", "moonshotai", "moonshotai-cn"]) assert.deepEqual((await service.snapshot({ provider })).providers, []);
	assert.equal(urls.length, 1);
	service.dispose();
});
