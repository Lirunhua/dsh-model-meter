import assert from "node:assert/strict";
import { setImmediate as immediate, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createUsageService, parseGlmUsage, parseKimiUsage, parseDeepSeekBalance } from "../lib/providers.js";
import * as host from "../lib/index.js";

const KEYS = { ZAI_API_KEY: "fake-glm-key", KIMI_CODING_API_KEY: "fake-kimi-key", DEEPSEEK_API_KEY: "fake-deepseek-key" };
const GLM = { code: 200, success: true, data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 38, nextResetTime: 1792936800000 }] } };
const KIMI = { usages: { limit_5h: { used_ratio: "0.35", reset_time: "2026-10-25T14:00:00Z" }, limit_7d: { used_ratio: 0.2 } } };
const DEEPSEEK = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] };
const responseFor = (url) => Response.json(url.includes("deepseek.com") ? DEEPSEEK : url.includes("z.ai") || url.includes("bigmodel.cn") ? GLM : KIMI);
const credentials = async (ref) => ({ value: KEYS[ref] });
const makeService = (options = {}) => createUsageService({ resolveCredential: credentials, fetchImpl: async (url) => responseFor(url), ...options });

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

test("a DeepSeek account with zero funds is a successful balance query, not an auth or subscription error", async () => {
	const service = makeService({ fetchImpl: async (url) => url.includes("deepseek.com") ? Response.json({ is_available: false, balance_infos: [
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
	assert.equal(urls.length, 2);
	assert.ok(urls.every((url) => !url.includes("deepseek.com")));
	service.dispose();
});

test("DeepSeek auth and schema failures are isolated and never expose remote bodies or credentials", async () => {
	for (const [response, expectedStatus] of [
		[new Response(`SECRET ${KEYS.DEEPSEEK_API_KEY}`, { status: 401 }), "error"],
		[Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "unknown" }] }), "unsupported"]
	]) {
		const service = makeService({ fetchImpl: async (url) => url.includes("deepseek.com") ? response : responseFor(url) });
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
	assert.equal(calls.length, 3);
	assert.equal(calls.find((call) => call.url.includes("deepseek.com")).auth, "Bearer fake-deepseek-first");
	deepseekKey = "fake-deepseek-replacement";
	await service.snapshot();
	assert.equal(calls.length, 4);
	assert.equal(calls.at(-1).url, "https://api.deepseek.com/user/balance");
	assert.equal(calls.at(-1).auth, "Bearer fake-deepseek-replacement");
	service.dispose();
});

test("fixed endpoints and provider-specific authorization never probe another region", async () => {
	const calls = [];
	const service = makeService({ fetchImpl: async (url, options) => { calls.push({ url, options }); return responseFor(url); } });
	const result = await service.snapshot();
	assert.deepEqual(result.providers.map((value) => [value.id, value.kind, value.status]), [["glm", "subscription", "ok"], ["kimi", "subscription", "ok"], ["deepseek", "balance", "ok"]]);
	assert.deepEqual(calls.map((call) => call.url), ["https://api.z.ai/api/monitor/usage/quota/limit", "https://api.kimi.com/coding/v1/usages", "https://api.deepseek.com/user/balance"]);
	assert.equal(calls[0].options.headers.Authorization, KEYS.ZAI_API_KEY);
	assert.equal(calls[1].options.headers.Authorization, `Bearer ${KEYS.KIMI_CODING_API_KEY}`);
	assert.equal(calls[2].options.headers.Authorization, `Bearer ${KEYS.DEEPSEEK_API_KEY}`);
	assert.ok(calls.every((call) => call.options.redirect === "error" && call.options.headers.Accept === "application/json"));
	assert.ok(!JSON.stringify(result).includes("fake-"));
	service.dispose();
});

test("explicit region changes select one official origin; invalid regions send no request or key", async () => {
	const calls = [];
	const service = makeService({ config: { glmRegion: "bigmodel", kimiRegion: "international" }, fetchImpl: async (url) => { calls.push(url); return responseFor(url); } });
	await service.snapshot();
	assert.deepEqual(calls, ["https://open.bigmodel.cn/api/monitor/usage/quota/limit", "https://api.kimi.ai/coding/v1/usages", "https://api.deepseek.com/user/balance"]);
	service.dispose();
	const invalid = makeService({ config: { glmRegion: "toString", kimiRegion: "https://example.com", deepseekCredentialRef: "invalid-ref" }, resolveCredential() { throw new Error("must not read credentials"); }, fetchImpl() { throw new Error("must not send request"); } });
	assert.ok((await invalid.snapshot()).providers.every((value) => value.status === "unsupported"));
	invalid.dispose();
});

test("missing credentials produce no-key cards without network requests", async () => {
	let calls = 0;
	const service = makeService({ resolveCredential: async () => undefined, fetchImpl: async () => { calls++; throw new Error("unexpected network"); } });
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
	assert.equal(calls, 3);
	await service.snapshot({ refresh: true });
	assert.equal(calls, 6);
	clock += 101;
	await service.snapshot();
	assert.equal(calls, 9);
	glmKey = "replacement-fake-key";
	await service.snapshot();
	assert.equal(calls, 10);
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
async function ready(calls, count = 3) {
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
	assert.equal(deferred.calls.length, 3);
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
	await ready(deferred.calls, 6);
	deferred.calls.slice(3).forEach((call) => call.finish());
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
		ctx.provide("credentials", { resolve: credentials });
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
		assert.equal((await route.fetch(request({ ...envelope, method: "wrong" }))).status, 400);
		assert.equal((await route.fetch(request(envelope, "text/plain"))).status, 415);
		await fiber.dispose();
		assert.equal(route, undefined);
	} finally {
		globalThis.fetch = previousFetch;
		await ctx.fiber.dispose();
	}
});
