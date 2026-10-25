# Changelog

## 0.6.1 — 2026-10-26

A compact header, more account sources, and clearer balance formatting.

- Add ChatGPT subscription quotas, provider-reported plan/credits, and reset times from the active compatible Codex subscription login. Preserve additional feature-specific quota windows.
- Add DeepSeek signed-in account wallets, separately from API-key balances, with exact decimal totals per currency.
- Replace repeated card headings with embedded provider marks; display money rounded half up to two decimal places.
- Isolate cached ChatGPT usage by account and credential, enforce the active-account selection and DeepSeek grant origin, and reject incomplete wallet responses.
- Preserve selected-provider filtering, missing-selection guidance, cancellation, and portable reset-time behavior.
- Update bilingual guides and fictional offline examples. All 48 mocked/isolated tests pass; no real-account usage or model inference is part of release validation.

ChatGPT and DeepSeek account adapters depend on internal provider responses and compatible host credential formats; they are not stable public quota API contracts. Package and internal sidebar identifiers remain compatible with previous releases.

## 0.5.3 — 2026-10-26

Rename the public project to **Usage Panel · 用量面板** (formerly Model Meter).

- Update the package description, bilingual guides, preview and offline demo with the new name.
- Keep the `dsh-model-meter` package/repository address and internal identifiers so existing installations can update normally.
- The sidebar entry remains **Usage / 用量**. Runtime behavior is unchanged from 0.5.2.

## 0.5.2 — 2026-10-26

A simpler view that follows the selected model.

- Show only the selected model's provider rather than all provider accounts.
- Rename the sidebar entry to **Usage / 用量** while retaining the Model Meter package name.
- Keep quota windows focused on used percentage, progress, and provider reset time/countdown; remove repeated remaining percentages and raw counts.
- Remove session token, context pressure, and session statistics sections.
- Format reset dates in the interface language.
- Show explicit states for no selected model and unsupported providers.
- Clear stale provider data on model changes; missing selection/projection never triggers all-account queries.
- Recognize DeepSeek's official API-key provider and keep account-login allowances separate from API balances.
- Keep reset-date tests portable across local time zones.
- Refresh the bilingual setup guide and fictional, offline interactive preview.

Account-wide quota and balance semantics, fixed official query origins, and host-side credentials remain unchanged.

## 0.4.0 — 2026-10-25

Initial community release as **Model Meter** (`dsh-model-meter`).

- DeepSeek API balance cards with precise decimal strings and separate currencies.
- GLM and Kimi Coding Plan quota windows, percentages, and provider reset times.
- Kimi legacy/current response reconciliation with visible conflict warnings.
- Current-session tokens, cache-hit rate, context pressure, and session statistics.
- English/Chinese interface, automatic refresh, and manual refresh.
- Host-side credential resolution, fixed official origins, request cancellation, timeouts, and caching.
- Tests for provider parsing, privacy boundaries, real Cordis lifecycle, and UI refresh behavior.

The implementation evolved from an early local usage-panel prototype. Internal tab and RPC identifiers remain stable for saved-layout compatibility.
