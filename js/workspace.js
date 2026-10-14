/* Presentation layer: focused workspaces, read/edit modes and portfolio insights. */
(function () {
    const el = id => document.getElementById(id);
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const money = (value, currency = 'CNY', decimals = 0) => isPrivacyMode ? '••••' : ({ CNY: '¥', USD: '$', HKD: 'HK$' }[currency] || currency + ' ') + Number(value).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: decimals, minimumFractionDigits: decimals });
    const arrow = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
    let currentPanel = 'overview', market = 'all', editingHoldings = false, editingReferences = false, overviewMarket = 'usd';
    const overviewCategory = type => type === 'sgov' ? 'usd' : type;
    const overviewOrderKey = () => `assethub_overview_order:${localStorage.getItem('gh_repo') || 'Nielide/AssetHub'}:${localStorage.getItem('gh_path') || 'data/data.json'}`;
    function overviewPositions() {
        let keys = state.overviewOrder;
        try {
            const saved = JSON.parse(localStorage.getItem(overviewOrderKey()) || 'null');
            if (Array.isArray(saved)) keys = saved;
        } catch { /* Fall back to the order included in the portfolio backup. */ }
        const positions = PortfolioModel.orderedPositions(portfolioValues().positions, keys);
        if (Array.isArray(keys)) state.overviewOrder = positions.map(PortfolioModel.positionKey);
        return positions;
    }
    function persistOverviewOrder(keys) {
        const positions = PortfolioModel.reorderPositions(overviewPositions(), keys);
        state.overviewOrder = positions.map(PortfolioModel.positionKey);
        localStorage.setItem(overviewOrderKey(), JSON.stringify(state.overviewOrder));
        saveData();
        renderVooQqqm();
    }
    window.setOverviewMarket = value => {
        overviewMarket = ['usd', 'cn'].includes(value) ? value : 'all';
        renderVooQqqm();
    };
    function visibleOverviewPositions() {
        return overviewPositions().filter(item => overviewMarket === 'all' || overviewCategory(item.type) === overviewMarket);
    }

    window.navigateWorkspace = (name, updateHash = true) => {
        const route = name;
        const calendarRoute = name === 'activity';
        if (calendarRoute) name = 'overview';
        if (name.startsWith('asset/')) {
            try {
                const asset = decodeURIComponent(name.slice(6)).toUpperCase();
                if (/^(USD|CNY|HKD):[A-Z0-9][A-Z0-9.\-:]{0,23}$/.test(asset)) { window.assetRoute = asset; name = 'asset'; }
                else name = 'overview';
            } catch { name = 'overview'; }
        }
        if (!['overview', 'allocation', 'holdings', 'drawdown', 'activity', 'transactions', 'asset'].includes(name)) name = 'overview';
        const previousPanel = currentPanel;
        currentPanel = name;
        document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
        document.querySelectorAll('[data-workspace]').forEach(link => {
            const active = link.dataset.workspace === (calendarRoute ? 'activity' : name) || (name === 'asset' && link.dataset.workspace === 'holdings');
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        if (updateHash && location.hash !== '#' + route) history.pushState(null, '', '#' + route);
        if (name === 'overview') requestAnimationFrame(() => charts.networth?.resize());
        if (name === 'asset' && window.renderAssetDetail) renderAssetDetail();
        if (name === 'transactions' && window.renderTransactions) renderTransactions();
        closePopover(); closeAllCcyMenus();
        if (calendarRoute) requestAnimationFrame(() => el('panel-activity').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'}));
        else if (updateHash && (previousPanel !== name || name === 'overview')) window.scrollTo({top: 0, behavior: 'instant'});
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
    function overviewRiskMarkup(item, references) {
        const symbol = DrawdownModel.symbol(item.ticker);
        const row = { ...references.get(symbol), symbol, current: item.price, currency: item.currency };
        const data = DrawdownModel.metrics(row);
        const tone = !data.ready ? 'muted' : data.drop >= 5 ? 'negative' : 'positive';
        const high = row.high > 0 ? money(row.high, item.currency, item.type === 'cn' ? 3 : 2) : '设高点';
        const drop = !data.ready ? '—' : isPrivacyMode ? '••••' : (data.drop < 0 ? '+' : '−') + Math.abs(data.drop).toFixed(2) + '%';
        const threshold = !data.ready ? '—' : data.next === null ? '−30%+' : '−' + data.next + '%';
        const target = !data.ready || data.next === null ? '—' : money(data.target, item.currency, item.type === 'cn' ? 3 : 2);
        return `<span class="position-risk-high ${row.high > 0 ? '' : 'risk-unset'}" data-label="参考高点"><b>${high}</b></span><span class="position-risk-drop ${tone}" data-label="回撤"><b>${drop}</b></span><span class="position-risk-next" data-label="下一档价格"><b>${target}</b></span><span class="position-risk-threshold ${tone}" data-label="档位"><small class="${data.ready ? '' : 'is-empty'}">${threshold}</small></span>`;

    }
    function renderOverviewRisks() {
        const positions = visibleOverviewPositions();
        const references = new Map((state.drawdown || []).map(row => [DrawdownModel.symbol(row.symbol), row]));
        const container = el('overview-risk-rows');
        container.innerHTML = positions.map(item => `<button class="position-risk" type="button" data-position-key="${escapeHTML(PortfolioModel.positionKey(item))}" data-risk-symbol="${escapeHTML(DrawdownModel.symbol(item.ticker))}" aria-label="查看 ${escapeHTML(item.ticker)} 回撤关注"><span class="position-risk-symbol">${escapeHTML(item.ticker)}</span>${overviewRiskMarkup(item, references)}</button>`).join('') || '<div class="empty-state">暂无持仓</div>';
        container.querySelectorAll('.position-risk').forEach(button => button.addEventListener('click', () => openRiskPosition(button.dataset.riskSymbol)));
    }
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
        const data = PortfolioModel.assetOverview(portfolioValues());
        const percent = value => isPrivacyMode ? '••••' : value.toFixed(1) + '%';
        el('asset-grand-total').textContent = money(data.total, 'CNY', 2);
        el('asset-investment-total').textContent = money(data.investment, 'CNY', 2);
        el('asset-cash-total').textContent = money(data.cash, 'CNY', 2);
        el('asset-investment-weight').textContent = percent(data.investmentWeight);
        el('asset-investment-legend').textContent = percent(data.investmentWeight);
        el('asset-cash-weight').textContent = percent(data.cashWeight);
        const circumference = 2 * Math.PI * 96, investmentLength = circumference * data.investmentWeight / 100, cashLength = circumference * data.cashWeight / 100;
        el('asset-ring-investment').setAttribute('stroke-dasharray', investmentLength + ' ' + (circumference - investmentLength));
        el('asset-ring-cash').setAttribute('stroke-dasharray', cashLength + ' ' + (circumference - cashLength));
        el('asset-ring-cash').setAttribute('stroke-dashoffset', -investmentLength);
        document.querySelector('.asset-ring').setAttribute('aria-label', isPrivacyMode ? '资产配置已隐藏' : '投资 ' + percent(data.investmentWeight) + '，现金 ' + percent(data.cashWeight));
        el('asset-investment-track').style.width = data.investmentWeight + '%';
        el('asset-cash-track').style.width = data.cashWeight + '%';
        el('allocation-breakdown').innerHTML = data.groups.map(group => `<button class="asset-category-row" data-asset-group="${group.key}" data-market="${group.market}" type="button" aria-label="查看${group.label}明细" style="--group-color:${group.color}"><span class="asset-category-name"><i class="asset-category-icon" aria-hidden="true">${group.currency === 'USD' ? '$' : group.currency === 'HKD' ? 'HK' : '¥'}</i><span><b>${group.label}</b><small>${group.key === 'us-investment' ? 'USD · 含 SGOV' : group.currency}</small></span></span><strong class="asset-category-native" data-label="原币金额">${money(group.value, group.currency, 2)}</strong><span class="asset-category-converted" data-label="人民币折算">${money(group.converted, 'CNY', 2)}</span><span class="asset-category-weight" data-label="资产占比"><b>${percent(group.weight)}</b><i><em style="width:${group.weight}%"></em></i></span></button>`).join('');
        el('allocation-breakdown').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
            if (button.dataset.market !== 'cash') {
                navigateWorkspace('overview'); setOverviewMarket(button.dataset.market);
                requestAnimationFrame(() => document.querySelector('.overview-positions').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}));
            } else {
                navigateWorkspace('holdings'); el('holdings-search').value = ''; el('holdings-search').dispatchEvent(new Event('input')); setHoldingMarket('cash');
            }
        }));
        data.currencies.forEach(item => {
            const weight = el('currency-weight-' + item.currency.toLowerCase());
            weight.textContent = percent(item.weight);
            weight.nextElementSibling.querySelector('em').style.width = item.weight + '%';
        });
        document.body.classList.toggle('privacy-mode', isPrivacyMode);
        document.querySelector('.privacy-button').setAttribute('aria-pressed', String(isPrivacyMode));
    }
    renderVooQqqm = function () {
        const container = el('vooqqqm-rows');
        const positions = visibleOverviewPositions();
        const weights = PerformanceModel.weights(portfolioValues().positions, overviewMarket);
        document.querySelectorAll('[data-overview-market]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.overviewMarket === overviewMarket)));
        container.innerHTML = positions.map(item => {
            const cost = item.costValue, pct = item.returnPct;
            const icon = document.querySelector(`#${item.type}-inputs input[data-id="${CSS.escape(String(item.id))}"][data-field="ticker"]`)?.parentElement.querySelector('.holding-icon');
            const quantity = isPrivacyMode ? '••••' : item.shares.toLocaleString('en-US', { useGrouping: false,maximumFractionDigits:6});
            const tone = cost > 0 ? item.profit < 0 ? 'negative' : 'positive' : '';
            const profit = cost > 0 ? isPrivacyMode ? '••••' : (item.profit >= 0 ? '+' : '−') + money(Math.abs(item.profit), item.currency, 2) : '—';
            const percent = cost > 0 ? isPrivacyMode ? '••••' : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—';
            const weight = isPrivacyMode ? '••••' : (weights.get(PortfolioModel.positionKey(item)) || 0).toFixed(1) + '%';
            return `<article class="position-item" data-position-key="${escapeHTML(PortfolioModel.positionKey(item))}" data-symbol="${escapeHTML(item.ticker)}" data-currency="${item.currency}" data-id="${escapeHTML(item.id)}" data-type="${item.type}"><div class="position-holding-data"><div class="position-symbol"><button class="position-logo position-drag-icon" type="button" aria-label="拖动 ${escapeHTML(item.ticker)} 排序，方向键上下调整" title="拖动排序">${icon?.innerHTML || escapeHTML(item.ticker.slice(0,1))}</button><button class="position-open" type="button" aria-label="查看 ${escapeHTML(item.ticker)}"><b>${escapeHTML(item.ticker)}</b></button></div><span class="position-quantity" data-label="股数">${quantity}</span><span class="position-cost" data-label="平均成本">${money(item.cost,item.currency,item.type === 'cn' ? 3 : 2)}</span><span class="position-price" data-label="现价">${money(item.price,item.currency,item.type === 'cn' ? 3 : 2)}</span><span class="position-value" data-label="市值">${money(item.value,item.currency,2)}</span><span class="position-profit ${tone}" data-label="浮动盈亏">${profit}</span><span class="position-return ${tone}" data-label="收益率"><b>${percent}</b></span><span class="position-weight" data-label="持仓占比"><b>${weight}</b></span></div></article>`;
        }).join('') || '<div class="empty-state">暂无持仓</div>';
        container.querySelectorAll('.position-open').forEach(button => button.addEventListener('click', () => {
            const row = button.closest('.position-item');
            if (window.openAssetDetail) openAssetDetail(row.dataset.symbol,row.dataset.currency);
            else openPortfolioPosition(row.dataset.symbol);
        }));
        container.querySelectorAll('.position-drag-icon').forEach(button => button.addEventListener('keydown', event => {
            if (!['ArrowUp','ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const key = button.closest('.position-item').dataset.positionKey;
            const keys = positions.map(PortfolioModel.positionKey), index = keys.indexOf(key);
            const next = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (next < 0 || next >= keys.length) return;
            [keys[index], keys[next]] = [keys[next], keys[index]];
            persistOverviewOrder(keys);
            container.querySelector(`[data-position-key="${CSS.escape(key)}"] .position-drag-icon`)?.focus({preventScroll:true});
        }));
        container.querySelectorAll('img').forEach(img => {
            img.draggable = false;
            const fallback = () => { img.closest('.position-logo').textContent = img.closest('[data-symbol]')?.dataset.symbol?.slice(0,1) || '·'; };
            img.addEventListener('error',fallback,{once:true});
            if (img.complete && !img.naturalWidth) fallback();
        });
        if (typeof Sortable !== 'undefined') {
            Sortable.get(container)?.destroy();
            Sortable.create(container, {handle:'.position-drag-icon',draggable:'.position-item',animation:160,ghostClass:'overview-sort-ghost',chosenClass:'overview-sort-chosen',delay:120,delayOnTouchOnly:true,
                onEnd: event => { if (event.oldIndex !== event.newIndex) persistOverviewOrder([...container.querySelectorAll('.position-item')].map(row => row.dataset.positionKey)); }
            });
        }
        renderOverviewRisks();
    };
    renderDDAlerts = function () {
        const rows = DrawdownModel.sync(state).map(row => ({ row, data: DrawdownModel.metrics(row) }));
        const ready = rows.filter(item => item.data.ready).sort((a, b) => b.data.drop - a.data.drop);
        const count = ready.filter(item => item.data.drop >= 5).length;
        const pending = rows.filter(item => !item.row.high).length;
        el('nav-risk-count').textContent = count || '';
        el('risk-held-count').textContent = rows.filter(item => item.row.source === 'holding').length;
        el('risk-watch-count').textContent = rows.filter(item => item.row.source === 'watchlist').length;
        el('risk-alert-count').textContent = count;
        el('risk-pending-count').textContent = pending;
        renderOverviewRisks();
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
        document.querySelectorAll('#panel-overview .nw-range-btn').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.range) === days)));
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
