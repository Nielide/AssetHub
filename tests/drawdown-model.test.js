const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/drawdown-model.js');

test('syncs all invested groups, deduplicates, and preserves existing references', () => {
    const state = { usd: [{ ticker: ' voo ', shares: 2, price: 95 }, { ticker: 'VOO', shares: 1, price: 95 }, { ticker: 'New', shares: 1 }, { ticker: 'ZERO', shares: 0 }], cn: [{ ticker: 'sh518880', shares: 100, price: 8 }], sgov: [{ ticker: 'SGOV', shares: 4, price: 100 }], drawdown: [{ id: 'watch', symbol: 'TSLA', high: 300, current: 200 }, { id: 'voo', symbol: 'voo', high: 110, current: 90 }, { id: 'duplicate', symbol: 'VOO', high: 120 }] };
    model.sync(state);
    assert.deepEqual(state.drawdown.map(row => row.symbol), ['VOO', 'SH518880', 'SGOV', 'TSLA']);
    assert.equal(state.drawdown[0].id, 'voo');
    assert.equal(state.drawdown[0].high, 110);
    assert.equal(state.drawdown[0].current, 95);
    assert.equal(state.drawdown[1].currency, 'CNY');
    assert.equal(state.drawdown[1].high, 0);
    const before = JSON.stringify(state.drawdown);
    model.sync(state);
    assert.equal(JSON.stringify(state.drawdown), before);
    state.usd.forEach(item => item.price = 0);
    model.sync(state);
    assert.equal(state.drawdown[0].current, 0);
    assert.equal(model.metrics(state.drawdown[0]).ready, false);
});

test('custom order survives refresh and new holdings; sold references become watchlist', () => {
    const state = { usd: [{ ticker: 'VOO', shares: 1, price: 99 }], drawdownSort: 'custom', drawdown: [{ id: 'a', symbol: 'TSLA', high: 200 }, { id: 'b', symbol: 'VOO', high: 100 }] };
    model.sync(state);
    assert.deepEqual(state.drawdown.map(row => row.id), ['a', 'b']);
    state.usd.push({ ticker: 'QQQM', shares: 1, price: 80 });
    model.sync(state);
    assert.deepEqual(state.drawdown.map(row => row.symbol), ['TSLA', 'VOO', 'QQQM']);
    state.usd = [];
    model.sync(state);
    assert.equal(state.drawdown[1].source, 'watchlist');
    assert.equal(state.drawdown[1].high, 100);
});

test('filtered sorting preserves unseen rows and rejects invalid orders', () => {
    const rows = ['a', 'b', 'c', 'd'].map(id => ({ id }));
    assert.deepEqual(model.reorderVisible(rows, ['d', 'b']).map(row => row.id), ['a', 'd', 'c', 'b']);
    assert.equal(model.reorderVisible(rows, ['missing']), rows);
    assert.equal(model.reorderVisible(rows, ['b', 'b']), rows);
});

test('missing data, prices above reference, exact levels and 30%+ are finite and honest', () => {
    assert.equal(model.metrics({ high: 0, current: 100 }).ready, false);
    assert.equal(model.metrics({ high: 100, current: 0 }).ready, false);
    assert.equal(model.metrics({ high: 100, current: 110 }).progress, 0);
    assert.equal(model.metrics({ high: 100, current: 95 }).next, 10);
    for (const current of [70, 50]) {
        const result = model.metrics({ high: 100, current });
        assert.equal(result.next, null);
        assert.equal(result.progress, 100);
        assert.ok(Number.isFinite(result.distance));
    }
});
