# Changelog

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
