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
                dataset.backgroundColor = ['#dadce0', '#e8eaed', '#f1f3f4', '#cfd8dc'];
                dataset.hoverOffset = 0;
            } else if (dataset.publicBackgroundColor) {
                dataset.backgroundColor = Array.isArray(dataset.publicBackgroundColor)
                    ? dataset.publicBackgroundColor.slice()
                    : dataset.publicBackgroundColor;
                dataset.hoverOffset = 4;
            }
        }
    }

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
