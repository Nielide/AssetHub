// Portfolio values and display conversions share one calculation path.
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PortfolioModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const positive = value => Math.max(0, number(value));
    const rate = (value, fallback) => number(value) > 0 ? number(value) : fallback;
    function snapshot(state, usdCny) {
        const fx = rate(usdCny, rate(state.fxRate, 7.25)), hkdFx = rate(state.hkdFx, .93);
        const factor = currency => currency === 'USD' ? fx : currency === 'HKD' ? hkdFx : 1;
        const positions = ['usd', 'cn', 'sgov'].flatMap(type => (state[type] || []).filter(item => positive(item.shares)).map(item => {
            const shares = positive(item.shares), price = positive(item.price), cost = positive(item.cost);
            const currency = type === 'cn' ? 'CNY' : 'USD', value = shares * price, costValue = shares * cost;
            return { ...item, type, currency, shares, price, cost, value, costValue, converted: value * factor(currency), profit: value - costValue, returnPct: costValue > 0 ? (value / costValue - 1) * 100 : null };
        }));
        const cash = (state.cash || []).map(item => ({ ...item, currency: item.currency || 'CNY', value: positive(item.amount), converted: positive(item.amount) * factor(item.currency || 'CNY') }));
        const values = [
            { type: 'usd', label: '美股', color: 'var(--allocation-us)' },
            { type: 'cn', label: 'A 股', color: 'var(--allocation-cn)' },
            { type: 'sgov', label: '国债 ETF', color: 'var(--allocation-sgov)' },
            { type: 'cash', label: '现金', color: 'var(--allocation-cash)' }
        ].map(group => ({ ...group, value: group.type === 'cash' ? cash.reduce((sum, item) => sum + item.converted, 0) : positions.filter(item => item.type === group.type).reduce((sum, item) => sum + item.converted, 0) }));
        const total = values.reduce((sum, item) => sum + item.value, 0);
        positions.forEach(item => { item.weight = total ? item.converted / total * 100 : 0; });
        cash.forEach(item => { item.weight = total ? item.converted / total * 100 : 0; });
        const currencies = ['USD', 'CNY', 'HKD'].map(currency => {
            const value = positions.filter(item => item.currency === currency).reduce((sum, item) => sum + item.value, 0) + cash.filter(item => item.currency === currency).reduce((sum, item) => sum + item.value, 0);
            return { currency, value, converted: value * factor(currency), weight: total ? value * factor(currency) / total * 100 : 0 };
        });
        return { positions, cash, values, currencies, total, fx, hkdFx };
    }
    function calendarAmount(record, field, currency, fallbackFx) {
        return number(record?.[field]) / (currency === 'USD' ? rate(record?.fxRate, rate(fallbackFx, 7.25)) : 1);
    }
    const positionKey = item => `${item.type}:${item.id}`;
    function orderedPositions(positions, keys = []) {
        const byKey = new Map(positions.map(item => [positionKey(item), item]));
        const ordered = [];
        (Array.isArray(keys) ? keys : []).forEach(key => {
            if (!byKey.has(key)) return;
            ordered.push(byKey.get(key));
            byKey.delete(key);
        });
        return ordered.concat([...byKey.values()]);
    }
    // A filtered drag only changes the slots occupied by those visible holdings.
    function reorderPositions(positions, visibleKeys) {
        const byKey = new Map(positions.map(item => [positionKey(item), item]));
        const visible = new Set(visibleKeys);
        if (visible.size !== visibleKeys.length || visibleKeys.some(key => !byKey.has(key))) return positions;
        let index = 0;
        return positions.map(item => visible.has(positionKey(item)) ? byKey.get(visibleKeys[index++]) : item);
    }
    return { snapshot, calendarAmount, positionKey, orderedPositions, reorderPositions };
});
