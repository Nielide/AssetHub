/* Presentation layer: focused workspaces, read/edit modes and portfolio insights. */
(function () {
    const el = id => document.getElementById(id);
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const money = (value, currency = 'CNY', decimals = 0) => isPrivacyMode ? '••••' : ({ CNY: '¥', USD: '$', HKD: 'HK$' }[currency] || currency + ' ') + Number(value).toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
    const arrow = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    let currentPanel = 'overview', market = 'all', editingHoldings = false, editingReferences = false, positionView = 'value';
    window.setPositionView = value => {
        positionView = value === 'return' ? 'return' : 'value';
        renderVooQqqm();
    };

    window.navigateWorkspace = (name, updateHash = true) => {
        const route = name;
        if (name.startsWith('asset/')) {
            try {
                const asset = decodeURIComponent(name.slice(6)).toUpperCase();
                if (/^(USD|CNY|HKD):[A-Z0-9][A-Z0-9.\-:]{0,23}$/.test(asset)) { window.assetRoute = asset; name = 'asset'; }
                else name = 'overview';
            } catch { name = 'overview'; }
        }
        if (!['overview', 'holdings', 'drawdown', 'activity', 'transactions', 'asset'].includes(name)) name = 'overview';
        currentPanel = name;
        document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
        document.querySelectorAll('[data-workspace]').forEach(link => {
            const active = link.dataset.workspace === name || (name === 'asset' && link.dataset.workspace === 'holdings');
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        if (updateHash && location.hash !== '#' + route) history.pushState(null, '', '#' + route);
        if (name === 'overview') requestAnimationFrame(() => charts.networth?.resize());
        if (name === 'asset' && window.renderAssetDetail) renderAssetDetail();
        if (name === 'transactions' && window.renderTransactions) renderTransactions();
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
        el('edit-holdings').querySelector('span').textContent = editingHoldings ? '完成' : '编辑持仓';
        document.querySelectorAll('#panel-holdings input[data-field]').forEach(input => {
            input.readOnly = !editingHoldings || (isPrivacyMode && ['shares', 'amount'].includes(input.dataset.field));
            const item = state[input.dataset.type]?.find(item => String(item.id) === input.dataset.id);
            input.setAttribute('aria-label', `${item?.ticker || '新持仓'}${({ticker:'代码',shares:'数量',cost:'成本',price:'现价',amount:'余额'})[input.dataset.field] || input.dataset.field}`);
        });
        document.querySelectorAll('#panel-holdings .ccy-select-btn').forEach(button => { button.disabled = !editingHoldings; });
        document.querySelectorAll('#panel-holdings .delete-trigger').forEach(button => {
            button.setAttribute('role', 'button'); button.setAttribute('tabindex', editingHoldings ? '0' : '-1');
            button.setAttribute('aria-label', '删除 ' + button.closest('.pro-grid-row, .cash-grid-row').querySelector('input[data-field="ticker"]').value);
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
        el('edit-references').querySelector('span').textContent = editingReferences ? '完成' : '编辑';
        document.querySelectorAll('#drawdown-list input').forEach(input => {
            const row = state.drawdown.find(row => row.id === input.dataset.id);
            input.readOnly = !editingReferences || (input.dataset.field === 'symbol' && row?.source === 'holding');
            if (input.dataset.field === 'high' && !row?.high && !input.dataset.editShortcut) {
                input.dataset.editShortcut = 'true';
                input.addEventListener('click', () => { toggleReferenceEdit(true); input.focus(); });
                input.title = '设置参考高点';
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

    function portfolioValues() { return PortfolioModel.snapshot(state, el('fx-rate').value); }
    updateRowValues = function (type, items, totalValue, symbol) {
        const snapshot = portfolioValues();
        items.forEach(item => {
            const value = item.shares * item.price, cost = item.shares * (item.cost || 0), profit = value - cost;
            const valueEl = el(`val-${type}-${item.id}`), profitEl = el(`pl-${type}-${item.id}`), weightEl = el(`alloc-${type}-${item.id}`);
            if (valueEl) valueEl.textContent = money(value, type === 'cn' ? 'CNY' : 'USD', 2);
            if (weightEl) weightEl.textContent = (snapshot.total ? value * (type === 'cn' ? 1 : snapshot.fx) / snapshot.total * 100 : 0).toFixed(1) + '%';
            document.querySelectorAll(`#${type}-inputs input[data-id="${CSS.escape(String(item.id))}"]`).forEach(input => {
                if (input !== document.activeElement) input.value = input.dataset.field === 'shares' ? Number(item.shares || 0).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : item[input.dataset.field] ?? '';
            });
            if (profitEl) {
                profitEl.className = 'holding-pl ' + (profit < -.01 ? 'negative' : profit > .01 ? 'positive' : '');
                profitEl.innerHTML = cost > 0 ? `<strong>${isPrivacyMode ? '••••' : (profit >= 0 ? '+' : '−') + money(Math.abs(profit), type === 'cn' ? 'CNY' : 'USD')}</strong><small>${profit >= 0 ? '+' : '−'}${Math.abs(profit / cost * 100).toFixed(2)}%</small>` : '<span class="muted">—</span>';
            }
        });
    };
    const originalCashValues = updateCashRowValues;
    updateCashRowValues = function (total, fx, hkdFx) {
        originalCashValues(total, fx, hkdFx);
        portfolioValues().cash.forEach(item => {
            const value = el('val-cash-' + item.id), weight = el('alloc-cash-' + item.id);
            if (value) value.textContent = money(item.amount, item.currency, 2);
            if (weight) weight.textContent = item.weight.toFixed(1) + '%';
            document.querySelectorAll(`#cash-inputs input[data-id="${CSS.escape(String(item.id))}"]`).forEach(input => { if (input !== document.activeElement) input.value = item[input.dataset.field] ?? ''; });
        });
    };
    function renderAllocation() {
        const { positions, values, total, fx } = portfolioValues();
        const core = positions.filter(item => ['VOO', 'QQQM'].includes(String(item.ticker).trim().toUpperCase())).reduce((sum, item) => sum + item.converted, 0);
        const liquid = values.filter(item => ['sgov', 'cash'].includes(item.type)).reduce((sum, item) => sum + item.value, 0);
        el('core-weight').textContent = isPrivacyMode ? '••••' : (total ? core / total * 100 : 0).toFixed(1) + '%';
        el('liquid-weight').textContent = isPrivacyMode ? '••••' : (total ? liquid / total * 100 : 0).toFixed(1) + '%';
        el('allocation-bar').innerHTML = values.map(item => `<span style="width:${total ? item.value / total * 100 : 25}%;background:${item.color}" title="${item.label}"></span>`).join('');
        el('allocation-breakdown').innerHTML = values.map(item => {
            const pct = total > 0 ? item.value / total * 100 : 0;
            const currency = item.type === 'cn' ? 'CNY' : item.type === 'cash' ? '多币种' : 'USD';
            const count = item.type === 'cash' ? state.cash.length : positions.filter(position => position.type === item.type).length;
            return `<button class="allocation-item" data-market="${item.type}"><span class="allocation-group-label"><b>${item.label}</b><small>${count} ${item.type === 'cash' ? '笔' : '只'} · ${currency}</small></span><span class="allocation-group-value"><b>${money(item.value)}</b><small>${pct.toFixed(1)}%</small></span><span class="allocation-chevron" aria-hidden="true">›</span></button>`;
        }).join('');
        el('allocation-breakdown').querySelectorAll('button').forEach(button => button.addEventListener('click', () => { navigateWorkspace('holdings'); el('holdings-search').value = ''; el('holdings-search').dispatchEvent(new Event('input')); setHoldingMarket(button.dataset.market); }));
        portfolioValues().currencies.forEach(item => {
            const weight = el('currency-weight-' + item.currency.toLowerCase());
            weight.textContent = isPrivacyMode ? '••••' : item.weight.toFixed(1) + '%';
            weight.nextElementSibling.querySelector('em').style.width = item.weight + '%';
        });
        const stamp = Number(state.lastSavedAt);
        el('snapshot-date').textContent = stamp > 0 ? '更新 ' + new Date(stamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '本机数据';
        document.body.classList.toggle('privacy-mode', isPrivacyMode);
        document.querySelector('.privacy-button').setAttribute('aria-pressed', String(isPrivacyMode));
    }
    renderVooQqqm = function () {
        const { positions, total } = portfolioValues();
        const returnRate = item => item.cost > 0 ? item.price / item.cost - 1 : -Infinity;
        const ranked = positionView === 'return' ? positions.filter(item => item.cost > 0).sort((a, b) => returnRate(b) - returnRate(a) || b.converted - a.converted) : positions.sort((a, b) => b.converted - a.converted);
        const top = ranked.slice(0, 5);
        el('positions-title').textContent = positionView === 'return' ? '收益排行' : '持仓';
        document.querySelectorAll('[data-position-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.positionView === positionView)));
        el('vooqqqm-rows').classList.toggle('is-return-ranking', positionView === 'return');
        el('vooqqqm-rows').innerHTML = top.map((item, index) => {
            const cost = item.shares * (item.cost || 0), pct = cost > 0 ? (item.value / cost - 1) * 100 : 0;
            const icon = document.querySelector(`#${item.type}-inputs input[data-id="${CSS.escape(String(item.id))}"][data-field="ticker"]`)?.parentElement.querySelector('.holding-icon');
            const weight = total ? item.converted / total * 100 : 0;
            const quantity = isPrivacyMode ? '••••' : Number(item.shares).toLocaleString('en-US', { maximumFractionDigits: 6 });
            return `<button class="position-item" data-symbol="${escapeHTML(item.ticker)}" data-currency="${item.currency}" data-id="${escapeHTML(item.id)}" data-type="${item.type}"><span class="position-symbol">${positionView === 'return' ? '<span class="position-rank">' + (index + 1) + '</span>' : ''}<span class="position-logo">${icon?.innerHTML || escapeHTML(item.ticker.slice(0, 1))}</span><b>${escapeHTML(item.ticker)}</b></span><span class="position-quantity" data-label="股数">${quantity}</span><span class="position-cost" data-label="成本">${money(item.cost, item.currency, item.type === 'cn' ? 3 : 2)}</span><span class="position-price" data-label="现价">${money(item.price, item.currency, item.type === 'cn' ? 3 : 2)}</span><span class="position-value" data-label="市值">${money(item.value, item.currency, 2)}</span><span class="position-return ${cost > 0 ? pct < 0 ? 'negative' : 'positive' : ''}"><b>${cost > 0 ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}</b><small>${cost > 0 ? (isPrivacyMode ? '••••' : (pct >= 0 ? '+' : '−') + money(Math.abs(item.value - cost), item.currency)) : '—'}</small></span><span class="position-weight"><b>${weight.toFixed(1)}%</b><span class="weight-track"><i style="width:${weight}%;"></i></span></span></button>`;
        }).join('') || '<div class="empty-state">暂无持仓</div>';
        el('vooqqqm-rows').querySelectorAll('button').forEach(button => button.addEventListener('click', () => window.openAssetDetail ? openAssetDetail(button.dataset.symbol, button.dataset.currency) : openPortfolioPosition(button.dataset.symbol)));
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
        const coverage = rows.length - pending;
        el('risk-coverage-label').textContent = `高点 ${coverage}/${rows.length}`;
        el('risk-coverage-progress').style.width = (rows.length ? coverage / rows.length * 100 : 0) + '%';
        el('alert-count').textContent = count + ' 项';
        el('nav-risk-count').textContent = count || '';
        el('risk-reference-hint').textContent = pending ? `${pending} 项待设高点` : '';
        el('risk-held-count').textContent = rows.filter(item => item.row.source === 'holding').length;
        el('risk-watch-count').textContent = rows.filter(item => item.row.source === 'watchlist').length;
        el('risk-alert-count').textContent = count;
        el('risk-pending-count').textContent = pending;
        el('dd-alert-list').innerHTML = ready.slice(0, 3).map(({ row, data }) => `<button class="risk-position" data-symbol="${escapeHTML(row.symbol)}"><span class="risk-position-top"><span><b>${escapeHTML(row.symbol)}</b><small>${row.source === 'holding' ? '持仓' : '自选'}</small></span><strong>${data.drop > 0 ? '−' : '+'}${Math.abs(data.drop).toFixed(2)}%</strong></span><span class="risk-track"><i style="width:${Math.max(0, Math.min(100, data.drop / 30 * 100))}%"></i></span><span class="risk-level">${data.next === null ? '已达 −30%' : `下一档 −${data.next}%`}<b>${data.next === null ? '—' : money(data.target, row.currency, 2)}</b></span></button>`).join('') || '<div class="risk-empty">暂无回撤数据</div>';
        el('dd-alert-list').querySelectorAll('button').forEach(button => button.addEventListener('click', () => openRiskPosition(button.dataset.symbol)));
    };

    // Keep the existing return / drawdown calculations; restyle the real chart.
    const originalNetWorth = renderNetWorthChart;
    renderNetWorthChart = function (force) {
        originalNetWorth(force);
        const chart = charts.networth;
        if (!chart) return;
        const dark = document.documentElement.classList.contains('dark');
        chart.data.datasets[0].borderColor = dark ? '#c4d391' : '#8a9e36';
        chart.data.datasets[0].borderWidth = 1.8;
        chart.data.datasets[0].fill = true;
        chart.data.datasets[0].backgroundColor = context => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return 'transparent';
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, dark ? 'rgba(171,193,106,.2)' : 'rgba(147,165,69,.25)');
            gradient.addColorStop(1, dark ? 'rgba(171,193,106,.03)' : 'rgba(147,165,69,.03)');
            return gradient;
        };
        chart.data.datasets[0].pointHoverBackgroundColor = dark ? '#c4d391' : '#8a9e36';
        chart.options.animation = { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350 };
        chart.options.scales.x.border = { display: false };
        chart.options.scales.x.ticks = { maxTicksLimit: chart.width < 500 ? 4 : 7, maxRotation: 0, color: dark ? '#a9b8d0' : '#52627a', padding: 10, font: { family: 'Inter', size: 12 } };
        chart.options.onResize = (chart, size) => { chart.options.scales.x.ticks.maxTicksLimit = size.width < 500 ? 4 : 7; };
        chart.options.scales.y.position = 'right';
        chart.options.scales.x.display = false;
        chart.options.scales.y.display = false;
        chart.options.layout = { padding: { top: 8, right: 0, bottom: 0, left: 0 } };
        chart.options.interaction = { mode: 'index', intersect: false };
        chart.options.scales.y.border = { display: false };
        chart.options.scales.y.grid = { color: dark ? '#2b3b56' : '#dce4f0', drawTicks: false };
        chart.options.scales.y.ticks = { maxTicksLimit: 4, color: dark ? '#a9b8d0' : '#52627a', padding: 10, font: { family: 'Inter', size: 12 }, callback: value => isPrivacyMode ? '••••' : '¥' + (value / 1000).toFixed(0) + 'k' };
        chart.options.plugins.tooltip = {
            enabled: !isPrivacyMode, mode: 'index', intersect: false, displayColors: false,
            backgroundColor: dark ? '#e7ecd5' : '#363d28', titleColor: dark ? '#303429' : '#dbe1c4', bodyColor: dark ? '#303429' : '#ffffff',
            padding: 14, cornerRadius: 8, bodyFont: { family: 'Geist Mono', size: 16, weight: '600' }, titleFont: { family: 'Geist Mono', size: 12 },
            callbacks: { label: context => money(context.raw, 'CNY', 2) }
        };
        chart.stop();
        chart.update('none');
    };
    const originalRange = setNwRange;
    setNwRange = function (days) {
        originalRange(days);
        el('hero-period-label').textContent = ({ 30: '近 1 月', 90: '近 3 月', 365: '近 1 年', 0: '全部记录' })[days];
        document.querySelectorAll('.nw-range-btn').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.range) === days)));
    };
    const originalRenderAll = renderAllRows;
    renderAllRows = function () {
        originalRenderAll();
        const snapshot = portfolioValues();
        ['usd', 'cn', 'sgov'].forEach(type => updateRowValues(type, state[type] || [], 0));
        updateCashRowValues(snapshot.values.find(item => item.type === 'cash').value, snapshot.fx, snapshot.hkdFx);
        renderVooQqqm(); renderAllocation(); toggleHoldingsEdit(editingHoldings); applyMarketFilter();
        document.querySelectorAll('#panel-holdings input[data-field="ticker"]').forEach(input => {
            input.addEventListener('click', () => { if (!editingHoldings && input.dataset.type !== 'cash' && input.value && window.openAssetDetail) openAssetDetail(input.value, input.dataset.type === 'cn' ? 'CNY' : 'USD'); });
        });
    };
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
        window.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            document.activeElement?.blur(); toggleHoldingsEdit(false); toggleReferenceEdit(false); closePopover(); closeAllCcyMenus();
            if (!el('sync-panel').classList.contains('hidden-panel')) toggleSyncPanel();
        });
        navigateWorkspace(location.hash.slice(1), false);
        el('holdings-search').addEventListener('input', () => { toggleHoldingsEdit(editingHoldings); applyMarketFilter(); });
        await originalOnload();
        toggleHoldingsEdit(false); toggleReferenceEdit(false); applyMarketFilter(); renderAllocation(); renderDDAlerts();
        const ticker = localStorage.getItem('assethub_market_ticker') === 'true';
        el('ticker-toggle').checked = ticker; el('tv-ticker-container').hidden = !ticker;
        document.body.classList.toggle('has-market-ticker', ticker);
    };
})();
