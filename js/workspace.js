/* Presentation layer: focused workspaces, read/edit modes and portfolio insights. */
(function () {
    const el = id => document.getElementById(id);
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const money = (value, currency = 'CNY', decimals = 0) => isPrivacyMode ? '••••' : ({ CNY: '¥', USD: '$', HKD: 'HK$' }[currency] || currency + ' ') + Number(value).toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
    const arrow = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    let currentPanel = 'overview', market = 'all', editingHoldings = false, editingReferences = false;

    window.navigateWorkspace = (name, updateHash = true) => {
        if (!['overview', 'holdings', 'drawdown', 'activity'].includes(name)) name = 'overview';
        currentPanel = name;
        document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
        document.querySelectorAll('[data-workspace]').forEach(link => {
            const active = link.dataset.workspace === name;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        if (updateHash && location.hash !== '#' + name) history.pushState(null, '', '#' + name);
        if (name === 'overview') requestAnimationFrame(() => charts.networth?.resize());
        closePopover(); closeAllCcyMenus();
    };
    window.setHoldingMarket = value => { market = value; applyMarketFilter(); };
    function applyMarketFilter() {
        document.querySelectorAll('.holding-group').forEach(group => { group.hidden = market !== 'all' && group.dataset.type !== market; });
        document.querySelectorAll('[data-holding-filter]').forEach(button => {
            const active = button.dataset.holdingFilter === market;
            button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
        });
    }
    window.toggleHoldingsEdit = force => {
        editingHoldings = typeof force === 'boolean' ? force : !editingHoldings;
        el('panel-holdings').classList.toggle('is-editing', editingHoldings);
        el('edit-holdings').setAttribute('aria-pressed', String(editingHoldings));
        el('edit-holdings').querySelector('span').textContent = editingHoldings ? 'Done editing' : 'Edit positions';
        el('holding-edit-hint').hidden = !editingHoldings;
        document.querySelectorAll('#panel-holdings input[data-field]').forEach(input => {
            input.readOnly = !editingHoldings || (isPrivacyMode && ['shares', 'amount'].includes(input.dataset.field));
            const item = state[input.dataset.type]?.find(item => String(item.id) === input.dataset.id);
            input.setAttribute('aria-label', `${input.dataset.field} for ${item?.ticker || 'new position'}`);
        });
        document.querySelectorAll('#panel-holdings .ccy-select-btn').forEach(button => { button.disabled = !editingHoldings; });
        document.querySelectorAll('#panel-holdings .delete-trigger').forEach(button => {
            button.setAttribute('role', 'button'); button.setAttribute('tabindex', editingHoldings ? '0' : '-1');
            button.setAttribute('aria-label', 'Delete ' + button.closest('.pro-grid-row, .cash-grid-row').querySelector('input[data-field="ticker"]').value);
            if (!button.dataset.keyboardReady) {
                button.dataset.keyboardReady = 'true';
                button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
            }
        });
        ['usd', 'cn', 'sgov', 'cash'].forEach(type => Sortable.get(el(type + '-inputs'))?.option('disabled', !editingHoldings || !!el('holdings-search').value.trim()));
    };
    window.toggleReferenceEdit = force => {
        editingReferences = typeof force === 'boolean' ? force : !editingReferences;
        el('panel-drawdown').classList.toggle('is-editing', editingReferences);
        el('edit-references').setAttribute('aria-pressed', String(editingReferences));
        el('edit-references').querySelector('span').textContent = editingReferences ? 'Done editing' : 'Edit references';
        document.querySelectorAll('#drawdown-list input').forEach(input => {
            const row = state.drawdown.find(row => row.id === input.dataset.id);
            input.readOnly = !editingReferences || (input.dataset.field === 'symbol' && row?.source === 'holding');
            if (input.dataset.field === 'high' && !row?.high && !input.dataset.editShortcut) {
                input.dataset.editShortcut = 'true';
                input.addEventListener('click', () => { toggleReferenceEdit(true); input.focus(); });
                input.title = 'Click to set your reference high';
            }
        });
    };
    window.openPortfolioPosition = symbol => {
        navigateWorkspace('holdings'); setHoldingMarket('all');
        el('holdings-search').value = symbol;
        el('holdings-search').dispatchEvent(new Event('input'));
    };
    window.openRiskPosition = symbol => {
        navigateWorkspace('drawdown'); setDrawdownFilter('all');
        el('dd-search').value = symbol;
        el('dd-search').dispatchEvent(new Event('input'));
    };

    function portfolioValues() {
        const fx = Number(el('fx-rate').value) || 7.25;
        const types = ['usd', 'cn', 'sgov'];
        const positions = types.flatMap(type => state[type].filter(item => item.shares > 0).map(item => ({ ...item, type, currency: type === 'cn' ? 'CNY' : 'USD', value: item.shares * item.price, converted: item.shares * item.price * (type === 'cn' ? 1 : fx) })));
        const values = [
            { type: 'usd', label: 'US equities', color: '#284e42', value: positions.filter(item => item.type === 'usd').reduce((sum, item) => sum + item.converted, 0) },
            { type: 'cn', label: 'China equities', color: '#b69c69', value: positions.filter(item => item.type === 'cn').reduce((sum, item) => sum + item.converted, 0) },
            { type: 'sgov', label: 'Treasury ETF', color: '#8fa994', value: positions.filter(item => item.type === 'sgov').reduce((sum, item) => sum + item.converted, 0) },
            { type: 'cash', label: 'Cash', color: '#d3d9ce', value: state.cash.reduce((sum, item) => sum + item.amount * (item.currency === 'USD' ? fx : item.currency === 'HKD' ? state.hkdFx || 0.93 : 1), 0) }
        ];
        const total = values.reduce((sum, item) => sum + item.value, 0);
        return { positions, values, total, fx };
    }
    updateRowValues = function (type, items, totalValue, symbol) {
        items.forEach(item => {
            const value = item.shares * item.price, cost = item.shares * (item.cost || 0), profit = value - cost;
            const valueEl = el(`val-${type}-${item.id}`), profitEl = el(`pl-${type}-${item.id}`), weightEl = el(`alloc-${type}-${item.id}`);
            if (valueEl) valueEl.textContent = money(value, type === 'cn' ? 'CNY' : 'USD', 2);
            if (weightEl) weightEl.textContent = (totalValue ? value / totalValue * 100 : 0).toFixed(1) + '%';
            if (profitEl) {
                profitEl.className = 'holding-pl ' + (profit < -.01 ? 'negative' : profit > .01 ? 'positive' : '');
                profitEl.innerHTML = cost > 0 ? `<strong>${isPrivacyMode ? '••••' : (profit >= 0 ? '+' : '−') + money(Math.abs(profit), type === 'cn' ? 'CNY' : 'USD')}</strong><small>${profit >= 0 ? '+' : '−'}${Math.abs(profit / cost * 100).toFixed(2)}%</small>` : '<span class="muted">—</span>';
            }
        });
    };
    const originalCashValues = updateCashRowValues;
    updateCashRowValues = function (total, fx, hkdFx) {
        originalCashValues(total, fx, hkdFx);
        state.cash.forEach(item => { const value = el('val-cash-' + item.id); if (value) value.textContent = money(item.amount, item.currency || 'CNY', 2); });
    };
    function renderAllocation() {
        const { values, total, fx } = portfolioValues();
        el('allocation-bar').innerHTML = values.map(item => `<span style="width:${total ? item.value / total * 100 : 25}%;background:${item.color}" title="${item.label}"></span>`).join('');
        el('allocation-breakdown').innerHTML = values.map(item => {
            const pct = total > 0 ? item.value / total * 100 : 0;
            return `<button class="allocation-item" data-market="${item.type}"><span class="allocation-item-label"><i style="background:${item.color}"></i>${item.label}</span><b>${pct.toFixed(1)}%</b><span class="allocation-amount">${money(item.value)}</span><span class="allocation-mini-bar"><i style="width:${pct}%;background:${item.color}"></i></span></button>`;
        }).join('');
        el('allocation-breakdown').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { navigateWorkspace('holdings'); el('holdings-search').value = ''; el('holdings-search').dispatchEvent(new Event('input')); setHoldingMarket(button.dataset.market); }));
        el('footer-fx').textContent = 'USD/CNY ' + fx.toFixed(4);
        const stamp = Number(state.lastSavedAt);
        el('snapshot-date').textContent = stamp > 0 ? 'As of ' + new Date(stamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Local portfolio snapshot';
        document.body.classList.toggle('privacy-mode', isPrivacyMode);
    }
    renderVooQqqm = function () {
        const { positions, total } = portfolioValues();
        const top = positions.sort((a, b) => b.converted - a.converted).slice(0, 5);
        el('vooqqqm-rows').innerHTML = top.map(item => {
            const cost = item.shares * (item.cost || 0), pct = cost > 0 ? (item.value / cost - 1) * 100 : 0;
            const icon = document.querySelector(`#${item.type}-inputs input[data-id="${CSS.escape(String(item.id))}"][data-field="ticker"]`)?.parentElement.querySelector('.holding-icon');
            return `<button class="position-item" data-symbol="${escapeHTML(item.ticker)}"><span class="position-symbol"><span class="position-logo">${icon?.innerHTML || escapeHTML(item.ticker.slice(0, 1))}</span><span><b>${escapeHTML(item.ticker)}</b><small>${({ usd: 'US equity · USD', cn: 'China equity · CNY', sgov: 'Treasury ETF · USD' })[item.type]}</small></span></span><span class="position-value">${money(item.value, item.currency, 2)}</span><span class="position-return ${cost > 0 ? pct < 0 ? 'negative' : 'positive' : ''}">${cost > 0 ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}</span><span class="position-weight">${total ? (item.converted / total * 100).toFixed(1) : '0.0'}%</span></button>`;
        }).join('') || '<div class="empty-state">Add your first holding to see your portfolio here.</div>';
        el('vooqqqm-rows').querySelectorAll('button').forEach(button => button.addEventListener('click', () => openPortfolioPosition(button.dataset.symbol)));
        el('vooqqqm-rows').querySelectorAll('img').forEach(img => {
            const fallback = () => { img.closest('.position-logo').textContent = img.closest('[data-symbol]')?.dataset.symbol?.slice(0, 1) || '·'; };
            img.addEventListener('error', fallback, { once: true });
            if (img.complete && !img.naturalWidth) fallback();
        });
    };
    renderDDAlerts = function () {
        const rows = DrawdownModel.sync(state).map(row => ({ row, data: DrawdownModel.metrics(row) }));
        const ready = rows.filter(item => item.data.ready).sort((a, b) => b.data.drop - a.data.drop);
        const count = ready.filter(item => item.data.drop >= 5).length;
        const pending = rows.filter(item => !item.row.high).length;
        el('alert-count').textContent = count + ' to watch';
        el('nav-risk-count').textContent = count || '';
        el('risk-reference-hint').textContent = pending ? `${pending} reference highs to set` : 'All reference highs set';
        el('risk-held-count').textContent = rows.filter(item => item.row.source === 'holding').length;
        el('risk-watch-count').textContent = rows.filter(item => item.row.source === 'watchlist').length;
        el('risk-alert-count').textContent = count;
        el('risk-pending-count').textContent = pending;
        el('dd-alert-list').innerHTML = ready.slice(0, 3).map(({ row, data }) => `<button class="risk-position" data-symbol="${escapeHTML(row.symbol)}"><span class="risk-position-top"><span><b>${escapeHTML(row.symbol)}</b><small>${row.source === 'holding' ? 'Holding' : 'Watchlist'}</small></span><strong>${data.drop > 0 ? '−' : '+'}${Math.abs(data.drop).toFixed(2)}%</strong></span><span class="risk-track"><i style="width:${Math.max(0, Math.min(100, data.drop / 30 * 100))}%"></i></span><span class="risk-level">${data.next === null ? '30% level reached' : `Next −${data.next}% level`}<b>${data.next === null ? 'Review reference' : money(data.target, row.currency, 2)}</b></span></button>`).join('') || '<div class="risk-empty">Set your reference highs to start monitoring price levels.</div>';
        el('dd-alert-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => openRiskPosition(button.dataset.symbol)));
    };

    // Keep the existing return / drawdown calculations; restyle the real chart.
    const originalNetWorth = renderNetWorthChart;
    renderNetWorthChart = function (force) {
        originalNetWorth(force);
        const chart = charts.networth;
        if (!chart) return;
        const dark = document.documentElement.classList.contains('dark');
        chart.data.datasets[0].borderColor = dark ? '#a7c2a2' : '#476c51';
        chart.data.datasets[0].borderWidth = 2;
        chart.data.datasets[0].fill = true;
        chart.data.datasets[0].backgroundColor = context => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'transparent';
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, dark ? 'rgba(143,174,141,.18)' : 'rgba(126,153,106,.18)');
            gradient.addColorStop(1, dark ? 'rgba(143,174,141,0)' : 'rgba(126,153,106,.01)');
            return gradient;
        };
        chart.data.datasets[0].pointHoverBackgroundColor = dark ? '#a7c2a2' : '#476c51';
        chart.options.animation = { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350 };
        chart.options.scales.x.border = { display: false };
        chart.options.scales.x.ticks = { maxTicksLimit: chart.width < 500 ? 4 : 7, maxRotation: 0, color: dark ? '#95a196' : '#8a928a', padding: 12, font: { family: 'Inter', size: 11 } };
        chart.options.onResize = (chart, size) => { chart.options.scales.x.ticks.maxTicksLimit = size.width < 500 ? 4 : 7; };
        chart.options.scales.y.position = 'right';
        chart.options.scales.y.border = { display: false };
        chart.options.scales.y.grid = { color: dark ? '#2d372e' : '#e9ece5', drawTicks: false };
        chart.options.scales.y.ticks = { maxTicksLimit: 5, color: dark ? '#95a196' : '#8a928a', padding: 12, font: { family: 'Inter', size: 11 }, callback: value => isPrivacyMode ? '••••' : '¥' + (value / 1000).toFixed(0) + 'k' };
        chart.options.plugins.tooltip = {
            enabled: !isPrivacyMode, mode: 'index', intersect: false, displayColors: false,
            backgroundColor: dark ? '#e5ece2' : '#263d31', titleColor: dark ? '#1d2c21' : '#c9d6c7', bodyColor: dark ? '#1d2c21' : '#ffffff',
            padding: 12, cornerRadius: 8, bodyFont: { family: 'Inter', size: 14, weight: '600' }, titleFont: { family: 'Inter', size: 11 },
            callbacks: { label: context => money(context.raw, 'CNY', 2) }
        };
        chart.update('none');
        const historyRecords = state.history.slice().sort((a, b) => a.date.localeCompare(b.date));
        el('history-caption').textContent = chart.data.labels.length + ' recorded days · ' + historyRecords[historyRecords.length - 1]?.date;
    };
    const originalRange = setNwRange;
    setNwRange = function (days) {
        originalRange(days);
        el('hero-period-label').textContent = ({ 30: '1 month', 90: '3 months', 365: '1 year', 0: 'All time' })[days];
        document.querySelectorAll('.nw-range-btn').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.range) === days)));
    };
    const originalRenderAll = renderAllRows;
    renderAllRows = function () { originalRenderAll(); toggleHoldingsEdit(editingHoldings); applyMarketFilter(); };
    const originalDrawdown = renderDrawdown;
    renderDrawdown = function () { originalDrawdown(); toggleReferenceEdit(editingReferences); renderDDAlerts(); };
    const originalCalculate = calculate;
    calculate = function () { originalCalculate(); renderAllocation(); renderDDAlerts(); toggleHoldingsEdit(editingHoldings); applyMarketFilter(); };
    const originalAdd = addItem;
    addItem = function (type) { toggleHoldingsEdit(true); originalAdd(type); applyMarketFilter(); el(type + '-inputs').querySelector('.pro-grid-row:last-child input[data-field="ticker"], .cash-grid-row:last-child input[data-field="ticker"]')?.focus(); };
    const originalAddDrawdown = addNewDrawdownRow;
    addNewDrawdownRow = function () { toggleReferenceEdit(true); originalAddDrawdown(); };
    const originalTicker = loadTradingViewTicker;
    loadTradingViewTicker = function () { if (localStorage.getItem('assethub_market_ticker') === 'true') originalTicker(); };
    window.toggleMarketTicker = enabled => {
        localStorage.setItem('assethub_market_ticker', String(enabled));
        el('tv-ticker-container').hidden = !enabled;
        document.body.classList.toggle('has-market-ticker', enabled);
        if (enabled) loadTradingViewTicker(); else el('tv-ticker-container').replaceChildren();
    };
    const originalInit = initSortable;
    initSortable = function () { originalInit(); toggleHoldingsEdit(editingHoldings); };
    const originalOnload = window.onload;
    window.onload = async function () {
        document.querySelectorAll('[data-workspace]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); navigateWorkspace(link.dataset.workspace); }));
        window.addEventListener('popstate', () => navigateWorkspace(location.hash.slice(1), false));
        window.addEventListener('hashchange', () => navigateWorkspace(location.hash.slice(1), false));
        window.addEventListener('keydown', event => { if (event.key === 'Escape') { document.activeElement?.blur(); toggleHoldingsEdit(false); toggleReferenceEdit(false); closePopover(); closeAllCcyMenus(); } });
        navigateWorkspace(location.hash.slice(1), false);
        el('holdings-search').addEventListener('input', () => { toggleHoldingsEdit(editingHoldings); applyMarketFilter(); });
        await originalOnload();
        toggleHoldingsEdit(false); toggleReferenceEdit(false); applyMarketFilter(); renderAllocation(); renderDDAlerts();
        const ticker = localStorage.getItem('assethub_market_ticker') === 'true';
        el('ticker-toggle').checked = ticker; el('tv-ticker-container').hidden = !ticker;
        document.body.classList.toggle('has-market-ticker', ticker);
    };
})();
