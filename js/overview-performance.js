(function() {
    const el = id => document.getElementById(id);
    function text(value, unit, decimals = 0) {
        if (!Number.isFinite(value)) return '—';
        if (isPrivacyMode) return '••••';
        return (value < 0 ? '−' : '+') + ({ USD: '$', CNY: '¥' }[unit] || '') + Math.abs(value).toFixed(decimals) + (unit === '%' ? '%' : '');
    }
    function metric(id, value, unit, decimals = 0) {
        const node = el(id);
        if (!node) return;
        if (node.animationId) cancelAnimationFrame(node.animationId);
        const previous = Number(node.dataset.displayValue || 0), valid = Number.isFinite(value);
        node.classList.toggle('positive', valid && value >= 0);
        node.classList.toggle('negative', valid && value < 0);
        node.style.color = !valid ? 'var(--text-secondary)' : value < 0 ? 'var(--negative)' : 'var(--positive)';
        node.style.backgroundColor = 'transparent';
        node.dataset.value = valid ? value : '';
        if (!valid || isPrivacyMode) { node.textContent = !valid && unit === '%' ? '' : text(value, unit, decimals); node.animationId = null; return; }
        if (matchMedia('(prefers-reduced-motion: reduce)').matches || previous === value) {
            node.textContent = text(value, unit, decimals); node.dataset.displayValue = value; node.animationId = null; return;
        }
        let start;
        const tick = now => {
            if (isPrivacyMode) { node.textContent = '••••'; node.animationId = null; return; }
            start ??= now;
            const progress = Math.min((now - start) / 450, 1), current = previous + (value - previous) * (1 - Math.pow(1 - progress, 3));
            node.dataset.displayValue = current; node.textContent = text(current, unit, decimals);
            node.animationId = progress < 1 ? requestAnimationFrame(tick) : null;
        };
        node.animationId = requestAnimationFrame(tick);
    }
    // Current holdings profit is independent of the asset chart's selected range.
    window.renderOverviewPerformance = function() {
        const snapshot = PortfolioModel.snapshot(state, el('fx-rate').value);
        ['usd', 'cn'].forEach(type => {
            const rows = snapshot.positions.filter(item => (item.type === 'sgov' ? 'usd' : item.type) === type);
            const profit = rows.reduce((sum, item) => sum + item.profit, 0), cost = rows.reduce((sum, item) => sum + item.costValue, 0);
            metric(type === 'usd' ? 'us-pl-value' : 'cn-pl-value', profit, type === 'usd' ? 'USD' : 'CNY');
            metric(type === 'usd' ? 'us-pl-pct' : 'cn-pl-pct', cost > 0 ? profit / cost * 100 : null, '%', 2);
        });
        const cost = Math.round(snapshot.positions.reduce((sum, item) => sum + item.costValue * (item.currency === 'USD' ? snapshot.fx : 1), 0) + snapshot.cash.reduce((sum, item) => sum + item.converted, 0));
        const profit = Math.round(snapshot.total) - cost;
        metric('total-unrealized-pl-val', profit, 'CNY');
        metric('total-unrealized-pl-pct', cost > 0 ? profit / cost * 100 : null, '%', 2);
    };
    const originalCalculate = calculate;
    calculate = function() { originalCalculate(); renderOverviewPerformance(); };
    const originalApply = applyRemoteState;
    applyRemoteState = function(remote) { return originalApply({ ...remote, history: PerformanceModel.mergeRecords(state.history, remote.history) }); };
})();
