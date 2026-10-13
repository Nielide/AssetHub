// Shared by the browser and the scheduled price updater. No DOM or network access.
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DrawdownModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const levels = [5, 10, 15, 20, 25, 30];
    const symbol = value => String(value || '').trim().toUpperCase();
    const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

    function holdings(portfolio) {
        const result = new Map();
        ['usd', 'cn', 'sgov'].forEach(type => {
            (portfolio[type] || []).forEach(item => {
                const key = symbol(item.ticker);
                if (!key || key === 'NEW' || !positive(item.shares)) return;
                if (!result.has(key)) result.set(key, { symbol: key, type, price: 0, currency: type === 'cn' ? 'CNY' : 'USD' });
                const holding = result.get(key);
                if (positive(item.price)) holding.price = positive(item.price);
            });
        });
        return result;
    }

    function sync(portfolio) {
        const owned = holdings(portfolio);
        const rows = [];
        const seen = new Map();
        (Array.isArray(portfolio.drawdown) ? portfolio.drawdown : []).forEach((entry, index) => {
            const key = symbol(entry.symbol);
            // Keep unfinished manually added rows editable.
            if (key && seen.has(key)) {
                const existing = seen.get(key);
                if (!positive(existing.high) && positive(entry.high)) existing.high = positive(entry.high);
                if (!positive(existing.current) && positive(entry.current)) existing.current = positive(entry.current);
                return;
            }
            const row = { ...entry, id: String(entry.id || `dd-legacy-${index}`), symbol: key, high: positive(entry.high), current: positive(entry.current) };
            if (key) seen.set(key, row);
            rows.push(row);
        });
        owned.forEach((holding, key) => {
            if (!seen.has(key)) {
                const row = { id: `dd-holding-${key}`, symbol: key, high: 0, current: holding.price, source: 'holding' };
                seen.set(key, row);
                rows.push(row);
            }
        });
        rows.forEach(row => {
            const holding = owned.get(row.symbol);
            row.source = holding ? 'holding' : 'watchlist';
            row.currency = holding ? holding.currency : (row.currency || (/^(SH|SZ|BJ)\d{6}$/.test(row.symbol) ? 'CNY' : 'USD'));
            if (holding) row.current = holding.price;
            // A quote is not a historical high: keep missing references explicitly unset.
        });
        // Stable partition: preserve each group's order; a custom order is never reset.
        portfolio.drawdown = portfolio.drawdownSort === 'custom' ? rows : rows.filter(row => row.source === 'holding').concat(rows.filter(row => row.source !== 'holding'));
        return portfolio.drawdown;
    }

    function metrics(row) {
        const high = positive(row.high), current = positive(row.current);
        if (!high || !current) return { ready: false, drop: null, next: null, distance: null, target: null, progress: 0 };
        const drop = (high - current) / high * 100;
        const next = levels.find(level => drop < level) || null;
        const previous = levels.filter(level => drop >= level).pop() || 0;
        return {
            ready: true, drop, next,
            distance: next === null ? 0 : next - drop,
            target: next === null ? null : high * (1 - next / 100),
            progress: next === null ? 100 : Math.max(0, Math.min(100, (drop - previous) / (next - previous) * 100))
        };
    }

    // Reorder only visible slots, so filtering cannot drop or move hidden rows accidentally.
    function reorderVisible(rows, ids) {
        const selected = new Set(ids);
        const byId = new Map(rows.map(row => [row.id, row]));
        if (selected.size !== ids.length || ids.some(id => !byId.has(id))) return rows;
        let index = 0;
        return rows.map(row => selected.has(row.id) ? byId.get(ids[index++]) : row);
    }
    return { levels, symbol, holdings, sync, metrics, reorderVisible };
});
