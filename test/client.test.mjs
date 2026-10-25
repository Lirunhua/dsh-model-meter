import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function render(providers, projections = {}, missingHook = false, options = {}) {
  let definition, body;
  const dictionaries = {};
  const effects = [], stateChanges = [], timers = new Map();
  const jsx = (type, props, key) => ({ type, props: { ...props, key } });
  const react = {
    useEffect(fn) { effects.push(fn); },
    useRef: (current) => ({ current }),
    useState(initial) {
      let value = initial && typeof initial === 'object' && 'providers' in initial
        ? { provider: options.stateProvider ?? initial.provider, busy: false, providers, unsupported: options.unsupported ?? '', error: options.error ?? '' } : initial;
      return [value, (next) => { value = typeof next === 'function' ? next(value) : next; stateChanges.push(value); }];
    },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { definition = value; } } },
    AbortController, AbortSignal,
    setInterval(callback, delay) { const id = {}; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  assert.equal(definition.id, 'dsh-model-meter');
  const client = definition.factory((name) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  assert.equal(client.name, 'dsh-model-meter/client');
  client.apply({
    get: () => ({ rpc: { call: options.rpcCall || (() => { throw new Error('Network must not run in render tests'); }) } }),
    effect(fn) { return fn(); },
    locale: {
      register(ns, value) { dictionaries[ns] = value; },
      bind(ns) {
        return (key, params = {}) => Object.entries(params).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          dictionaries[ns]?.[options.language || 'zh'][key] || key,
        );
      },
    },
    sidebarRightTabs: { register(tab) { assert.equal(tab.kind, 'usage'); return () => {}; } },
    slots: { register(_slot, component) { body = component; return () => {}; } },
  });
  assert.deepEqual(Object.keys(dictionaries['usage-panel'].zh).sort(), Object.keys(dictionaries['usage-panel'].en).sort());
  const nodes = [], strings = [];
  function visit(element) {
    if (element == null || typeof element === 'boolean') return;
    if (Array.isArray(element)) return element.forEach(visit);
    if (typeof element !== 'object') return strings.push(String(element));
    if (typeof element.type === 'function') return visit(element.type(element.props));
    nodes.push(element);
    visit(element.props.children);
  }
  const selection = projections.modelSelection === undefined
    ? { modelSelection: { next: { provider: 'kimi-coding', model: 'k3' } } }
    : projections.modelSelection === null ? {} : { modelSelection: projections.modelSelection };
  const allProjections = { ...selection, ...projections };
  visit(body(missingHook ? {} : { useProjection: (key) => allProjections[key] }));
  return { nodes, text: strings.join('\n'), effects, stateChanges, timers };
}

test('plan quotas show used percentages, exact reset and account scope, without redundant lines', () => {
  const { nodes, text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: '5h', usedPercent: 12.5, resetAt: '2099-01-01T12:00:00Z', used: 25, limit: 200, remaining: 175 }],
  }]);
  // Header shows only the provider brand mark; title/model/scope lines are gone.
  assert.doesNotMatch(text, /当前模型用量|服务商账号层面|当前模型：/);
  assert.ok(nodes.some((n) => n.type === 'img' && n.props.alt === 'Kimi'));
  assert.match(text, /已用 12\.5%/);
  assert.match(text, /重置：/);
  assert.match(text, /距重置/);
  // Redundant lines (remaining %, used/limit counts, conflict warnings) are not shown.
  assert.doesNotMatch(text, /剩余 87\.5%|已用 25 \/ 200|剩余 175|不一致/);
  assert.equal(nodes.find((n) => n.props.role === 'progressbar').props['aria-valuenow'], 12.5);
});

test('reset dates follow the interface language instead of the browser locale', () => {
  const { text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: '5h', usedPercent: 12.5, resetAt: '2099-01-01T12:00:00Z' }],
  }]);
  const expected = new Date('2099-01-01T12:00:00Z').toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  assert.ok(text.includes(`重置：${expected}`));
  assert.doesNotMatch(text, /Jan|AM|PM/);
});

test('zero usage remains zero and an unknown quota is never rendered as zero', () => {
  const { nodes, text } = render([{
    id: 'glm', label: 'GLM Coding Plan', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: '5h', usedPercent: 0 }, { id: '7d', usedPercent: null }],
  }]);
  const meters = nodes.filter((n) => n.props.role === 'progressbar');
  assert.equal(meters.length, 1);
  assert.equal(meters[0].props['aria-valuenow'], 0);
  assert.equal(meters[0].props.children.props.style.width, '0%');
  assert.match(text, /已用 0%/);
  assert.match(text, /服务商未提供使用比例/);
  assert.match(text, /服务商未提供重置时间/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test('percentage precision keeps the used value exact without repeating it as a remaining line', () => {
  const { text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: 'month-total', usedPercent: 4.35 }],
  }]);
  assert.match(text, /已用 4\.35%/);
  assert.doesNotMatch(text, /剩余 95\.65%/);
});

test('DeepSeek balances round to two decimal places and separate currencies without quota meters', () => {
  const amount = '9007199254740993.12345678901234567890';
  const { text, nodes } = render([{
    id: 'deepseek', label: 'DeepSeek API', kind: 'balance', status: 'ok', isAvailable: true,
    fetchedAt: Date.now(), windows: [],
    balances: [
      { currency: 'CNY', total: amount, toppedUp: amount, granted: '0.00' },
      { currency: 'USD', total: '2.50', toppedUp: '2.00', granted: '0.50' },
    ],
  }]);
  assert.ok(text.includes('CNY 9007199254740993.12'));
  assert.match(text, /USD 2\.50/);
  assert.match(text, /CNY 0\.00/);
  assert.match(text, /充值余额/);
  assert.match(text, /赠送余额/);
  assert.match(text, /余额可用于 API 调用/);
  assert.equal(nodes.filter((n) => n.props['data-usage-currency']).length, 2);
  assert.equal(nodes.filter((n) => n.props.role === 'progressbar').length, 0);
  assert.doesNotMatch(text, /9007199254740993\.12345678901234567890|重置|额度窗口|NaN|Infinity/);
});

test('DeepSeek zero and negative balances are valid query results rather than a failed query', () => {
  for (const total of ['0.00', '-0.01']) {
    const { text } = render([{
      id: 'deepseek', label: 'DeepSeek API', kind: 'balance', status: 'ok', isAvailable: false,
      fetchedAt: Date.now(), windows: [], balances: [{ currency: 'CNY', total, toppedUp: total, granted: '0.00' }],
    }]);
    assert.ok(text.includes(`CNY ${total}`));
    assert.match(text, /余额不足/);
    assert.doesNotMatch(text, /查询失败|暂时无法|重置/);
  }
});

test('adding DeepSeek keeps GLM and Kimi quota cards and missing-key guidance intact', () => {
  const { text, nodes } = render([
    { id: 'glm', label: 'GLM Coding Plan', kind: 'subscription', status: 'ok', windows: [{ id: '5h', usedPercent: 10 }] },
    { id: 'kimi', label: 'Kimi Code', kind: 'subscription', status: 'ok', windows: [{ id: '7d', usedPercent: 20 }] },
    { id: 'deepseek', label: 'DeepSeek API', kind: 'balance', status: 'no-key', balances: [], windows: [] },
  ]);
  // Provider names render as bundled brand logos, not text headings.
  assert.doesNotMatch(text, /GLM Coding Plan|Kimi Code|DeepSeek API/);
  assert.match(text, /模型设置/);
  assert.equal(nodes.filter((n) => n.props.role === 'progressbar').length, 2);
  assert.equal(nodes.filter((n) => n.props['data-usage-provider']).length, 3);
  assert.doesNotMatch(text, /CNY 0|USD 0/);
});

test('missing projection hooks show guidance without querying all accounts', () => {
  const missing = render([{ id: 'kimi', label: 'Kimi Code', status: 'no-key' }], {}, true);
  assert.match(missing.text, /未能读取会话投影/);
  assert.doesNotMatch(missing.text, /Kimi Code|GLM Coding Plan|上下文|Token 用量|轮次/);
  assert.equal(missing.effects.length, 0);
});

test('without a selected model the panel asks for one instead of listing every account', () => {
  const { text } = render([], { modelSelection: null });
  assert.match(text, /选择模型后/);
  assert.doesNotMatch(text, /Kimi Code|GLM Coding Plan/);
});

test('an elapsed reset is labelled pending upstream refresh without fabricating a new time', () => {
  const { text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: '7d', usedPercent: 99, resetAt: '2000-01-01T00:00:00Z' }],
  }]);
  assert.match(text, /已到重置时间，等待服务商更新/);
  assert.doesNotMatch(text, /距重置/);
});

test('refreshes do not overlap, can run again after completion, and cancel on unmount', async () => {
  const calls = [];
  const ui = render([], {}, false, {
    rpcCall(...args) {
      return new Promise((resolve, reject) => {
        calls.push({ args, resolve });
        args[3].addEventListener('abort', () => reject(args[3].reason), { once: true });
      });
    },
  });
  const cleanup = ui.effects[0]();
  const refresh = ui.nodes.find((n) => n.type === 'button' && n.props.children === '刷新');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[1], 'usage-panel/balances');
  assert.equal(calls[0].args[3].aborted, false);
  refresh.props.onClick();
  assert.equal(calls.length, 1, 'an in-flight refresh must not start another request');
  assert.equal(calls[0].args[2].provider, 'kimi-coding', 'the request carries the selected model provider');
  calls[0].resolve({ ok: true, value: { providers: [] } });
  await new Promise(setImmediate);
  assert.equal(ui.stateChanges.at(-1).busy, false);
  refresh.props.onClick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[2].refresh, true);
  cleanup();
  assert.equal(calls[1].args[3].aborted, true);
  assert.equal(ui.timers.size, 0);
  await new Promise(setImmediate);
});

test('the ChatGPT subscription card shows its badge, plan, credits and weekly window', () => {
  const { nodes, text } = render([{
    id: 'chatgpt', label: 'ChatGPT 订阅', kind: 'subscription', status: 'ok', fetchedAt: Date.now(),
    plan: 'pro', credits: { unlimited: false, balance: '100' },
    windows: [{ id: '7d', usedPercent: 33, resetAt: '2099-01-07T00:00:00Z' }],
  }], { modelSelection: { next: { provider: 'openai-codex', model: 'gpt-6-astra' } } });
  assert.ok(nodes.some((n) => n.type === 'img' && n.props.alt === 'GPT'));
  assert.match(text, /套餐：Pro/);
  assert.match(text, /积分余额：100/);
  assert.match(text, /已用 33%/);
  assert.match(text, /7 天窗口/);
});

test('the DeepSeek account card labels account wallets as account balance, not API balance', () => {
  const { text, nodes } = render([{
    id: 'deepseek-account', label: 'DeepSeek 账号', kind: 'balance', scope: 'account', status: 'ok', fetchedAt: Date.now(), windows: [],
    balances: [{ currency: 'CNY', total: '123.45678901', granted: '3.45678901', toppedUp: '120' }],
  }], { modelSelection: { next: { provider: 'deepseek-account', model: 'deepseek-flash' } } });
  assert.match(text, /账号余额/);
  assert.doesNotMatch(text, /API 余额/);
  assert.ok(text.includes('CNY 123.46'));
  assert.ok(nodes.some((n) => n.type === 'img' && n.props.alt === 'DeepSeek'));
});

test('a provider-specific login hint replaces the generic missing-key sentence', () => {
  const { text } = render([{
    id: 'chatgpt', label: 'ChatGPT 订阅', kind: 'subscription', status: 'no-key', windows: [],
    message: '请先在模型设置中登录 ChatGPT 订阅',
  }], { modelSelection: { next: { provider: 'openai-codex', model: 'gpt-6-astra' } } });
  assert.match(text, /请先在模型设置中登录 ChatGPT 订阅/);
  assert.doesNotMatch(text, /请先在模型设置中配置此账号/);
});

test('an empty provider does not query every account', () => {
  const ui = render([], { modelSelection: { next: { provider: '', model: 'pending' } } });
  assert.match(ui.text, /选择模型后/);
  assert.equal(ui.effects.length, 0);
});

test('switching providers cannot display the previous provider snapshot or its errors', () => {
  const ui = render([{ id: 'kimi', label: 'Previous Kimi account', status: 'ok', windows: [{ id: '5h', usedPercent: 80 }] }], {
    modelSelection: { next: { provider: 'zai', model: 'glm-selected' } },
  }, false, { stateProvider: 'kimi-coding', error: 'Previous provider error', unsupported: 'previous' });
  assert.ok(ui.nodes.some((n) => n.type === 'img' && n.props.alt === 'GLM'));
  assert.match(ui.text, /获取中/);
  assert.doesNotMatch(ui.text, /Previous|已用 80%|暂不提供/);
  assert.equal(ui.nodes.filter((node) => node.props['data-usage-provider']).length, 0);
});

test('last-used selection is used when the next model is not set', async () => {
  const calls = [];
  const ui = render([], { modelSelection: { lastUsed: { provider: 'deepseek-official', model: 'deepseek-selected' } } }, false, {
    rpcCall: async (...args) => { calls.push(args); return { ok: true, value: { providers: [] } }; },
  });
  const cleanup = ui.effects[0]();
  assert.ok(ui.nodes.some((n) => n.type === 'img' && n.props.alt === 'DeepSeek'));
  assert.equal(calls[0][2].provider, 'deepseek-official');
  cleanup();
  await new Promise(setImmediate);
});


test('balances round half up to two decimals without binary floating point or negative zero', () => {
  for (const [amount, expected] of [['1.005', '1.01'], ['-1.005', '-1.01'], ['-0.004', '0.00'], ['9.999', '10.00']]) {
    const { text } = render([{ id: 'deepseek', label: 'DeepSeek API', kind: 'balance', status: 'ok', balances: [{ currency: 'CNY', total: amount, toppedUp: amount, granted: '0' }] }]);
    assert.ok(text.includes(`CNY ${expected}`));
  }
});
