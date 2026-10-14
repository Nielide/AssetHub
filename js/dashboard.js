// Presentation and interaction layer. Existing portfolio calculations and cloud sync stay in app.js.
(() => {
    const model = DrawdownModel;
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    let filter = 'all';
    let search = '';
    let visibleIds = [];
    let fetching = false;
    const openLevels = new Set();
    const orderKey = () => `assethub_drawdown_order:${localStorage.getItem('gh_repo') || 'Nielide/AssetHub'}:${localStorage.getItem('gh_path') || 'data/data.json'}`;
    function syncTracker() {
        let preference;
        try { preference = JSON.parse(localStorage.getItem(orderKey()) || 'null'); } catch (error) { preference = null; }
        if (preference?.mode === 'custom' || preference?.mode === 'holdings') state.drawdownSort = preference.mode;
        const rows = model.sync(state);
        if (preference?.mode === 'custom' && Array.isArray(preference.keys)) {
            const ranks = new Map(preference.keys.map((key, index) => [key, index]));
            rows.sort((a, b) => (ranks.get(a.symbol || a.id) ?? preference.keys.length) - (ranks.get(b.symbol || b.id) ?? preference.keys.length));
        }
        return rows;
    }
    function saveOrderPreference(mode) {
        localStorage.setItem(orderKey(), JSON.stringify({ mode, keys: state.drawdown.map(row => row.symbol || row.id) }));
    }
    const priceText = (row, price) => price > 0 ? `${row.currency === 'CNY' ? '¥' : '$'}${Number(price).toFixed(row.currency === 'CNY' ? 3 : 2)}` : '—';
    let statusTimer;
    const status = message => {
        clearTimeout(statusTimer);
        document.getElementById('dd-status').textContent = message;
        if (message) statusTimer = setTimeout(() => { document.getElementById('dd-status').textContent = ''; }, 5000);
    };

    window.setDrawdownFilter = value => {
        filter = value;
        renderDrawdown();
    };
    window.setDrawdownSort = value => {
        state.drawdownSort = value === 'custom' ? 'custom' : 'holdings';
        saveOrderPreference(state.drawdownSort);
        model.sync(state);
        saveData();
        renderDrawdown();
        status('');
    };

    function persistOrder(ids) {
        state.drawdown = model.reorderVisible(state.drawdown, ids);
        state.drawdownSort = 'custom';
        saveOrderPreference('custom');
        saveData();
        renderDrawdown();
        status('');
    }
    window.moveDrawdownRow = (id, direction) => {
        const ids = visibleIds.slice();
        const index = ids.indexOf(id), next = index + direction;
        if (index < 0 || next < 0 || next >= ids.length) return;
        [ids[index], ids[next]] = [ids[next], ids[index]];
        persistOrder(ids);
        document.querySelector(`#drawdown-list [data-row-id="${CSS.escape(id)}"] .dd-move-${direction < 0 ? 'up' : 'down'}`)?.focus();
    };
    window.rememberDrawdownLevels = details => {
        if (details.open) openLevels.add(details.dataset.id);
        else openLevels.delete(details.dataset.id);
    };

    renderDrawdown = function() {
        const rows = syncTracker();
        const container = document.getElementById('drawdown-list');
        if (!container) return;
        const shown = rows.filter(row => {
            const data = model.metrics(row);
            return (!search || row.symbol.includes(search)) && (filter === 'all' || row.source === filter || (filter === 'attention' && data.ready && data.drop >= 5));
        });
        visibleIds = shown.map(row => row.id);
        document.getElementById('dd-count').textContent = `${rows.filter(row => row.source === 'holding').length} 只持仓 · ${rows.filter(row => row.source === 'watchlist').length} 只自选`;
        document.getElementById('dd-sort').value = state.drawdownSort || 'holdings';
        document.querySelectorAll('[data-dd-filter]').forEach(button => {
            const active = button.dataset.ddFilter === filter;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        container.innerHTML = shown.map((row, index) => {
            const data = model.metrics(row);
            const owned = row.source === 'holding';
            const safeId = escapeHTML(row.id), safeSymbol = escapeHTML(row.symbol);
            const tone = !data.ready ? 'pending' : data.drop >= 10 ? 'danger' : data.drop >= 5 ? 'watch' : 'safe';
            const dropText = !data.ready ? '—' : data.drop < 0 ? `+${Math.abs(data.drop).toFixed(2)}%` : `−${data.drop.toFixed(2)}%`;
            const dropLabel = !data.ready ? (!row.high ? '' : '缺少报价') : data.drop < 0 ? '高于参考' : '';
            const nextText = !data.ready ? '—' : data.next === null ? '已达 −30%' : `−${data.next}% · ${priceText(row, data.target)}`;
            const levels = model.levels.map(level => `<div class="level-price ${data.ready && data.drop >= level ? 'reached' : data.next === level ? 'upcoming' : ''}"><span>−${level}%</span><b>${row.high > 0 ? priceText(row, row.high * (1 - level / 100)) : '—'}</b></div>`).join('');
            return `<article class="dd-row dd-tone-${tone}" data-row-id="${safeId}">
                <div class="dd-overview">
                    <div class="dd-symbol-block">
                        <div class="drawdown-symbol-cell"><input class="input-google" data-id="${safeId}" data-field="symbol" value="${safeSymbol}" maxlength="16" ${owned ? 'readonly' : ''} onchange="handleDrawdownInput(this)" aria-label="标的代码" placeholder="代码"></div><span class="source-badge ${owned ? 'holding' : ''}">${owned ? '持仓' : '自选'} · ${escapeHTML(row.currency)}</span>
                    </div>
                    <label class="dd-value"><span class="mobile-label">参考高点</span><input type="number" class="input-google dd-price-input" data-id="${safeId}" data-field="high" min="0" step="any" value="${row.high || ''}" onchange="handleDrawdownInput(this)" aria-label="${safeSymbol} 参考高点" placeholder="设高点" title="设置参考高点"></label>
                    <div class="dd-value"><span class="mobile-label">现价</span>${owned ? `<b class="dd-current" title="持仓现价">${priceText(row, row.current)}</b>` : `<input type="number" class="input-google dd-price-input" data-id="${safeId}" data-field="current" min="0" step="any" value="${row.current || ''}" onchange="handleDrawdownInput(this)" aria-label="${safeSymbol} 现价" placeholder="设现价">`}</div>
                    <div class="dd-value"><span class="mobile-label">回撤</span><strong class="dd-change" title="${dropLabel}">${dropText}</strong></div>
                    <div class="dd-next" title="${data.ready && data.next !== null ? '距下一档 ' + data.distance.toFixed(2) + ' 个百分点' : dropLabel}"><b>${nextText}</b></div>
                    <div class="dd-row-actions"><button class="dd-move-up" data-id="${safeId}" onclick="moveDrawdownRow(this.dataset.id, -1)" ${index === 0 ? 'disabled' : ''} aria-label="上移 ${safeSymbol}">↑</button><button class="dd-move-down" data-id="${safeId}" onclick="moveDrawdownRow(this.dataset.id, 1)" ${index === shown.length - 1 ? 'disabled' : ''} aria-label="下移 ${safeSymbol}">↓</button>${owned ? '<span class="sync-indicator" title="自动跟随持仓" aria-label="同步持仓">↔</span>' : `<button class="delete-trigger" data-id="${safeId}" onclick="toggleDeletePopover(event, 'drawdown', this.dataset.id)" aria-label="删除 ${safeSymbol}" title="删除自选">×</button>`}</div>
                </div>
                <details class="dd-levels" data-id="${safeId}" ontoggle="rememberDrawdownLevels(this)" ${openLevels.has(row.id) ? 'open' : ''}><summary>档位 <span class="muted">5% – 30%</span></summary><div class="dd-level-grid">${levels}</div></details>
            </article>`;
        }).join('') || `<div class="empty-state">${rows.length ? '无匹配标的' : '暂无标的'}</div>`;
        if (window.decorateDrawdownIcons) window.decorateDrawdownIcons();
        setupDrawdownSortable();
    };

    window.addNewDrawdownRow = function() {
        state.drawdown.push({ id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, symbol: '', high: 0, current: 0, source: 'watchlist', currency: 'USD' });
        filter = 'all'; search = '';
        document.getElementById('dd-search').value = '';
        saveData(); renderDrawdown();
        const input = document.querySelector('#drawdown-list .dd-row:last-child input[data-field="symbol"]');
        input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        input?.focus();
    };
    handleDrawdownInput = function(input) {
        const row = state.drawdown.find(item => item.id === input.dataset.id);
        if (!row || (row.source === 'holding' && input.dataset.field === 'symbol')) return;
        const field = input.dataset.field;
        if (field === 'symbol') {
            const value = model.symbol(input.value);
            if (value && !/^[A-Z0-9][A-Z0-9.\-:]{0,15}$/.test(value)) {
                status('代码格式无效'); input.value = row.symbol; return;
            }
            if (value && state.drawdown.some(item => item.id !== row.id && model.symbol(item.symbol) === value)) {
                status(`${value} 已存在`); input.value = row.symbol; return;
            }
            row.symbol = value;
            row.high = 0; row.current = 0; delete row.quoteUpdatedAt;
            row.currency = /^(SH|SZ|BJ)\d{6}$/.test(value) ? 'CNY' : 'USD';
        } else {
            const value = Number(input.value);
            row[field] = Number.isFinite(value) ? Math.max(0, value) : 0;
            if (field === 'current') delete row.quoteUpdatedAt;
        }
        saveData(); renderDrawdown(); renderDDAlerts();
        if (field === 'symbol' && row.symbol && localStorage.getItem('finnhub_key')) fetchDrawdownPrices();
    };

    fetchDrawdownPrices = async function() {
        if (fetching) return;
        syncTracker();
        const key = localStorage.getItem('finnhub_key');
        if (!key) {
            renderDrawdown(); renderDDAlerts(); saveData();
            status('持仓报价已同步');
            return;
        }
        fetching = true;
        const button = document.getElementById('dd-refresh');
        button.disabled = true;
        document.getElementById('refresh-icon-dd').classList.add('animate-spin');
        const requests = state.drawdown.filter(row => row.symbol && row.currency !== 'CNY').map(row => ({ id: row.id, symbol: row.symbol }));
        let updated = 0;
        try {
            for (const request of requests) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                try {
                    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(request.symbol)}&token=${encodeURIComponent(key)}`, { signal: controller.signal });
                    if (!response.ok) continue;
                    const quote = await response.json();
                    const row = state.drawdown.find(item => item.id === request.id && item.symbol === request.symbol);
                    if (row && Number.isFinite(quote.c) && quote.c > 0) {
                        row.current = quote.c; row.quoteUpdatedAt = Date.now(); updated++;
                        ['usd', 'sgov'].forEach(type => state[type].filter(item => model.symbol(item.ticker) === row.symbol).forEach(item => item.price = quote.c));
                    }
                } catch (error) { /* Keep the last usable quote if the provider fails. */ }
                finally { clearTimeout(timeout); }
            }
            syncTracker(); saveData(); renderAllRows(); calculate();
            status(`${updated}/${requests.length} 个美元报价已更新`);
        } finally {
            fetching = false; button.disabled = false;
            document.getElementById('refresh-icon-dd').classList.remove('animate-spin');
        }
    };

    renderDDAlerts = function() {
        const rows = syncTracker().map(row => ({ row, data: model.metrics(row) })).filter(item => item.data.ready).sort((a, b) => b.data.drop - a.data.drop);
        const count = rows.filter(item => item.data.drop >= 5).length;
        document.getElementById('alert-count').textContent = `${count} 项`;
        document.getElementById('dd-alert-list').innerHTML = rows.slice(0, 4).map(({ row, data }) => {
            const tone = data.drop >= 10 ? 'danger' : data.drop >= 5 ? 'watch' : 'safe';
            return `<button class="radar-item radar-${tone}" onclick="document.getElementById('drawdown-tracker').scrollIntoView({behavior:'smooth',block:'start'})"><span><b>${escapeHTML(row.symbol)}</b><small>${data.next ? data.distance.toFixed(1) + '% 距 −' + data.next + '%' : '已达 −30%'}</small></span><strong>${data.drop > 0 ? '−' : '+'}${Math.abs(data.drop).toFixed(1)}%</strong></button>`;
        }).join('') || '<p class="muted empty-state">暂无回撤数据</p>';
    };

    function setupDrawdownSortable() {
        const element = document.getElementById('drawdown-list');
        if (typeof Sortable === 'undefined') return;
        Sortable.get(element)?.destroy();
        Sortable.create(element, { handle: '.dd-drag-icon', draggable: '.dd-row', animation: 150, ghostClass: 'sort-ghost', delay: 120, delayOnTouchOnly: true,
            onEnd: () => persistOrder([...element.querySelectorAll('.dd-row')].map(row => row.dataset.rowId)) });
    }
    initSortable = function() {
        ['usd', 'cn', 'sgov', 'cash'].forEach(type => {
            const element = document.getElementById(`${type}-inputs`);
            if (!element || typeof Sortable === 'undefined') return;
            Sortable.get(element)?.destroy();
            Sortable.create(element, { handle: '.drag-handle', animation: 150, ghostClass: 'sort-ghost', disabled: !!document.getElementById('holdings-search').value.trim(),
                onEnd: event => {
                    const row = state[type].splice(event.oldIndex, 1)[0];
                    state[type].splice(event.newIndex, 0, row);
                    saveData(); calculate();
                } });
        });
        setupDrawdownSortable();
    };

    function decorateHoldings() {
        const query = document.getElementById('holdings-search').value.trim().toUpperCase();
        let total = 0;
        ['usd', 'cn', 'sgov', 'cash'].forEach(type => {
            const list = document.getElementById(`${type}-inputs`);
            const card = list.closest('.g-card-static');
            card.classList.add('holding-group');
            card.dataset.type = type;
            const scroll = card.querySelector('.holding-table-scroll');
            scroll.setAttribute('data-lenis-prevent', '');
            scroll.setAttribute('tabindex', '0');
            scroll.setAttribute('aria-label', `${({usd:'美股',cn:'A 股',sgov:'国债 ETF',cash:'现金'})[type]}持仓表格`);
            const heading = card.querySelector('h2');
            heading.innerHTML = `${({ usd: '美股', cn: 'A 股', sgov: '国债 ETF', cash: '现金' })[type]} <span class="count-badge">${state[type].length}</span>`;
            if (!card.querySelector('.collapse-group')) {
                const button = document.createElement('button');
                button.className = 'collapse-group'; button.type = 'button';
                button.title = '收起或展开'; button.setAttribute('aria-label', `收起或展开持仓分组`);
                button.setAttribute('aria-controls', `${type}-inputs`);
                button.textContent = '⌃';
                card.firstElementChild.insertBefore(button, card.firstElementChild.firstElementChild);
                button.addEventListener('click', () => {
                    const collapsed = card.classList.toggle('collapsed');
                    button.setAttribute('aria-expanded', String(!collapsed));
                    localStorage.setItem(`asset_group_${type}_collapsed`, String(collapsed));
                });
                card.classList.toggle('collapsed', localStorage.getItem(`asset_group_${type}_collapsed`) === 'true');
            }
            card.querySelector('.collapse-group').setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
            card.querySelectorAll('.btn-add').forEach(control => {
                control.setAttribute('role', 'button'); control.tabIndex = 0;
                control.setAttribute('aria-label', control.getAttribute('onclick')?.startsWith('addItem') ? `添加持仓` : `刷新报价`);
                if (!control.dataset.keyboardReady) {
                    control.dataset.keyboardReady = 'true';
                    control.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); control.click(); } });
                }
            });
            let matched = 0;
            list.querySelectorAll('.pro-grid-row, .cash-grid-row').forEach(row => {
                const ticker = row.querySelector('[data-field="ticker"]')?.value.toUpperCase() || '';
                row.hidden = !!query && !ticker.includes(query);
                if (!row.hidden) matched++;
            });
            total += state[type].length;
            card.classList.toggle('search-expanded', !!query);
            let empty = card.querySelector('.holding-empty');
            if (!empty) { empty = document.createElement('p'); empty.className = 'holding-empty muted'; scroll.appendChild(empty); }
            empty.textContent = state[type].length ? '无匹配持仓' : '暂无持仓';
            empty.hidden = matched > 0;
            if (typeof Sortable !== 'undefined') Sortable.get(list)?.option('disabled', !!query);
        });
        document.getElementById('holdings-count').textContent = `${total} 项`;
    }
    const originalRenderAll = renderAllRows;
    renderAllRows = function() { originalRenderAll(); decorateHoldings(); };
    const originalCalculate = calculate;
    calculate = function() { originalCalculate(); renderDrawdown(); decorateHoldings(); };
    const originalOnload = window.onload;
    window.onload = async function() {
        document.getElementById('holdings-search').addEventListener('input', decorateHoldings);
        document.getElementById('dd-search').addEventListener('input', event => { search = model.symbol(event.target.value); renderDrawdown(); });
        await originalOnload();
        decorateHoldings();
    };
})();
