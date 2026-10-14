(function() {
    const el = id => document.getElementById(id);
    function text(value, unit, decimals, signed) {
        if (!Number.isFinite(value)) return '—';
        if (isPrivacyMode) return '••••';
        return (value < 0 ? '−' : signed ? '+' : '') + ({ USD: '$', CNY: '¥' }[unit] || '') + Math.abs(value).toFixed(decimals) + (unit === '%' ? '%' : '');
    }
    function metric(id, value, unit, decimals = 0, {signed = true, neutral = false, refresh = false} = {}) {
        const node = el(id);
        if (!node) return;
        if (node.animationId) cancelAnimationFrame(node.animationId);
        node.refreshAnimation?.cancel();
        const previous = Number(node.dataset.displayValue || 0), valid = Number.isFinite(value);
        node.classList.toggle('positive', !neutral && valid && value >= 0);
        node.classList.toggle('negative', !neutral && valid && value < 0);
        node.style.color = !valid ? 'var(--text-secondary)' : neutral ? 'var(--text-primary)' : value < 0 ? 'var(--negative)' : 'var(--positive)';
        node.style.backgroundColor = 'transparent';
        node.dataset.value = valid ? value : '';
        if (!valid || isPrivacyMode) { node.textContent = !valid && unit === '%' && id.endsWith('-pct') ? '' : text(value, unit, decimals, signed); node.animationId = null; return; }
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (refresh && !reduced) node.refreshAnimation = node.animate([{opacity:.6},{opacity:1}], {duration:350,easing:'ease-out'});
        if (reduced || previous === value) {
            node.textContent = text(value, unit, decimals, signed); node.dataset.displayValue = value; node.animationId = null; return;
        }
        let start;
        const tick = now => {
            if (isPrivacyMode) { node.textContent = '••••'; node.animationId = null; return; }
            start ??= now;
            const progress = Math.min((now - start) / 450, 1), current = previous + (value - previous) * (1 - Math.pow(1 - progress, 3));
            node.dataset.displayValue = current; node.textContent = text(current, unit, decimals, signed);
            node.animationId = progress < 1 ? requestAnimationFrame(tick) : null;
        };
        node.animationId = requestAnimationFrame(tick);
    }
    window.renderOverviewPerformance = function(refresh = false) {
        const snapshot = PortfolioModel.snapshot(state, el('fx-rate').value), summary = PerformanceModel.summary(state, nwRangeDays).total, risk = PerformanceModel.riskSummary(state, nwRangeDays);
        metric('total-nw-cny', snapshot.positions.reduce((sum,item) => sum + item.converted,0), 'CNY', 0, {signed:false,neutral:true,refresh});
        const now = new Date(), date = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'), today = state.history.find(row => row.date === date);
        metric('today-pl-val', Number.isFinite(today?.pl) ? today.pl : null, 'CNY', 0, {refresh});
        metric('today-pl-pct', Number.isFinite(today?.rate) ? today.rate : null, '%', 2, {refresh});
        ['usd', 'cn'].forEach(type => {
            const rows = snapshot.positions.filter(item => (item.type === 'sgov' ? 'usd' : item.type) === type);
            const profit = rows.reduce((sum, item) => sum + item.profit, 0), cost = rows.reduce((sum, item) => sum + item.costValue, 0);
            metric(type === 'usd' ? 'us-pl-value' : 'cn-pl-value', profit, type === 'usd' ? 'USD' : 'CNY', 0, {refresh});
            metric(type === 'usd' ? 'us-pl-pct' : 'cn-pl-pct', cost > 0 ? profit / cost * 100 : null, '%', 2, {refresh});
        });
        metric('total-unrealized-pl-val', summary.profit, 'CNY', 0, {refresh});
        metric('total-unrealized-pl-pct', summary.rate, '%', 2, {refresh});
        metric('nw-max-drawdown', risk.drawdown, '%', 2, {signed:false,neutral:true,refresh});
        metric('nw-drawdown-amount', risk.amount, 'CNY', 0, {signed:false,neutral:true,refresh});
        metric('nw-volatility', risk.volatility, '%', 2, {signed:false,neutral:true,refresh});
        el('nw-drawdown-amount').title = risk.amount === null ? '区间记录不足' : risk.from ? risk.from+' → '+risk.to+'，与回撤百分比对应的资产减少额，包含资金进出的影响' : '所选区间未出现资产回落';
    };
    const originalChart = renderNetWorthChart;
    renderNetWorthChart = function(force) { originalChart(force); renderOverviewPerformance(!!force); };
    const originalApply = applyRemoteState;
    applyRemoteState = function(remote) { return originalApply({ ...remote, history: PerformanceModel.mergeRecords(state.history, remote.history) }); };
})();
