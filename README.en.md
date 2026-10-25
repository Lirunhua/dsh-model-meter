# Usage Panel · 用量面板

**An unofficial DeepSeek Harness community plugin.** Independently maintained; it is not an official product, review, or endorsement from DeepSeek, OpenAI, Z.ai, or Moonshot/Kimi.

[中文](README.md) · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

A simpler Harness sidebar that follows the selected model and shows only its provider's **ChatGPT/Coding Plan quotas, reset times, or DeepSeek balances**.

## Features

| Provider | Data shown |
|---|---|
| ChatGPT subscription | Provider-reported plan, credits, 5-hour/7-day and other quota windows, and reset times |
| DeepSeek signed-in account | Topped-up and granted wallet balances, shown separately by currency |
| DeepSeek API | Total available, topped-up, and granted balances; API balance availability; CNY/USD shown separately |
| GLM Coding Plan | Provider-reported 5-hour, 7-day, and other windows; used percentages and reset times |
| Kimi Code | Provider-reported 5-hour, 7-day, monthly total, and monthly coding windows; usage and resets |

Automatic refresh runs every 60 seconds, with a manual refresh button. Chinese and English follow the Harness language setting.

- A compact provider mark replaces repeated header text. Money is displayed with two decimal places while host data retains decimal precision.
- Shows only the provider corresponding to the selected model. No selection and unsupported providers have explicit states.
- Quota windows keep the used percentage, progress bar, reset time, and countdown; repeated remaining percentages and raw counts are removed.
- Session tokens, context pressure, turns, and durations are no longer displayed.
- Quotas and balances belong to the configured provider account, rather than measuring the selected model's individual consumption.

Example with fictional data:

![Usage Panel preview with fictional demonstration data](docs/preview.png)

[Offline interactive demo](docs/demo.html): download and open in a browser to switch between ChatGPT/GLM/Kimi/DeepSeek API/DeepSeek account examples, switch languages, and simulate refreshes. Both the preview and demo are UI illustrations with fictional values, not screenshots of a real account.

```text
Select a Kimi model → only Kimi Code appears
5-hour window    18% used
Reset time       Provider-reported time · resets in 2h 15m
```

## Install

Use an initialized Harness profile. Quit Harness Desktop normally before changing its plugins:

```sh
dsh plugin --profile desktop add github:Lirunhua/dsh-model-meter#v0.6.1
```

For the Web profile:

```sh
dsh plugin --profile web add github:Lirunhua/dsh-model-meter#v0.6.1
```

On macOS, Desktop also includes a CLI if `dsh` is not on your path:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add github:Lirunhua/dsh-model-meter#v0.6.1
```

Alternatively, download a prebuilt release archive and install it locally:

```sh
dsh plugin --profile desktop add ./dsh-model-meter-0.6.1.tgz
```

Reopen Harness and add **Usage** with the right sidebar's `+` button (**用量** in Chinese), then select a model. The technical package name and repository path remain `dsh-model-meter` for existing installations and upgrades. The public name is **Usage Panel**.

This release targets the plugin interfaces shipped in Harness `0.2.1-rc.3`. The minimum version is declared in `package.json`; later runtime compatibility still requires verification. The repository includes runnable `lib/` files, so installation needs no build step.

### Migrating an early local usage panel

If an early local `dsh-usage-panel` bundle is enabled, disable or remove it before enabling Usage Panel to avoid duplicate sidebar registrations. Usage Panel retains the original internal tab identifiers so saved sidebar layouts can recover.

## Accounts and regions

Credentials come from the Harness Models settings. The native credential service can also resolve same-named environment variables.

| Provider | Default credential reference | Default region |
|---|---|---|
| GLM Coding Plan | `ZAI_API_KEY` | Z.ai international |
| Kimi Code | `KIMI_CODING_API_KEY` | Kimi China |
| DeepSeek API | `DEEPSEEK_API_KEY` | DeepSeek official API |

Configure the corresponding account in Harness Models first. Keys remain in the host process; do not put them in plugin source or browser code.

For ChatGPT subscriptions, sign in through a compatible [dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription) installation first. Usage Panel reads the active account from `codex-subscription/accounts` (version 1). Only when that record is absent does it support the legacy `OPENAI_CODEX_SUBSCRIPTION_OAUTH` JSON reference. It does not select a different saved account or refresh credentials.

DeepSeek account models use the built-in Harness account login and the `deepseek-account-platform/default` grant. Account models query account wallets; API-key models query API balances. The two credential sources remain independent.

Override regions or credential references in the profile's `cordis.patch.yml`:

```yaml
- id: usage-panel
  name: dsh-model-meter
  config:
    glmRegion: zai                 # zai | bigmodel
    kimiRegion: cn                 # cn | international
    glmCredentialRef: ZAI_API_KEY
    kimiCredentialRef: KIMI_CODING_API_KEY
    deepseekCredentialRef: DEEPSEEK_API_KEY
    chatgptCredentialRef: OPENAI_CODEX_SUBSCRIPTION_OAUTH  # Legacy fallback only
```

Restart Harness after changes. Each provider queries one selected official origin; the same key is never probed across regions automatically.

## Data accuracy and limits

- DeepSeek signed-in models show account wallets; API-key models show API balances and their availability flag. Account wallets do not imply API availability or subscription percentages/reset schedules. Currencies remain separate. Host amounts retain decimal precision; the interface rounds half up to two decimal places.
- ChatGPT shows the active account's provider response, retaining primary and additional quota windows separately. Credits are not a USD balance. Missing quotas and resets are not inferred. OpenAI API pay-as-you-go balances are not supported.
- ChatGPT and DeepSeek account support are compatibility adapters that depend on host credential schemas and internal provider responses, rather than a stable public quota API contract. Provider or login changes may require an update. This release was not validated against a real signed-in account.
- Kimi Code plans are separate from Moonshot API pay-as-you-go accounts.
- Available GLM/Kimi windows and reset fields depend on the provider. Missing fields are marked unavailable rather than counted as zero usage.
- If Kimi returns conflicting old/new statistics for the same window, valid original counts take precedence.
- The selected model determines which provider is queried. Queries use the provider credential configured for this plugin; results describe that account's plan or balance, not an individual model allowance.
- Usage Panel queries usage; it does not top up balances, make payments, or modify accounts.

### Data sources

- [DeepSeek balance API](https://api-docs.deepseek.com/api/get-user-balance/): `GET https://api.deepseek.com/user/balance`
- [GLM official query implementation](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs): `GET /api/monitor/usage/quota/limit` at `api.z.ai` or `open.bigmodel.cn`
- [GLM plan overview](https://docs.bigmodel.cn/cn/coding-plan/overview)
- [Kimi official query implementation](https://github.com/MoonshotAI/kimi-code/blob/main/packages/oauth/src/managed-usage.ts): `GET /coding/v1/usages` at `api.kimi.com` or `api.kimi.ai`
- [Kimi Server API](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html)

The account adapters use `GET https://chatgpt.com/backend-api/wham/usage` and `GET https://platform.deepseek.com/api/v0/users/get_user_summary`. These are not treated as stable public APIs. ChatGPT credentials stay inside the host boundary described in [OpenAI profiles and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## Privacy and requests

Provider requests run in the Harness host process through fixed, read-only official endpoints, with timeouts, caching, and redirects rejected. Keys, authorization headers, and raw upstream error bodies are not returned to the browser. Usage Panel makes no model-inference requests and sends no account data to an additional analytics service.

## Development

Use Node.js 22 or later:

```sh
npm ci --ignore-scripts
npm test
npm pack --ignore-scripts
```

Tests use explicitly fake credentials and mocked provider responses. Coverage includes decimal balances and two-decimal rendering, multiple currencies, missing fields, real Cordis mounting/disposal, account-aware caching, credential origins, additional quota windows, cancellation, timeouts, selected-provider filtering, UI states, and refresh lifecycles. The real Cordis test uses the development dependency and fails if unavailable rather than silently skipping. For runtime diagnostics, `DSH_CORDIS_MODULE` may explicitly name an importable Cordis module.

Report problems in [GitHub Issues](https://github.com/Lirunhua/dsh-model-meter/issues). Remove keys, authorization headers, personal balances, and conversation content from reports.

## License

[MIT](LICENSE)
