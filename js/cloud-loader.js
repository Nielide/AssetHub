(() => {
    const DEFAULT_GH_REPO = 'Nielide/AssetHub';
    const DEFAULT_GH_PATH = 'data/data.json';
    const DEFAULT_CLOUD_DATA_URL = './data/data.json';
    let cloudHasLoadedUserData = !!localStorage.getItem('portfolioData');

    const savedRepo = (localStorage.getItem('gh_repo') || '').trim();
    const savedPath = (localStorage.getItem('gh_path') || '').trim();
    if (!savedRepo) localStorage.setItem('gh_repo', DEFAULT_GH_REPO);
    if (!savedPath || savedPath === 'data.json') localStorage.setItem('gh_path', DEFAULT_GH_PATH);

    function getSyncRepo() {
        return (localStorage.getItem('gh_repo') || DEFAULT_GH_REPO).trim();
    }

    function getSyncPath() {
        const savedPath = (localStorage.getItem('gh_path') || '').trim();
        return (!savedPath || savedPath === 'data.json') ? DEFAULT_GH_PATH : savedPath;
    }

    function normalizePortfolioState(remote) {
        if (!remote || typeof remote !== 'object') return null;
        if (!remote.usd) remote.usd = [];
        if (!remote.cn) remote.cn = [];
        if (!remote.cash) remote.cash = [];
        if (!remote.sgov) remote.sgov = [];
        if (!remote.drawdown) remote.drawdown = [];
        if (!remote.history) remote.history = [];
        if (!remote.hkdFx) remote.hkdFx = 0.93;
        if (!remote.lastSavedAt) remote.lastSavedAt = 0;
        return remote;
    }

    async function fetchJsonWithTimeout(url, timeoutMs = 8000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const separator = url.includes('?') ? '&' : '?';
            const res = await fetch(`${url}${separator}t=${Date.now()}`, {
                cache: 'no-store',
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async function loadCloudDataIfNewer(force = false) {
        const remote = normalizePortfolioState(await fetchJsonWithTimeout(DEFAULT_CLOUD_DATA_URL));
        const remoteSavedAt = remote.lastSavedAt || 0;
        const localSavedAt = state.lastSavedAt || 0;
        if (force || !cloudHasLoadedUserData || remoteSavedAt > localSavedAt) {
            state = remote;
            cloudHasLoadedUserData = true;
            if (state.fxRate) document.getElementById('fx-rate').value = state.fxRate;
            localStorage.setItem('portfolioData', JSON.stringify(state));
            localStorage.setItem('last_known_remote_save', String(remoteSavedAt));
            return true;
        }
        return false;
    }

    function applyMainChartPrivacy(chart, isPrivate) {
        if (!chart) return;
        if (chart.options?.plugins?.tooltip) {
            chart.options.plugins.tooltip.enabled = !isPrivate;
        }
        if (Array.isArray(chart.config?.plugins)) {
            if (isPrivate) {
                if (!chart.publicPlugins) chart.publicPlugins = chart.config.plugins.slice();
                chart.config.plugins = chart.config.plugins.filter(plugin => plugin?.id !== 'segmentLabels');
            } else if (chart.publicPlugins) {
                chart.config.plugins = chart.publicPlugins.slice();
            }
        }
        const dataset = chart.data?.datasets?.[0];
        if (dataset) {
            if (isPrivate) {
                if (!dataset.publicBackgroundColor) {
                    dataset.publicBackgroundColor = Array.isArray(dataset.backgroundColor)
                        ? dataset.backgroundColor.slice()
                        : dataset.backgroundColor;
                }
                dataset.hoverOffset = 0;
            } else if (dataset.publicBackgroundColor) {
                dataset.backgroundColor = Array.isArray(dataset.publicBackgroundColor)
                    ? dataset.publicBackgroundColor.slice()
                    : dataset.publicBackgroundColor;
                dataset.hoverOffset = 4;
            }
        }
    }

    const SIMPLE_ICON_SLUGS = {
        AAPL: 'apple',
        ABBV: 'abbvie',
        ABNB: 'airbnb',
        ADBE: 'adobe',
        AMD: 'amd',
        AMZN: 'amazon',
        ASML: 'asml',
        AVGO: 'broadcom',
        BABA: 'alibabadotcom',
        BAC: 'bankofamerica',
        BRK: 'berkshirehathaway',
        COST: 'costco',
        CRM: 'salesforce',
        DIS: 'disney',
        GOOGL: 'google',
        GOOG: 'google',
        INTC: 'intel',
        JNJ: 'johnsonandjohnson',
        JPM: 'jpmorgan',
        KO: 'cocacola',
        MA: 'mastercard',
        MCD: 'mcdonalds',
        META: 'meta',
        MSFT: 'microsoft',
        NFLX: 'netflix',
        NKE: 'nike',
        NVDA: 'nvidia',
        ORCL: 'oracle',
        PEP: 'pepsi',
        PYPL: 'paypal',
        QCOM: 'qualcomm',
        SBUX: 'starbucks',
        T: 'att',
        TSM: 'tsmc',
        TSLA: 'tesla',
        UBER: 'uber',
        V: 'visa',
        WMT: 'walmart',
        XOM: 'exxonmobil'
    };

    const HOLDING_ICON_COLORS = {
        blue: '#1a73e8',
        green: '#34a853',
        yellow: '#fbbc04',
        purple: '#9334e6'
    };

    function injectHoldingIconStyles() {
        if (document.getElementById('holding-icon-styles')) return;
        const style = document.createElement('style');
        style.id = 'holding-icon-styles';
        style.textContent = `
            .pro-grid-header,
            .pro-grid-row {
                grid-template-columns: 24px 136px minmax(78px, .58fr) minmax(76px, .58fr) minmax(76px, .58fr) minmax(100px, .74fr) minmax(154px, 1.18fr) minmax(56px, .42fr) 30px;
                gap: 8px;
            }
            .cash-grid-row {
                grid-template-columns: 24px minmax(110px, 1.15fr) 64px minmax(94px, .8fr) minmax(104px, .9fr) 58px 32px;
                gap: 8px;
            }
            .pro-grid-row > div,
            .cash-grid-row > div {
                min-width: 0;
            }
            .pro-grid-row input[data-field="shares"],
            .pro-grid-row input[data-field="cost"],
            .pro-grid-row input[data-field="price"],
            .cash-grid-row input[data-field="amount"] {
                height: 28px;
                padding: 2px 6px;
            }
            .pro-grid-row input[data-field="ticker"],
            .cash-grid-row input[data-field="ticker"] {
                height: 28px;
                padding: 2px 4px;
            }
            .pro-grid-row input[data-field="ticker"] {
                max-width: 94px;
            }
            .pro-grid-row input[data-field="shares"] {
                max-width: 76px;
            }
            .pro-grid-row [id^="val-"],
            .pro-grid-row [id^="pl-"],
            .pro-grid-row [id^="alloc-"],
            .cash-grid-row [id^="val-cash-"],
            .cash-grid-row [id^="alloc-cash-"] {
                white-space: nowrap;
                overflow: visible;
            }
            .cash-grid-row .ccy-select-btn {
                width: auto;
                min-width: 56px;
                justify-content: flex-start;
                gap: 3px;
            }
            .cash-grid-row input[data-field="amount"] {
                max-width: 118px;
                margin-left: auto;
            }
            @media (max-width: 720px) {
                .pro-grid-header,
                .pro-grid-row {
                    grid-template-columns: 22px 116px minmax(76px, .56fr) minmax(68px, .5fr) minmax(68px, .5fr) minmax(88px, .66fr) minmax(148px, 1.08fr) minmax(50px, .38fr) 28px;
                    gap: 6px;
                }
                .cash-grid-row {
                    grid-template-columns: 22px minmax(104px, 1.25fr) 58px minmax(86px, .78fr) minmax(96px, .85fr) 54px 30px;
                    gap: 6px;
                }
                .holding-symbol-cell {
                    gap: 6px;
                }
                .pro-grid-row input[data-field="ticker"] {
                    max-width: 78px;
                }
                .pro-grid-row input[data-field="shares"] {
                    max-width: 74px;
                }
                .holding-icon {
                    width: 24px;
                    height: 24px;
                    flex-basis: 24px;
                }
                .holding-icon img {
                    width: 14px;
                    height: 14px;
                }
            }
            .holding-symbol-cell {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .holding-symbol-cell .input-google {
                flex: 0 1 auto;
                min-width: 0;
            }
            .holding-icon {
                width: 26px;
                height: 26px;
                border-radius: 999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex: 0 0 26px;
                overflow: hidden;
                background: var(--holding-icon-color, #1a73e8);
                color: #fff;
                font-size: 9px;
                font-weight: 800;
                line-height: 1;
                letter-spacing: 0;
            }
            .holding-icon img {
                width: 15px;
                height: 15px;
                filter: brightness(0) invert(1);
                object-fit: contain;
            }
        `;
        document.head.appendChild(style);
    }

    function holdingIconColor(ticker, type) {
        if (type === 'cn') return HOLDING_ICON_COLORS.green;
        if (type === 'sgov') return HOLDING_ICON_COLORS.blue;
        const palette = [
            HOLDING_ICON_COLORS.blue,
            HOLDING_ICON_COLORS.purple,
            HOLDING_ICON_COLORS.yellow,
            HOLDING_ICON_COLORS.green
        ];
        const score = Array.from(String(ticker || '').toUpperCase()).reduce((sum, char) => {
            return sum + char.charCodeAt(0);
        }, 0);
        return palette[score % palette.length];
    }

    function holdingIconLabel(ticker) {
        const clean = String(ticker || '').trim().toUpperCase();
        const letters = clean.replace(/[^A-Z]/g, '');
        if (letters) return letters.slice(0, 3);
        return clean.slice(0, 3) || '--';
    }

    function updateHoldingIcon(icon, ticker, type) {
        const clean = String(ticker || '').trim().toUpperCase();
        const slug = SIMPLE_ICON_SLUGS[clean];
        icon.style.setProperty('--holding-icon-color', holdingIconColor(clean, type));
        icon.innerHTML = '';
        if (slug) {
            const img = document.createElement('img');
            img.alt = '';
            img.src = `https://cdn.jsdelivr.net/npm/simple-icons@v15/icons/${slug}.svg`;
            img.onerror = () => {
                icon.textContent = holdingIconLabel(clean);
            };
            icon.appendChild(img);
        } else {
            icon.textContent = holdingIconLabel(clean);
        }
    }

    function decorateHoldingIcons(type) {
        injectHoldingIconStyles();
        const container = document.getElementById(`${type}-inputs`);
        if (!container) return;
        container.querySelectorAll('input[data-field="ticker"]').forEach(input => {
            const cell = input.parentElement;
            if (!cell) return;
            cell.classList.add('holding-symbol-cell');
            let icon = cell.querySelector('.holding-icon');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'holding-icon';
                icon.setAttribute('aria-hidden', 'true');
                cell.insertBefore(icon, input);
                input.addEventListener('input', () => updateHoldingIcon(icon, input.value, type));
            }
            updateHoldingIcon(icon, input.value, type);
        });
    }

    const originalRenderRows = renderRows;
    renderRows = function(type, items, symbol) {
        originalRenderRows(type, items, symbol);
        decorateHoldingIcons(type);
    };

    const originalToggleSyncPanel = toggleSyncPanel;
    toggleSyncPanel = function() {
        originalToggleSyncPanel();
        const repoInput = document.getElementById('gh-repo');
        const pathInput = document.getElementById('gh-path');
        if (repoInput) repoInput.value = getSyncRepo();
        if (pathInput) pathInput.value = getSyncPath();
    };

    const originalSaveSyncSettings = saveSyncSettings;
    saveSyncSettings = function() {
        const pathInput = document.getElementById('gh-path');
        if (pathInput && (!pathInput.value.trim() || pathInput.value.trim() === 'data.json')) {
            pathInput.value = DEFAULT_GH_PATH;
        }
        const repoInput = document.getElementById('gh-repo');
        if (repoInput && !repoInput.value.trim()) repoInput.value = DEFAULT_GH_REPO;
        originalSaveSyncSettings();
    };

    pullFromGithub = async function() {
        const token = localStorage.getItem('gh_token');
        const repo = getSyncRepo();
        const path = getSyncPath();
        const btn = document.getElementById('btn-pull');
        const spanText = btn.querySelector('span') ? btn.querySelector('span').innerText : btn.innerText;
        if (btn.querySelector('span')) btn.querySelector('span').innerText = 'Syncing...';
        else btn.innerText = 'Syncing...';

        try {
            let remote = null;
            try {
                remote = await fetchJsonWithTimeout(`https://raw.githubusercontent.com/${repo}/main/${path}`);
            } catch (rawError) {
                remote = await fetchJsonWithTimeout(DEFAULT_CLOUD_DATA_URL);
            }
            remote = normalizePortfolioState(remote);
            if (!remote) throw new Error('Invalid cloud data');
            applyRemoteState(remote);
            if (btn.querySelector('span')) btn.querySelector('span').innerText = 'Success';
            else btn.innerText = 'Success';
        } catch (e) {
            if (token && repo) {
                try {
                    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
                    const res = await fetch(url, { headers: { Authorization: `token ${token}` } });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    const remote = normalizePortfolioState(JSON.parse(decodeURIComponent(escape(atob(data.content)))));
                    applyRemoteState(remote);
                    if (btn.querySelector('span')) btn.querySelector('span').innerText = 'Success';
                    else btn.innerText = 'Success';
                } catch (apiError) {
                    if (btn.querySelector('span')) btn.querySelector('span').innerText = 'Error';
                    else btn.innerText = 'Error';
                }
            } else {
                if (btn.querySelector('span')) btn.querySelector('span').innerText = 'Error';
                else btn.innerText = 'Error';
            }
        } finally {
            setTimeout(() => {
                if (btn.querySelector('span')) btn.querySelector('span').innerText = spanText;
                else btn.innerText = spanText;
            }, 2000);
        }
    };

    const originalApplyRemoteState = applyRemoteState;
    applyRemoteState = function(remote) {
        const normalized = normalizePortfolioState(remote);
        if (normalized) {
            localStorage.setItem('last_known_remote_save', String(normalized.lastSavedAt || 0));
        }
        originalApplyRemoteState(normalized || remote);
        cloudHasLoadedUserData = true;
    };

    const originalAutoSmartBackup = autoSmartBackup;
    autoSmartBackup = async function() {
        if (!cloudHasLoadedUserData && !(state.lastSavedAt > 0)) return;
        return originalAutoSmartBackup();
    };

    const originalUpdateChart = updateChart;
    updateChart = function(chart, data) {
        if (chart === charts.main && isPrivacyMode) {
            applyMainChartPrivacy(chart, true);
            return originalUpdateChart(chart, [1, 1, 1, 1]);
        }
        applyMainChartPrivacy(chart, false);
        return originalUpdateChart(chart, data);
    };

    const originalTogglePrivacy = togglePrivacy;
    togglePrivacy = function() {
        originalTogglePrivacy();
        if (charts.main) {
            calculate();
        }
    };

    const originalOnload = window.onload;
    window.onload = async function() {
        try {
            await loadCloudDataIfNewer(false);
        } catch (e) {}
        originalOnload();
    };
})();
