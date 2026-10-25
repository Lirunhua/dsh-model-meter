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
        ? { busy: false, providers, error: '' } : initial;
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
          dictionaries[ns]?.zh[key] || key,
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
  visit(body(missingHook ? {} : { useProjection: (key) => projections[key] }));
  return { nodes, text: strings.join('\n'), effects, stateChanges, timers };
}

test('plan quotas show used and remaining percentages, exact reset and account scope', () => {
  const { nodes, text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: '5h', usedPercent: 12.5, resetAt: '2099-01-01T12:00:00Z', used: 25, limit: 200, remaining: 175 }],
  }]);
  assert.match(text, /模型额度与余额/);
  assert.match(text, /账号层面的套餐额度和 API 余额/);
  assert.match(text, /已用 12\.5%/);
  assert.match(text, /剩余 87\.5%/);
  assert.match(text, /重置：/);
  assert.match(text, /距重置/);
  assert.match(text, /已用 25 \/ 200/);
  assert.match(text, /剩余 175/);
  assert.equal(nodes.find((n) => n.props.role === 'progressbar').props['aria-valuenow'], 12.5);
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
  assert.match(text, /剩余 100%/);
  assert.match(text, /服务商未提供使用比例/);
  assert.match(text, /服务商未提供重置时间/);
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test('percentage precision keeps displayed used and remaining values consistent', () => {
  const { text } = render([{
    id: 'kimi', label: 'Kimi Code', status: 'ok', fetchedAt: Date.now(),
    windows: [{ id: 'month-total', usedPercent: 4.35 }],
  }]);
  assert.match(text, /已用 4\.35%/);
  assert.match(text, /剩余 95\.65%/);
});

test('DeepSeek balances retain decimal precision and separate currencies without quota meters', () => {
  const amount = '9007199254740993.12345678901234567890';
  const { text, nodes } = render([{
    id: 'deepseek', label: 'DeepSeek API', kind: 'balance', status: 'ok', isAvailable: true,
    fetchedAt: Date.now(), windows: [],
    balances: [
      { currency: 'CNY', total: amount, toppedUp: amount, granted: '0.00' },
      { currency: 'USD', total: '2.50', toppedUp: '2.00', granted: '0.50' },
    ],
  }]);
  assert.ok(text.includes(`CNY ${amount}`));
  assert.match(text, /USD 2\.50/);
  assert.match(text, /CNY 0\.00/);
  assert.match(text, /充值余额/);
  assert.match(text, /赠送余额/);
  assert.match(text, /余额可用于 API 调用/);
  assert.equal(nodes.filter((n) => n.props['data-usage-currency']).length, 2);
  assert.equal(nodes.filter((n) => n.props.role === 'progressbar').length, 0);
  assert.doesNotMatch(text, /重置|额度窗口|NaN|Infinity/);
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
  assert.match(text, /GLM Coding Plan/);
  assert.match(text, /Kimi Code/);
  assert.match(text, /DeepSeek API/);
  assert.match(text, /模型设置/);
  assert.equal(nodes.filter((n) => n.props.role === 'progressbar').length, 2);
  assert.equal(nodes.filter((n) => n.props['data-usage-provider']).length, 3);
  assert.doesNotMatch(text, /CNY 0|USD 0/);
});

test('invalid pressure cannot show NaN and quotas survive missing projection hooks', () => {
  const { text } = render([], { contextPressure: { projectedTokens: 0, contextWindow: 0 } });
  assert.doesNotMatch(text, /NaN|Infinity/);
  const missing = render([{ id: 'kimi', label: 'Kimi Code', status: 'no-key' }], {}, true).text;
  assert.match(missing, /Kimi Code/);
  assert.match(missing, /模型设置/);
  assert.match(missing, /Token 统计暂不可用/);
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
