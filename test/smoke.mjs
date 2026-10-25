// Compatibility entry: run the current client and host tests.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const files = ["client.test.mjs", "host.test.mjs"].map(name => fileURLToPath(new URL(name, import.meta.url)));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
