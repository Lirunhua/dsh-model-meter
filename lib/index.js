import { createUsageService } from "./providers.js";

export const name = "dsh-model-meter";
export const inject = ["connection", "credentials"];

/** The exact Fetch route inherits Connection's authenticated owner admission. */
export function apply(ctx, config = {}) {
	const service = createUsageService({
		config,
		resolveCredential: (ref) => ctx.credentials.resolve(ref),
		readRecord: typeof ctx.credentials.readRecord === "function" ? (key) => ctx.credentials.readRecord(key) : undefined
	});
	ctx.effect(() => () => service.dispose(), "usage-panel: pending requests");
	const method = "usage-panel/balances";
	ctx.effect(() => ctx.connection.fetch.register({
		path: `/api/${method}`,
		methods: ["POST"],
		requestBody: "buffered",
		async fetch(request) {
			if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return new Response("content type must be application/json", { status: 415 });
			let body;
			try { body = await request.json(); }
			catch { return new Response("invalid JSON", { status: 400 }); }
			if (body === null || typeof body !== "object" || body.type !== "client-request" || typeof body.rpcId !== "string" || body.method !== method || !("payload" in body)) return new Response("invalid RPC envelope", { status: 400 });
			let result;
			try {
				const value = await service.snapshot({ refresh: body.payload?.refresh === true, provider: body.payload?.provider, signal: request.signal });
				result = { ok: true, value };
			} catch {
				const cancelled = request.signal.aborted;
				result = { ok: false, error: { code: cancelled ? "usage-panel/cancelled" : "usage-panel/internal", message: cancelled ? "请求已取消" : "套餐用量查询失败", details: {} } };
			}
			return Response.json({ type: "server-response", rpcId: body.rpcId, result }, { headers: { "cache-control": "no-store" } });
		}
	}), "usage-panel: authenticated quota route");
}
