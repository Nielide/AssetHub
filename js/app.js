// 数字动画工具，用在总资产和盈亏数字的滚动效果上。
function animateNumber(element, start, end, duration = 500, prefix = '', decimals = 2) {
            if (element.animationId) {
                cancelAnimationFrame(element.animationId);
            }
            
            let startTime = null;
            function step(timestamp) {
                if (typeof isPrivacyMode !== 'undefined' && isPrivacyMode) {
                    element.animationId = null;
                    return; 
                }

                if (!startTime) startTime = timestamp;
                const progress = Math.min((timestamp - startTime) / duration, 1);
                const current = progress * (end - start) + start;
                element.innerText = prefix + current.toFixed(decimals);
                
                if (progress < 1) {
                    element.animationId = window.requestAnimationFrame(step);
                } else {
                    element.animationId = null;
                }
            }
            element.animationId = window.requestAnimationFrame(step);
        }

        // 系统设置面板：打开时把已保存的 API 和同步配置填回表单。
        function toggleSyncPanel() {
            const panel = document.getElementById('sync-panel');
            if (panel.classList.contains('hidden-panel')) {
                document.getElementById('gh-token').value = localStorage.getItem('gh_token') || '';
                document.getElementById('gh-repo').value = localStorage.getItem('gh_repo') || '';
                document.getElementById('gh-path').value = localStorage.getItem('gh_path') || '';
                document.getElementById('finnhub-token').value = localStorage.getItem('finnhub_key') || '';
                document.getElementById('hkd-rate').value = state.hkdFx || 0.93;
                panel.classList.remove('hidden-panel');
            } else {
                panel.classList.add('hidden-panel');
            }
        }

        // 保存 GitHub、Finnhub 和汇率设置到浏览器本地。
        function saveSyncSettings() {
            const ghToken = document.getElementById('gh-token').value;
            const ghRepo = document.getElementById('gh-repo').value;
            const ghPath = document.getElementById('gh-path').value;
            const finnhubToken = document.getElementById('finnhub-token').value;

            localStorage.setItem('gh_token', ghToken);
            localStorage.setItem('gh_repo', ghRepo);
            localStorage.setItem('gh_path', ghPath);
            localStorage.setItem('finnhub_key', finnhubToken);

            state.hkdFx = parseFloat(document.getElementById('hkd-rate').value) || 0.93;
            saveData();
            calculate();

            const saveBtn = document.querySelector('button[onclick="saveSyncSettings()"]');
            const originalText = saveBtn.innerText;
            saveBtn.innerText = 'Saved';

            setTimeout(() => { saveBtn.innerText = originalText; }, 2000);
        }

        // GitHub 同步状态：当云端数据更新时，先暂停覆盖并等待用户选择。
        let pendingRemoteState = null;

        // 从 GitHub 下载 data.json，并应用到当前页面。
        async function pullFromGithub() {
            const token = localStorage.getItem('gh_token');
            const repo = localStorage.getItem('gh_repo');
            const path = localStorage.getItem('gh_path');
            if (!token || !repo) return alert('Please configure GitHub parameters in System Settings first');

            const btn = document.getElementById('btn-pull');
            const spanText = btn.querySelector('span') ? btn.querySelector('span').innerText : btn.innerText;
            if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Syncing...'; else btn.innerText = 'Syncing...';

            const url = `https://api.github.com/repos/${repo}/contents/${path}`;
            try {
                const res = await fetch(url, 
				{ headers: { 
				Authorization: `token ${token}`
				 }
				 });
                if (res.ok) {
                    const data = await res.json();
                    const remote = JSON.parse(decodeURIComponent(escape(atob(data.content))));

                    if (!remote.usd) remote.usd = [];
                    if (!remote.cn) remote.cn = [];
                    if (!remote.cash) remote.cash = [];
                    if (!remote.drawdown) remote.drawdown = [];
                    if (!remote.history) remote.history = [];

                    applyRemoteState(remote);

                    if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Success'; else btn.innerText = 'Success';
                } else {
                    if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Failed'; else btn.innerText = 'Failed';
                }
            } catch (e) {
                if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Error'; else btn.innerText = 'Error';
            } finally {
                setTimeout(() => {
                    if(btn.querySelector('span')) btn.querySelector('span').innerText = spanText; else btn.innerText = spanText;
                }, 2000);
            }
        }

        // 应用云端数据：手动同步或冲突处理后刷新页面状态。
        function applyRemoteState(remote) {
            state = remote;
            if(state.fxRate) document.getElementById('fx-rate').value = state.fxRate;
            saveData(); calculate(); renderAllRows(); renderDrawdown(); initSortable();
        }

        // 处理云端和本地数据冲突提示。
        function resolveConflict(choice) {
            document.getElementById('conflict-banner').classList.add('hidden');
            if (choice === 'use-remote' && pendingRemoteState) {
                applyRemoteState(pendingRemoteState);
            } else if (choice === 'keep-local') {
                doPush();
            }
            pendingRemoteState = null;
        }

        // 备份本地数据到 GitHub。手动备份前会先检查云端是否有更新。
        async function pushToGithub(silent = false) {
            const token = localStorage.getItem('gh_token');
            const repo = localStorage.getItem('gh_repo');
            const path = localStorage.getItem('gh_path');

            if (!token || !repo) {
                if (!silent) alert('Please configure GitHub parameters in System Settings first');
                return;
            }

            if (!silent) {
                try {
                    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
                    const checkRes = await fetch(url, { headers: { Authorization: `token ${token}` } });
                    if (checkRes.ok) {
                        const checkData = await checkRes.json();
                        const remote = JSON.parse(decodeURIComponent(escape(atob(checkData.content))));
                        const remoteSavedAt = remote.lastSavedAt || 0;
                        const localKnownRemoteAt = parseInt(localStorage.getItem('last_known_remote_save') || '0');
                        if (remoteSavedAt && remoteSavedAt > localKnownRemoteAt) {
                            pendingRemoteState = remote;
                            document.getElementById('conflict-banner').classList.remove('hidden');
                            return;
                        }
                    }
                } catch (e) { }
            }

            await doPush(silent);
        }

        // 真正执行 GitHub 写入的函数，手动备份和自动备份都会用到。
        async function doPush(silent = false) {
            const token = localStorage.getItem('gh_token');
            const repo = localStorage.getItem('gh_repo');
            const path = localStorage.getItem('gh_path');

            let btn, spanText;
            if (!silent) {
                btn = document.getElementById('btn-push');
                spanText = btn.querySelector('span') ? btn.querySelector('span').innerText : btn.innerText;
                if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Pushing...'; else btn.innerText = 'Pushing...';
            }

            const url = `https://api.github.com/repos/${repo}/contents/${path}`;
            try {
                let sha = '';
                const getRes = await fetch(url, { headers: { Authorization: `token ${token}` } });
                if (getRes.ok) {
                    const data = await getRes.json();
                    sha = data.sha;
                }

                state.lastSavedAt = Date.now();
                const content = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
                const body = { message: silent ? "Auto sync after market close" : "Manual Backup from AssetHub", content: content, sha: sha || undefined };

                const putRes = await fetch(url, {
                    method: 'PUT',
                    headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if (putRes.ok) {
                    localStorage.setItem('last_known_remote_save', state.lastSavedAt.toString());
                    saveData();
                }

                if (!silent) {
                    if (putRes.ok) {
                        if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Success'; else btn.innerText = 'Success';
                        btn.classList.add('bg-googleGreen');
                        btn.classList.remove('bg-googleBlue');
                    } else {
                        if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Failed'; else btn.innerText = 'Failed';
                        btn.classList.add('bg-googleRed');
                        btn.classList.remove('bg-googleBlue');
                    }
                }
            } catch (e) {
                if (!silent) {
                    if(btn.querySelector('span')) btn.querySelector('span').innerText = 'Error'; else btn.innerText = 'Error';
                }
            } finally {
                if (!silent) {
                    setTimeout(() => {
                        if(btn.querySelector('span')) btn.querySelector('span').innerText = spanText; else btn.innerText = spanText;
                        btn.className = 'btn-action text-white bg-googleBlue border-transparent hover:bg-blue-600 shadow-sm';
                    }, 2000);
                }
            }
        }

        // 默认资产数据：浏览器还没有保存过数据时使用。
        const defaultState = {
            usd: [{ id: '1', ticker: 'VOO', shares: 0, cost: 0, price: 0 }, { id: '2', ticker: 'QQQM', shares: 0, cost: 0, price: 0 }],
            cn: [{ id: '5', ticker: 'sh600036', shares: 0, cost: 0, price: 0 }],
            cash: [{ id: '7', ticker: 'USD', amount: 0, currency: 'USD' }],
            sgov: [],
            drawdown: [
                { id: 'd1', symbol: "VOO", high: 610.58, current: 610.58 },
                { id: 'd2', symbol: "QQQM", high: 250.00, current: 245.00 }
            ],
            fxRate: 7,
            hkdFx: 0.93,
            history: [],
            lastSavedAt: 0
        };

        // 从浏览器读取已保存数据，并补齐旧版本可能缺失的字段。
        let savedState = localStorage.getItem('portfolioData');
        let state;
        try {
            state = savedState ? JSON.parse(savedState) : defaultState;
            if(!state.usd) state.usd = [];
            if(!state.cn) state.cn = [];
            if(!state.cash) state.cash = [];
            if(!state.sgov) state.sgov = [];
            if(!state.drawdown) state.drawdown = [];
            if(!state.history) state.history = [];
            if(!state.hkdFx) state.hkdFx = 0.93;

            const sgovIdx = state.usd.findIndex(i => (i.ticker || '').trim().toUpperCase() === 'SGOV');
            if (sgovIdx !== -1) {
                const moved = state.usd.splice(sgovIdx, 1)[0];
                state.sgov.push(moved);
            }
        } catch(e) {
            state = defaultState;
        }

        if(state.fxRate) document.getElementById('fx-rate').value = state.fxRate;

        // 全局界面状态：图表、日历、渲染和隐私模式都会用到。
        let isPrivacyMode = localStorage.getItem('portfolio_privacy') === 'true';
        let charts = {};
        let itemToDelete = null;
        let nwRangeDays = 90;

        let displayDate = new Date();
        let calViewMode = 0;

        // 把当前资产数据保存到浏览器本地。
        function saveData() {
            state.fxRate = parseFloat(document.getElementById('fx-rate').value) || 7.25;
            localStorage.setItem('portfolioData', JSON.stringify(state));
        }

        // 隐私模式开启时，用遮挡文本替换敏感数字。
        function applyPrivacyMask(el, text) {
            if (!el) return;
            if (isPrivacyMode) {
                el.innerText = text;
            }
        }

        // 主计算函数：总资产、盈亏、历史记录、图表、日历和每行数据都在这里刷新。
        function calculate() {
            const fx = parseFloat(document.getElementById('fx-rate').value) || 7.25;
            const hkdFx = state.hkdFx || 0.93;

            const usdItems = state.usd || [];
            const cnItems = state.cn || [];
            const cashItems = state.cash || [];
            const sgovItems = state.sgov || [];

            const totalUsdStockVal = usdItems.reduce((a, i) => a + (i.shares * i.price), 0);
            const totalCnStockVal = cnItems.reduce((a, i) => a + (i.shares * i.price), 0);
            const totalSgovVal = sgovItems.reduce((a, i) => a + (i.shares * i.price), 0);

            let totalUsdCashVal = 0, totalRmbCashVal = 0, totalHkdCashVal = 0;
            cashItems.forEach(i => {
                if(i.currency === 'USD') totalUsdCashVal += i.amount;
                else if(i.currency === 'HKD') totalHkdCashVal += i.amount;
                else totalRmbCashVal += i.amount;
            });

            const totalCashOnlyValRmb = (totalUsdCashVal * fx) + (totalHkdCashVal * hkdFx) + totalRmbCashVal;
            const totalSgovValRmb = totalSgovVal * fx;
            const totalUsdAssets = totalUsdStockVal + totalUsdCashVal + totalSgovVal;
            const totalHkdAssets = totalHkdCashVal;
            const totalRmbAssets = totalCnStockVal + totalRmbCashVal;
            const grandTotal = (totalUsdAssets * fx) + (totalHkdAssets * hkdFx) + totalRmbAssets;

            const totalUsdStockCost = usdItems.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
            const totalCnStockCost = cnItems.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
            const totalSgovCost = sgovItems.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
            const currentTotalCost = Math.round((totalUsdStockCost + totalUsdCashVal + totalSgovCost) * fx + (totalHkdCashVal * hkdFx) + totalCnStockCost + totalRmbCashVal);

            const localDate = new Date();
            const todayStr = `${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
            const currentTotal = Math.round(grandTotal);

            const pastRecords = state.history.filter(h => h.date !== todayStr);
            let baseline = pastRecords.length > 0 ? pastRecords[pastRecords.length - 1] : null;

            if (!baseline) {
                if (!state.day1Baseline) state.day1Baseline = { total: currentTotal, cost: currentTotalCost };
                baseline = state.day1Baseline;
            } else { delete state.day1Baseline; }

            if (baseline && baseline.cost === undefined) { baseline.cost = currentTotalCost; }

            let pl = 0, rate = 0, netFlow = 0;
            if (baseline) {
                const prevTotal = baseline.total || baseline.value || currentTotal;
                const prevCost = baseline.cost;

                netFlow = currentTotalCost - prevCost;
                pl = currentTotal - prevTotal - netFlow;
                rate = prevTotal > 0 ? (pl / prevTotal) * 100 : 0;
            }

            let todayRecord = state.history.find(h => h.date === todayStr);
            if (todayRecord) {
                todayRecord.total = currentTotal;
                todayRecord.cost = currentTotalCost;
                todayRecord.pl = pl;
                todayRecord.rate = rate;
                todayRecord.netFlow = netFlow;
                todayRecord.value = currentTotal;
            } else {
                state.history.push({
                    date: todayStr, total: currentTotal, cost: currentTotalCost,
                    pl: pl, rate: rate, netFlow: netFlow, value: currentTotal
                });
            }

            if (state.history.length > 730) state.history.shift();

            const totalNwEl = document.getElementById('total-nw-cny');
            if (totalNwEl) {
                if (isPrivacyMode) { totalNwEl.innerText = '••••••••'; }
                else { animateNumber(totalNwEl, parseFloat(totalNwEl.innerText.replace(/[¥\s,*]/g, '')) || 0, grandTotal, 500, '¥', 2); }
            }

            const totalUsdEl = document.getElementById('total-usd-assets');
            if (totalUsdEl) {
                if (isPrivacyMode) { totalUsdEl.innerText = '••••••••'; }
                else { animateNumber(totalUsdEl, parseFloat(totalUsdEl.innerText.replace(/[\$\s,*]/g, '')) || 0, totalUsdAssets, 600, '$', 2); }
            }

            const totalSgovEl = document.getElementById('total-sgov-assets');
            if (totalSgovEl) {
                if (isPrivacyMode) { totalSgovEl.innerText = '••••••••'; }
                else { animateNumber(totalSgovEl, parseFloat(totalSgovEl.innerText.replace(/[\$\s,*]/g, '')) || 0, totalSgovVal, 600, '$', 2); }
            }

            const totalCnyEl = document.getElementById('total-cny-assets');
            if (totalCnyEl) {
                if (isPrivacyMode) { totalCnyEl.innerText = '••••••••'; }
                else { animateNumber(totalCnyEl, parseFloat(totalCnyEl.innerText.replace(/[¥\s,*]/g, '')) || 0, totalRmbAssets, 500, '¥', 2); }
            }

            const totalHkdEl = document.getElementById('total-hkd-assets');
            if (totalHkdEl) {
                if (isPrivacyMode) { totalHkdEl.innerText = '••••••••'; }
                else { animateNumber(totalHkdEl, parseFloat(totalHkdEl.innerText.replace(/[HK\$\s,*]/g, '')) || 0, totalHkdAssets, 500, 'HK$', 2); }
            }

            if(charts.main) updateChart(charts.main, [(totalUsdStockVal * fx), totalCnStockVal, totalCashOnlyValRmb, totalSgovValRmb]);

            updateRowValues('usd', usdItems, totalUsdStockVal, '$');
            updateRowValues('cn', cnItems, totalCnStockVal, '¥');
            updateRowValues('sgov', sgovItems, totalSgovVal, '$');
            updateCashRowValues(totalCashOnlyValRmb, fx, hkdFx);

            renderVooQqqm(usdItems);

            const todayPlEl = document.getElementById('today-pl-val');
            const todayPlPctEl = document.getElementById('today-pl-pct');
            if (todayPlEl && todayPlPctEl) {
                const isTodayPos = pl >= 0;
                const sign = isTodayPos ? '+' : '';
                const prefixPl = isTodayPos ? '+¥' : '-¥';
                const colorClass = isTodayPos ? 'text-stockGreen dark:text-green-300' : 'text-stockRed dark:text-red-300';
                const bgClass = isTodayPos ? 'bg-stockGreenBg dark:bg-green-900/20 text-stockGreen dark:text-green-300' : 'bg-stockRedBg dark:bg-red-900/20 text-stockRed dark:text-red-300';

                todayPlPctEl.innerText = `${sign}${rate.toFixed(2)}%`;
                todayPlPctEl.className = `text-[0.65rem] font-bold font-mono px-2.5 py-1 rounded-full ${bgClass}`;

                if (isPrivacyMode) {
                    todayPlEl.innerText = '••••';
                    todayPlEl.className = `text-2xl md:text-3xl font-bold font-mono ${colorClass}`;
                } else {
                    const startVal = parseFloat(todayPlEl.innerText.replace(/[^\d.]/g, '')) || 0;
                    const signPrefix = pl >= 0 ? '+' : '-';
					animateNumber(todayPlEl, startVal, Math.abs(pl), 500, signPrefix, 0);
                    todayPlEl.className = `text-2xl md:text-3xl font-bold font-mono ${colorClass}`;
                }
            }

            const totalUnPl = currentTotal - currentTotalCost;
            const totalUnPlPct = currentTotalCost > 0 ? (totalUnPl / currentTotalCost) * 100 : 0;
            const unPlEl = document.getElementById('total-unrealized-pl-val');
            const unPlPctEl = document.getElementById('total-unrealized-pl-pct');
            const totalCostEl = document.getElementById('total-cost-val');
            const totalValueEl = document.getElementById('total-value-val');

            if (unPlEl) {
                const isUnPos = totalUnPl >= 0;
                const signUn = isUnPos ? '+' : '';
                const prefixUnPl = isUnPos ? '+¥' : '-¥';
                const colorClassUn = isUnPos ? 'text-stockGreen dark:text-green-300' : 'text-stockRed dark:text-red-300';
                const bgClassUn = isUnPos ? 'bg-stockGreenBg dark:bg-green-900/20 text-stockGreen dark:text-green-300' : 'bg-stockRedBg dark:bg-red-900/20 text-stockRed dark:text-red-300';

                unPlPctEl.innerText = `${signUn}${totalUnPlPct.toFixed(2)}%`;
                unPlPctEl.className = `text-[0.65rem] font-bold font-mono px-2.5 py-1 rounded-full ${bgClassUn}`;

                if (isPrivacyMode) {
                    unPlEl.innerText = '••••'; 
                    totalCostEl.innerText = '••••'; totalValueEl.innerText = '••••';
                    unPlEl.className = `text-2xl md:text-3xl font-bold font-mono ${colorClassUn}`;
                } else {
                    const startValUn = parseFloat(unPlEl.innerText.replace(/[^\d.]/g, '')) || 0;
                    const signUnPrefix = totalUnPl >= 0 ? '+' : '-';
					animateNumber(unPlEl, startValUn, Math.abs(totalUnPl), 500, signUnPrefix, 0);
                    totalCostEl.innerText = `¥${Math.round(currentTotalCost)}`;
                    totalValueEl.innerText = `¥${Math.round(currentTotal)}`;
                    unPlEl.className = `text-2xl md:text-3xl font-bold font-mono ${colorClassUn}`;
                }
            }

            renderDDAlerts();
            saveData();
            renderCalendar();
            renderYearlySummary();
            renderNetWorthChart();
        }

        // 渲染 VOO/QQQM 对比卡片。
        function renderVooQqqm(usdItems) {
            const rowsEl = document.getElementById('vooqqqm-rows');
            if (!rowsEl) return;

            const oldVooPlEl = document.getElementById('vq-pl-VOO');
            const oldQqqmPlEl = document.getElementById('vq-pl-QQQM');
            const oldVooValEl = document.getElementById('vq-val-VOO');
            const oldQqqmValEl = document.getElementById('vq-val-QQQM');
            
            const startVooPl = oldVooPlEl ? parseFloat(oldVooPlEl.innerText.replace(/[^\d.-]/g, '')) || 0 : 0;
            const startQqqmPl = oldQqqmPlEl ? parseFloat(oldQqqmPlEl.innerText.replace(/[^\d.-]/g, '')) || 0 : 0;
            const startVooVal = oldVooValEl ? parseFloat(oldVooValEl.innerText.replace(/[^\d.]/g, '')) || 0 : 0;
            const startQqqmVal = oldQqqmValEl ? parseFloat(oldQqqmValEl.innerText.replace(/[^\d.]/g, '')) || 0 : 0;

            const voo = usdItems.filter(i => (i.ticker || '').trim().toUpperCase() === 'VOO');
            const qqqm = usdItems.filter(i => (i.ticker || '').trim().toUpperCase() === 'QQQM');

            const sumShares = arr => arr.reduce((a, i) => a + i.shares, 0);
            const sumCost = arr => arr.reduce((a, i) => a + i.shares * (i.cost || 0), 0);
            const avgPrice = arr => { const sh = sumShares(arr); return sh > 0 ? arr.reduce((a, i) => a + i.shares * i.price, 0) / sh : 0; };

            const vooShares = sumShares(voo), qqqmShares = sumShares(qqqm);
            const vooPrice = avgPrice(voo), qqqmPrice = avgPrice(qqqm);
            const vooCostTotal = sumCost(voo), qqqmCostTotal = sumCost(qqqm);
            const vooAvgCost = vooShares > 0 ? vooCostTotal / vooShares : 0;
            const qqqmAvgCost = qqqmShares > 0 ? qqqmCostTotal / qqqmShares : 0;

            const vooVal = vooShares * vooPrice;
            const qqqmVal = qqqmShares * qqqmPrice;
            const pairVal = vooVal + qqqmVal;

            if (vooShares === 0 && qqqmShares === 0) {
                rowsEl.innerHTML = `<p class="text-sm text-textSecondary dark:text-darkTextSec py-4 text-center col-span-2">No VOO / QQQM holdings yet.</p>`;
                return;
            }

            const vooWeight = pairVal > 0 ? (vooVal / pairVal) * 100 : 50;
            const qqqmWeight = pairVal > 0 ? (qqqmVal / pairVal) * 100 : 50;

            const vooPl = vooVal - vooCostTotal;
            const vooPlPct = vooCostTotal > 0 ? (vooPl / vooCostTotal) * 100 : 0;
            const vooIsPos = vooPl >= 0;
            const vooPlColor = vooPl > 0.01 ? '#1e8e3e' : (vooPl < -0.01 ? '#ea4335' : 'var(--text-secondary)');
            const vooPlDisp = isPrivacyMode ? '••••' : `${vooIsPos ? '+' : ''}${Math.round(vooPl)}`; 
            
            const qqqmPl = qqqmVal - qqqmCostTotal;
            const qqqmPlPct = qqqmCostTotal > 0 ? (qqqmPl / qqqmCostTotal) * 100 : 0;
            const qqqmIsPos = qqqmPl >= 0;
            const qqqmPlColor = qqqmPl > 0.01 ? '#1e8e3e' : (qqqmPl < -0.01 ? '#ea4335' : 'var(--text-secondary)');
            const qqqmPlDisp = isPrivacyMode ? '••••' : `${qqqmIsPos ? '+' : ''}${Math.round(qqqmPl)}`; 

            const renderBadge = (isPos, pct) => `<span class="font-mono text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${isPos ? 'bg-[rgba(52,168,83,0.14)] dark:bg-[rgba(52,168,83,0.2)] text-[#1e8e3e] dark:text-[#81c995]' : 'bg-[rgba(234,67,53,0.12)] dark:bg-[rgba(234,67,53,0.18)] text-[#ea4335] dark:text-[#f6958e]'}">${isPos ? '+' : ''}${pct.toFixed(1)}%</span>`;

            rowsEl.innerHTML = `
                <div class="flex flex-col pr-3 md:pr-5">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold text-base text-textPrimary dark:text-darkText">VOO</span>
                        ${renderBadge(vooIsPos, vooPlPct)}
                    </div>
                    <div class="font-mono font-extrabold text-3xl md:text-4xl" id="vq-pl-VOO" style="color:${vooPlColor}; line-height:1.1;">${vooPlDisp}</div>
                </div>
                
                <div class="flex flex-col pl-3 md:pl-5 border-l border-gray-100 dark:border-white/[0.03]">
                    <div class="flex justify-between items-center mb-2">
                        <span class="font-bold text-base text-textPrimary dark:text-darkText">QQQM</span>
                        ${renderBadge(qqqmIsPos, qqqmPlPct)}
                    </div>
                    <div class="font-mono font-extrabold text-3xl md:text-4xl" id="vq-pl-QQQM" style="color:${qqqmPlColor}; line-height:1.1;">${qqqmPlDisp}</div>
                </div>

                <div class="col-span-2 py-4">
                    <div class="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-[#3c4043]">
                        <span style="width:${vooWeight}%; background-color:#1a73e8;"></span>
                        <span style="width:${qqqmWeight}%; background-color:#fbbc04;"></span>
                    </div>
                </div>

                <div class="flex flex-col pr-3 md:pr-5 gap-2 text-[0.72rem]">
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Qty</span><b class="text-textPrimary dark:text-darkText font-mono">${isPrivacyMode ? '••••' : vooShares.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Price</span><b class="text-textPrimary dark:text-darkText font-mono">$${vooPrice.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Cost</span><b class="text-textPrimary dark:text-darkText font-mono">$${vooAvgCost.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Value</span><b class="text-textPrimary dark:text-darkText font-mono" id="vq-val-VOO">${isPrivacyMode ? '••••' : '$' + Math.round(vooVal)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Weight</span><b class="text-textPrimary dark:text-darkText font-mono">${vooWeight.toFixed(1)}%</b></div>
                </div>

                <div class="flex flex-col pl-3 md:pl-5 border-l border-gray-100 dark:border-white/[0.03] gap-2 text-[0.72rem]">
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Qty</span><b class="text-textPrimary dark:text-darkText font-mono">${isPrivacyMode ? '••••' : qqqmShares.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Price</span><b class="text-textPrimary dark:text-darkText font-mono">$${qqqmPrice.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Cost</span><b class="text-textPrimary dark:text-darkText font-mono">$${qqqmAvgCost.toFixed(2)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Value</span><b class="text-textPrimary dark:text-darkText font-mono" id="vq-val-QQQM">${isPrivacyMode ? '••••' : '$' + Math.round(qqqmVal)}</b></div>
                    <div class="flex justify-between"><span class="text-textSecondary dark:text-darkTextSec font-medium">Weight</span><b class="text-textPrimary dark:text-darkText font-mono">${qqqmWeight.toFixed(1)}%</b></div>
                </div>
            `;

            if (!isPrivacyMode) {
                const nVooPlEl = document.getElementById('vq-pl-VOO');
                const nQqqmPlEl = document.getElementById('vq-pl-QQQM');
                const nVooValEl = document.getElementById('vq-val-VOO');
                const nQqqmValEl = document.getElementById('vq-val-QQQM');
                
                if (nVooPlEl) animateNumber(nVooPlEl, startVooPl, Math.abs(vooPl), 500, vooIsPos ? '+' : '-', 0);
                if (nQqqmPlEl) animateNumber(nQqqmPlEl, startQqqmPl, Math.abs(qqqmPl), 500, qqqmIsPos ? '+' : '-', 0);
                if (nVooValEl) animateNumber(nVooValEl, startVooVal, vooVal, 500, '$', 0);
                if (nQqqmValEl) animateNumber(nQqqmValEl, startQqqmVal, qqqmVal, 500, '$', 0);
            }
        }

        // 切换净值曲线显示的时间范围。
        function setNwRange(days) {
            nwRangeDays = days;
            document.querySelectorAll('.nw-range-btn').forEach(b => {
                const isActive = parseInt(b.dataset.range) === days;
                b.classList.toggle('bg-white', isActive);
                b.classList.toggle('dark:bg-darkSurface', isActive);
                b.classList.toggle('shadow-sm', isActive);
                b.classList.toggle('text-blue-600', isActive);
                b.classList.toggle('dark:text-blue-400', isActive);
                b.classList.toggle('text-textSecondary', !isActive);
                b.classList.toggle('dark:text-darkTextSec', !isActive);
            });
            // 切换时间范围后重建图表，让曲线动画重新播放。
            renderNetWorthChart(true);
        }

        // 渲染净值曲线，以及收益率、最大回撤、波动率等摘要指标。
        function renderNetWorthChart(forceRecreate = false) {
            const canvas = document.getElementById('chart-networth');
            const emptyHint = document.getElementById('nw-empty-hint');
            if (!canvas) return;

            let records = (state.history || []).slice().sort((a, b) => a.date.localeCompare(b.date));
            
            // 按真实自然日过滤，而不是简单取最近 N 条记录。
            if (nwRangeDays > 0 && records.length > 0) {
                const lastDateObj = new Date(records[records.length - 1].date);
                lastDateObj.setDate(lastDateObj.getDate() - nwRangeDays);
                const y = lastDateObj.getFullYear();
                const m = String(lastDateObj.getMonth() + 1).padStart(2, '0');
                const d = String(lastDateObj.getDate()).padStart(2, '0');
                const cutoffDateStr = `${y}-${m}-${d}`;
                
                records = records.filter(r => r.date >= cutoffDateStr);
            }

            if (records.length < 2) {
                if (charts.networth) { charts.networth.destroy(); charts.networth = null; }
                emptyHint.innerText = 'Keep using AssetHub for a few days to see your net worth curve here.';
                document.getElementById('nw-period-return').innerText = '--';
                document.getElementById('nw-max-drawdown').innerText = '--';
                document.getElementById('nw-volatility').innerText = '--';
                return;
            }
            emptyHint.innerText = '';

            const labels = records.map(r => r.date.slice(5));
            const values = records.map(r => (r.total || r.value || 0));

            let cumulative = 1;
            for (let i = 1; i < records.length; i++) {
                cumulative *= (1 + (records[i].rate || 0) / 100);
            }
            const periodReturn = (cumulative - 1) * 100;
            const prEl = document.getElementById('nw-period-return');
            
            prEl.innerText = (periodReturn >= 0 ? '+' : '') + periodReturn.toFixed(2) + '%';
            prEl.className = `text-base md:text-xl font-bold font-mono ${periodReturn >= 0 ? 'text-googleGreen' : 'text-googleRed'}`;

            let peak = -Infinity, maxDD = 0;
            records.forEach(r => {
                const v = r.total || r.value || 0;
                if (v > peak) peak = v;
                if (peak > 0) {
                    const dd = ((peak - v) / peak) * 100;
                    if (dd > maxDD) maxDD = dd;
                }
            });
            document.getElementById('nw-max-drawdown').innerText = '-' + maxDD.toFixed(2) + '%';

            const rates = records.map(r => r.rate || 0).filter(r => r !== 0 || true);
            if (rates.length > 1) {
                const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
                const variance = rates.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (rates.length - 1);
                const dailyStd = Math.sqrt(variance);
                const annualizedVol = dailyStd * Math.sqrt(252);
                document.getElementById('nw-volatility').innerText = annualizedVol.toFixed(2) + '%';
            } else {
                document.getElementById('nw-volatility').innerText = '--';
            }

            const isDark = document.documentElement.classList.contains('dark');
            const lineColor = '#1a73e8';

            if (forceRecreate && charts.networth) {
                charts.networth.destroy();
                charts.networth = null;
            }

            if (charts.networth) {
                charts.networth.data.labels = labels;
                charts.networth.data.datasets[0].data = values;
                if (charts.networth.options.plugins && charts.networth.options.plugins.tooltip) {
                    charts.networth.options.plugins.tooltip.enabled = !isPrivacyMode;
                }
                charts.networth.update();
            } else {
                const ctx = canvas.getContext('2d');
                
                const totalDuration = 800; 
                const delayBetweenPoints = totalDuration / values.length;

                charts.networth = new Chart(ctx, {
                    type: 'line',
                    data: { 
                        labels: labels, 
                        datasets: [{
                            data: values, 
                            borderColor: lineColor, 
                            fill: false, // 【修改点】彻底关闭下方颜色填充
                            tension: 0.3, 
                            pointRadius: 0, 
                            pointHoverRadius: 4, 
                            borderWidth: 2
                        }] 
                    },
                    options: {
                        responsive: true, 
                        maintainAspectRatio: false,
                        animation: {
                            x: {
                                type: 'number',
                                easing: 'linear',
                                duration: delayBetweenPoints,
                                from: NaN, 
                                delay(context) {
                                    if (context.type !== 'data' || context.xStarted) { return 0; }
                                    context.xStarted = true;
                                    return context.index * delayBetweenPoints;
                                }
                            }
                        },
                        scales: {
                            x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: isDark ? '#9aa0a6' : '#5f6368' } },
                            y: { grid: { color: isDark ? '#3c4043' : '#e5e7eb' }, ticks: { color: isDark ? '#9aa0a6' : '#5f6368', callback: v => isPrivacyMode ? '••••' : '¥' + v.toLocaleString() } }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: { 
                                enabled: !isPrivacyMode, 
                                intersect: false,
                                mode: 'index',
                                callbacks: { label: ctx => `¥${ctx.raw.toLocaleString()}` } 
                            }
                        }
                    }
                });
            }
        }

        // 更新股票行里的计算结果，避免每次都重建输入框。
        function updateRowValues(type, items, totalVal, symbol) {
            items.forEach(item => {
                const valEl = document.getElementById(`val-${type}-${item.id}`);
                const plEl = document.getElementById(`pl-${type}-${item.id}`);
                const allocEl = document.getElementById(`alloc-${type}-${item.id}`);

                if (!valEl) return;

                const val = item.shares * item.price;
                const costBasis = item.shares * item.cost;
                const pl = val - costBasis;
                const plPct = costBasis > 0 ? (pl / costBasis) * 100 : 0;
                const allocPct = totalVal > 0 ? (val / totalVal) * 100 : 0;
                const sign = pl > 0 ? '+' : '';

                let color = 'text-gray-400 dark:text-gray-500';
                if (pl > 0.01) color = 'text-googleGreen';
                if (pl < -0.01) color = 'text-googleRed';

                if (allocEl) allocEl.innerText = `${allocPct.toFixed(1)}%`;

                if (isPrivacyMode) {
                    if (valEl) valEl.innerText = '••••';
                    if (plEl) { 
                        plEl.innerHTML = `•••• / ${sign}${plPct.toFixed(2)}%`; 
                        plEl.className = `text-right font-mono font-medium ${color}`; 
                    }
                    return;
                }

                if (valEl) valEl.innerText = `${symbol}${val.toFixed(2)}`;

                if(plEl) {
                    plEl.className = `text-right font-mono font-medium ${color}`;
                    plEl.innerHTML = `${sign}${Math.round(pl)} / ${sign}${plPct.toFixed(2)}%`;
                }
            });
        }

        // 更新现金行的占比和折算金额。
        function updateCashRowValues(totalCashRmb, fx, hkdFx) {
            const symbolMap = { CNY: '¥', USD: '$', HKD: '$' };
            state.cash.forEach(item => {
                const allocEl = document.getElementById(`alloc-cash-${item.id}`);
                const valEl = document.getElementById(`val-cash-${item.id}`);
                const ccy = item.currency || 'CNY';
                const sym = symbolMap[ccy] || '¥';

                if (valEl) {
                    if (isPrivacyMode) {
                        valEl.innerText = '••••';
                    } else {
                        valEl.innerText = `${sym}${item.amount}`;
                    }
                }

                if(!allocEl) return;
                let rmbVal = ccy === 'USD' ? item.amount * fx : (ccy === 'HKD' ? item.amount * (hkdFx || 0.93) : item.amount);
                let allocPct = totalCashRmb > 0 ? (rmbVal / totalCashRmb) * 100 : 0;
                
                allocEl.innerText = `${allocPct.toFixed(1)}%`;
            });
        }

        // 重建所有可编辑的资产区域。
        function renderAllRows() {
            renderRows('usd', state.usd, '$');
            renderRows('cn', state.cn, '¥');
            renderRows('sgov', state.sgov, '$');
            renderCashRows();
        }

        // 渲染股票类资产的可编辑行：美股、A 股、SGOV。
        function renderRows(type, items, symbol) {
            const container = document.getElementById(type + '-inputs');
            if(!container) return;
            const sharesType = isPrivacyMode ? 'password' : 'number'; 
            const costPriceType = 'number'; 

            container.innerHTML = items.map(item => {
                return `
                <div class="pro-grid-row px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-white/[0.03] last:border-0 text-sm">
                    <div class="drag-handle"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" /></svg></div>
                    <div><input type="text" class="input-google w-full font-bold text-textPrimary dark:text-darkText" data-type="${type}" data-id="${item.id}" data-field="ticker" value="${item.ticker}"></div>
                    <div><input type="${sharesType}" min="0" step="0.01" class="input-google w-full text-right font-mono text-textPrimary dark:text-darkText" data-type="${type}" data-id="${item.id}" data-field="shares" value="${Number(item.shares || 0).toFixed(2)}"></div>
                    <div><input type="${costPriceType}" min="0" class="input-google w-full text-right font-mono text-textSecondary dark:text-darkTextSec" data-type="${type}" data-id="${item.id}" data-field="cost" value="${item.cost}"></div>
                    <div><input type="${costPriceType}" min="0" class="input-google w-full text-right font-mono text-textPrimary dark:text-darkText" data-type="${type}" data-id="${item.id}" data-field="price" value="${item.price}"></div>
                    <div class="text-right font-mono font-bold text-textPrimary dark:text-darkText" id="val-${type}-${item.id}">--</div>
                    <div class="text-right font-mono font-medium" id="pl-${type}-${item.id}">--</div>
                    <div class="text-right font-mono text-textSecondary dark:text-darkTextSec" id="alloc-${type}-${item.id}">--</div>
                    <div class="flex justify-center"><svg onclick="toggleDeletePopover(event, '${type}', '${item.id}')" class="delete-trigger icon-glass btn-icon w-4 h-4 text-gray-300 dark:text-gray-600 cursor-pointer hover:text-red-500 transition-colors" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></div>
                </div>`;
            }).join('');
            container.querySelectorAll('input').forEach(i => i.addEventListener('input', e => handleInput(e.target)));
        }

        // 渲染现金可编辑行，并显示币种选择器。
        function renderCashRows() {
            const container = document.getElementById('cash-inputs');
            if(!container) return;
            document.querySelectorAll('body > .ccy-menu').forEach(m => m.remove());
            const symbolMap = { CNY: '¥', USD: '$', HKD: '$' };
            const inputType = isPrivacyMode ? 'password' : 'number';

            container.innerHTML = state.cash.map(item => {
                const ccy = item.currency || 'CNY';
                const sym = symbolMap[ccy] || '¥';
                const displayVal = isPrivacyMode ? '••••' : `${sym}${item.amount}`;

                return `
                <div class="cash-grid-row px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-white/[0.03] last:border-0 text-sm">
                    <div class="drag-handle"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" /></svg></div>
                    <div><input type="text" class="input-google w-full font-bold text-textPrimary dark:text-darkText" data-type="cash" data-id="${item.id}" data-field="ticker" value="${item.ticker}"></div>
                    <div class="ccy-select-wrap" data-id="${item.id}">
                        <button type="button" class="ccy-select-btn" onclick="toggleCcyMenu(event, '${item.id}')">
                            <span class="ccy-select-label">${ccy}</span>
                            <svg class="ccy-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                        <div class="ccy-menu hidden" id="ccy-menu-${item.id}">
                            <div class="ccy-option ${ccy==='CNY'?'active':''}" data-val="CNY" onclick="selectCcy('${item.id}','CNY')">CNY</div>
                            <div class="ccy-option ${ccy==='USD'?'active':''}" data-val="USD" onclick="selectCcy('${item.id}','USD')">USD</div>
                            <div class="ccy-option ${ccy==='HKD'?'active':''}" data-val="HKD" onclick="selectCcy('${item.id}','HKD')">HKD</div>
                        </div>
                    </div>
                    <div>
                        <input type="${inputType}" min="0" class="input-google w-full text-right font-mono text-textPrimary dark:text-darkText font-bold" data-type="cash" data-id="${item.id}" data-field="amount" value="${item.amount}">
                    </div>
                    <div class="text-right font-mono font-bold text-textPrimary dark:text-darkText" id="val-cash-${item.id}">${displayVal}</div>
                    <div class="text-right font-mono text-textSecondary dark:text-darkTextSec" id="alloc-cash-${item.id}">--</div>
                    <div class="flex justify-center"><svg onclick="toggleDeletePopover(event, 'cash', '${item.id}')" class="delete-trigger icon-glass btn-icon w-4 h-4 text-gray-300 dark:text-gray-600 cursor-pointer hover:text-red-500 transition-colors" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></div>
                </div>`;
            }).join('');
            container.querySelectorAll('input').forEach(i => i.addEventListener('input', e => handleInput(e.target)));
        }

        // 关闭某一个浮动币种菜单。
        function closeCcyMenuById(id) {
            const wrap = document.querySelector(`.ccy-select-wrap[data-id="${id}"]`);
            const menu = document.getElementById(`ccy-menu-${id}`);
            if (menu) {
                menu.classList.add('hidden');
                menu.style.position = '';
                menu.style.top = '';
                menu.style.left = '';
                menu.style.minWidth = '';
                if (wrap) wrap.appendChild(menu);
            }
            if (wrap) wrap.classList.remove('open');
        }

        // 关闭所有币种菜单，但保留当前正在打开的那个。
        function closeAllCcyMenus(exceptId) {
            document.querySelectorAll('.ccy-select-wrap.open').forEach(w => {
                if (w.dataset.id !== exceptId) closeCcyMenuById(w.dataset.id);
            });
        }

        // 根据按钮位置显示或隐藏币种菜单。
        function toggleCcyMenu(event, id) {
            event.stopPropagation();
            closeAllCcyMenus(id);
            const wrap = document.querySelector(`.ccy-select-wrap[data-id="${id}"]`);
            const menu = document.getElementById(`ccy-menu-${id}`);
            if (!wrap || !menu) return;

            if (wrap.classList.contains('open')) {
                closeCcyMenuById(id);
                return;
            }

            const btn = wrap.querySelector('.ccy-select-btn');
            const rect = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (rect.bottom + 6) + 'px';
            menu.style.left = rect.left + 'px';
            menu.style.minWidth = rect.width + 'px';
            document.body.appendChild(menu);
            menu.classList.remove('hidden');
            wrap.classList.add('open');
        }

        // 应用选中的现金币种，并刷新总额。
        function selectCcy(id, value) {
            const symbolMap = { CNY: '¥', USD: '$', HKD: '$' };
            const wrap = document.querySelector(`.ccy-select-wrap[data-id="${id}"]`);
            const menu = document.getElementById(`ccy-menu-${id}`);
            if (wrap) {
                const label = wrap.querySelector('.ccy-select-label');
                if (label) label.innerText = value;
            }
            if (menu) menu.querySelectorAll('.ccy-option').forEach(o => o.classList.toggle('active', o.dataset.val === value));
            closeCcyMenuById(id);
            const prefixEl = document.getElementById(`amt-prefix-${id}`);
            if (prefixEl) prefixEl.innerText = symbolMap[value] || '¥';
            handleCurrencyChange(id, value);
        }

        window.addNewDrawdownRow = function() {
            if (!state.drawdown) state.drawdown = [];
            state.drawdown.push({
                id: 'd' + Date.now().toString(),
                symbol: "",
                high: 0,
                current: 0
            });
            saveData();
            renderDrawdown();
            if (typeof initSortable === 'function') initSortable();
        };

        // 渲染回撤监控列表和各档位进度。
        function renderDrawdown() {
            const container = document.getElementById('drawdown-list');
            if(!container) return;
            container.innerHTML = '';

            const drops = [5, 10, 15, 20, 25, 30];

            state.drawdown.forEach((stock) => {
                const currentDropPercentage = stock.high > 0 ? ((stock.high - stock.current) / stock.high) * 100 : 0;

                let passedDrop = null;
                let nextDrop = null;
                if (stock.high > 0 && currentDropPercentage > 0) {
                    const exceeded = drops.filter(d => currentDropPercentage >= d);
                    if (exceeded.length > 0) passedDrop = Math.max(...exceeded);
                    const upcoming = drops.filter(d => currentDropPercentage < d);
                    if (upcoming.length > 0) nextDrop = Math.min(...upcoming);
                }

                let stepsHTML = '';
                drops.forEach(drop => {
                    const targetPrice = stock.high * (1 - drop / 100);

                    let pillStyle = "border-2 border-gray-100 dark:border-white/[0.05] bg-gray-50 dark:bg-[#28292c]";
                    let labelColor = "text-textSecondary dark:text-darkTextSec";
                    let valColor = "text-textPrimary dark:text-darkText";
                    let progressFill = '';

                    if (drop === passedDrop) {
                        pillStyle = "bg-red-50 dark:bg-red-900/30 border-2 border-red-300 dark:border-red-800/50";
                        labelColor = "text-googleRed";
                        valColor = "text-googleRed";
                    } else if (drop === nextDrop && currentDropPercentage > 0) {
                        pillStyle = "relative overflow-hidden border-2 border-yellow-300 dark:border-yellow-800/50 bg-gray-50 dark:bg-[#28292c]";
                        labelColor = "relative z-10 text-googleYellow";
                        valColor = "relative z-10 text-googleYellow";

                        const prevDrop = passedDrop || 0;
                        let progressPct = ((currentDropPercentage - prevDrop) / (drop - prevDrop)) * 100;
                        progressPct = Math.max(0, Math.min(100, progressPct));

                        progressFill = `<div class="absolute left-0 top-0 bottom-0 bg-yellow-100 dark:bg-yellow-900/40 transition-all duration-500" style="width: ${progressPct}%;"></div>`;
                    }

                    stepsHTML += `
                    <div class="flex flex-col items-center justify-center py-3 px-2 rounded-lg w-[160px] flex-shrink-0 transition-colors ${pillStyle}">
                        ${progressFill}
                        <span class="text-[0.65rem] md:text-xs font-bold ${labelColor} uppercase tracking-tighter mb-1">-${drop}%</span>
                        <span class="text-sm md:text-base font-mono font-bold ${valColor}">${stock.high > 0 ? targetPrice.toFixed(2) : '-.--'}</span>
                    </div>`;
                });

                const row = document.createElement('div');
                row.className = 'dd-row px-4 md:px-8 py-4 md:py-6 flex items-center gap-3 border-b border-gray-50 dark:border-white/[0.03] last:border-0';

                row.innerHTML = `
                    <div class="flex items-center gap-3 w-[190px] flex-shrink-0">
                        <div class="drag-handle cursor-grab text-gray-300 dark:text-gray-600 hover:text-googleBlue px-1" title="Drag to reorder">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16" /></svg>
                        </div>
                        <input type="text" class="input-google w-full font-bold text-lg md:text-1xl uppercase tracking-wide" value="${stock.symbol}" data-id="${stock.id}" data-field="symbol" onchange="handleDrawdownInput(this)" placeholder="SYM">
                    </div>

                    <div class="flex-1 flex justify-center gap-2 overflow-hidden px-2 pl-2 md:pl-4">
                        <div class="flex flex-col items-center justify-center py-3 px-2 rounded-lg border-2 border-green-100 dark:border-green-900/30 bg-green-50 dark:bg-green-900/10 w-[160px] flex-shrink-0">
                            <span class="text-[0.65rem] md:text-xs font-bold text-googleGreen uppercase tracking-tighter mb-1">HIGH</span>
                            <input type="number" min="0" class="w-full text-center bg-transparent border-none p-0 text-sm md:text-base font-mono font-bold text-googleGreen focus:ring-0 outline-none" value="${stock.high || ''}" data-id="${stock.id}" data-field="high" step="0.01" onchange="handleDrawdownInput(this)" placeholder="0.00">
                        </div>
                        ${stepsHTML}
                    </div>

                    <div class="flex items-center gap-3 w-[160px] flex-shrink-0 justify-end">
                        <div class="text-right mr-2 md:mr-4">
                            <div class="text-[0.65rem] md:text-xs font-bold text-textSecondary dark:text-darkTextSec uppercase tracking-tighter mb-1 pr-1">Current</div>
                            <div class="text-lg md:text-2xl font-mono font-bold ${currentDropPercentage > 0 ? 'text-googleRed' : 'text-googleGreen'}">${stock.current > 0 ? stock.current.toFixed(2) : '-.--'}</div>
                        </div>

                        <div class="w-6 flex justify-end items-center">
                            <svg onclick="toggleDeletePopover(event, 'drawdown', '${stock.id}')" class="delete-trigger w-4 h-4 text-gray-300 dark:text-[#5f6368] cursor-pointer hover:text-[#df8c8c] transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </div>
                    </div>
                `;
                container.appendChild(row);
            });
        }

        // 在日历的每日视图和年度视图之间切换。
        function switchView(view) {
            const tabDaily = document.getElementById('tab-daily');
            const tabYearly = document.getElementById('tab-yearly');
            const viewDaily = document.getElementById('view-daily');
            const viewYearly = document.getElementById('view-yearly');
            const controlsDaily = document.getElementById('controls-daily');
            const controlsYearly = document.getElementById('controls-yearly');

            const activeClasses = ['bg-white', 'dark:bg-darkSurface', 'shadow-sm', 'text-textPrimary', 'dark:text-darkText'];
            const inactiveClasses = ['text-textSecondary', 'dark:text-darkTextSec', 'hover:text-textPrimary', 'dark:hover:text-darkText'];

            if (view === 'daily') {
                tabDaily.classList.add(...activeClasses);
                tabDaily.classList.remove(...inactiveClasses);
                tabYearly.classList.add(...inactiveClasses);
                tabYearly.classList.remove(...activeClasses);

                viewDaily.classList.remove('hidden');
                controlsDaily.classList.remove('hidden');
                viewYearly.classList.add('hidden');
                controlsYearly.classList.add('hidden');
            } else {
                tabYearly.classList.add(...activeClasses);
                tabYearly.classList.remove(...inactiveClasses);
                tabDaily.classList.add(...inactiveClasses);
                tabDaily.classList.remove(...activeClasses);

                viewYearly.classList.remove('hidden');
                controlsYearly.classList.remove('hidden');
                viewDaily.classList.add('hidden');
                controlsDaily.classList.add('hidden');
            }
        }

        // 日历显示模式：每日盈亏、每日百分比、总资产。
        function setCalendarView(mode) {
            calViewMode = mode;
            const activeClasses = ['bg-white', 'dark:bg-darkSurface', 'shadow-sm', 'text-blue-600', 'dark:text-blue-400'];
            const inactiveClasses = ['text-textSecondary', 'dark:text-darkTextSec', 'hover:text-textPrimary', 'dark:hover:text-darkText'];

            for (let i = 0; i <= 2; i++) {
                const btn = document.getElementById(`view-mode-${i}`);
                if (i === mode) {
                    btn.classList.add(...activeClasses);
                    btn.classList.remove(...inactiveClasses);
                } else {
                    btn.classList.add(...inactiveClasses);
                    btn.classList.remove(...activeClasses);
                }
            }
            renderCalendar();
        }

        // 从年度汇总跳转到指定月份。
        function jumpToMonth(monthIndex) {
            displayDate.setMonth(monthIndex);
            renderCalendar();
            renderYearlySummary();
            switchView('daily');
        }

        // 每日历按月份前后切换。
        function changeMonth(offset) {
            displayDate.setMonth(displayDate.getMonth() + offset);
            renderCalendar();
        }

        // 年度汇总按年份前后切换。
        function changeYear(offset) {
            displayDate.setFullYear(displayDate.getFullYear() + offset);
            renderYearlySummary();
            renderCalendar();
        }

        // 渲染当前年份 12 个月的盈亏汇总。
        function renderYearlySummary() {
            const currentYear = displayDate.getFullYear();
            const yearBadge = document.getElementById('current-year-badge');
            if (yearBadge) yearBadge.innerText = currentYear;

            const yearDisplay = document.getElementById('cal-year-display');
            if (yearDisplay) yearDisplay.innerText = currentYear;

            const monthlyData = new Array(12).fill(0);
            let ytdTotal = 0;

            state.history.forEach(record => {
                if (!record.date) return;
                const parts = record.date.split('-');
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]) - 1;

                if (year === currentYear) {
                    const pl = record.pl || 0;
                    monthlyData[month] += pl;
                    ytdTotal += pl;
                }
            });

            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const grid = document.getElementById('monthly-grid');

            if (grid) {
                grid.innerHTML = monthlyData.map((val, index) => {
                    const isPos = val >= 0;
                    const valText = isPrivacyMode ? '••••' : (val === 0 ? '0.00' : (isPos ? '+' + val.toFixed(2) : val.toFixed(2)));

                    let colorClass = 'text-gray-400 dark:text-gray-500';
                    let bgClass = 'bg-gray-50 dark:bg-darkBg';

                    if (!isPrivacyMode) {
                        if (val > 0) {
                            colorClass = 'text-stockGreen dark:text-green-300';
                            bgClass = 'bg-stockGreenBg dark:bg-green-900/20';
                        } else if (val < 0) {
                            colorClass = 'text-stockRed dark:text-red-300';
                            bgClass = 'bg-stockRedBg dark:bg-red-900/20';
                        }
                    }

                    return `
                        <div onclick="jumpToMonth(${index})" class="py-4 md:py-6 px-2 md:px-3 min-h-[140px] md:min-h-[200px] rounded-lg ${bgClass} flex flex-col items-center justify-center cursor-pointer hover:-translate-y-1.5 transition-all duration-300">
                            <span class="text-xs md:text-sm font-bold text-gray-500 dark:text-darkTextSec uppercase mb-2 md:mb-3">${monthNames[index]}</span>
                            <span class="text-xl md:text-2xl font-bold font-mono tracking-tight ${colorClass}">${valText}</span>
                        </div>
                    `;
                }).join('');
            }

            const totalEl = document.getElementById('yearly-total');
            if (totalEl) {
                if (isPrivacyMode) {
                    totalEl.innerText = '••••';
                    totalEl.className = 'text-2xl md:text-3xl font-bold font-mono tracking-tight text-gray-400 dark:text-gray-500';
                } else {
                    const isPos = ytdTotal >= 0;
                    totalEl.innerText = (isPos ? '+' : '') + ytdTotal.toFixed(2);

                    if (ytdTotal > 0) {
                        totalEl.className = 'text-2xl md:text-3xl font-bold font-mono tracking-tight text-stockGreen dark:text-green-300';
                    } else if (ytdTotal < 0) {
                        totalEl.className = 'text-2xl md:text-3xl font-bold font-mono tracking-tight text-stockRed dark:text-red-300';
                    } else {
                        totalEl.className = 'text-2xl md:text-3xl font-bold font-mono tracking-tight text-gray-400 dark:text-gray-500';
                    }
                }
            }
        }

        // 根据每日历史记录渲染月历。
        function renderCalendar() {
            const year = displayDate.getFullYear();
            const month = displayDate.getMonth();
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

            document.getElementById('cal-month-display').innerText = `${monthNames[month]} ${year}`;
            const grid = document.getElementById('calendar-grid');
            if(!grid) return;
            grid.innerHTML = '';

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const calData = {};
            state.history.forEach(item => {
                calData[item.date] = {
                    total: item.total || item.value || 0,
                    pl: item.pl || 0,
                    rate: item.rate || 0,
                    netFlow: item.netFlow || 0
                };
            });

            for (let i = 0; i < firstDay; i++) { grid.innerHTML += `<div></div>`; }

            const localDate = new Date();
            const todayStr = `${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;

            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const data = calData[dateStr];
                const isToday = (dateStr === todayStr);

                let bgClass = "bg-gray-50 dark:bg-darkBg";
                let textClass = "text-gray-400 dark:text-darkTextSec";
                let dayText = day;
                let valHtml = `<span class="text-xs md:text-sm text-transparent">0</span>`;
                let flowHtml = '';

                if (data) {
                    const isPos = data.pl >= 0;
                    let displayVal = '';

                    if (isPrivacyMode && calViewMode !== 1) {
                        displayVal = '••••';
                        textClass = "text-gray-500 dark:text-darkTextSec";
                        bgClass = "bg-gray-100 dark:bg-[#3c4043]";
                    } else {
                        if (calViewMode === 0) {
                            const roundedPl = Math.round(data.pl);
                            displayVal = isPos ? `+${roundedPl}` : `${roundedPl}`;
                            textClass = isPos ? "text-stockGreen dark:text-green-300" : "text-stockRed dark:text-red-300";
                            bgClass = isPos ? "bg-stockGreenBg dark:bg-green-900/20" : "bg-stockRedBg dark:bg-red-900/20";
                        } else if (calViewMode === 1) {
                            displayVal = isPos ? `+${data.rate.toFixed(1)}%` : `${data.rate.toFixed(1)}%`;
                            textClass = isPos ? "text-stockGreen dark:text-green-300" : "text-stockRed dark:text-red-300";
                            bgClass = isPos ? "bg-stockGreenBg dark:bg-green-900/20" : "bg-stockRedBg dark:bg-red-900/20";
                        } else {
                            displayVal = `${Math.round(data.total)}`;
                            textClass = "text-gray-900 dark:text-gray-100";
                            bgClass = isPos ? "bg-stockGreenBg dark:bg-green-900/20" : "bg-stockRedBg dark:bg-red-900/20";
                        }

                        if (!isPrivacyMode && data.netFlow && Math.abs(data.netFlow) > 5) {
                            let fv = Math.round(data.netFlow);
                            let sign = fv > 0 ? '+' : '-';
                            let fText = `${sign}${Math.abs(fv)}`;
                            const fColor = 'text-yellow-400 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-800/50';
                            flowHtml = `<div class="absolute top-1.5 right-1 md:top-1.5 md:right-1.5 text-[0.5rem] md:text-[0.55rem] font-bold ${fColor} px-1 rounded shadow-sm tracking-tighter leading-none h-[14px] md:h-[16px] flex items-center justify-center" title="Cash Flow">${fText}</div>`;
                        }
                    }

                    valHtml = `<span class="text-[0.6rem] md:text-sm lg:text-base font-bold font-mono tracking-tighter leading-none text-center w-full px-0.5 ${textClass}">${displayVal}</span>`;
                } else if (isToday) {
                    bgClass = "bg-gray-50 dark:bg-darkBg";
                }

                grid.innerHTML += `
                    <div class="relative flex flex-col justify-center items-center pt-3 pb-1 md:pt-0 md:pb-0 md:py-4 min-h-[50px] md:min-h-[80px] rounded-lg w-full transition-all hover:brightness-95 cursor-default ${bgClass}">
                        ${flowHtml}
                        <span class="absolute top-1.5 left-1.5 md:static md:top-auto md:left-auto text-[0.6rem] md:text-xs font-bold text-gray-400 dark:text-gray-500 leading-none h-[14px] md:h-auto flex items-center md:mb-1">${dayText}</span>
                        ${valHtml}
                    </div>
                `;
            }
        }

        // 通过腾讯行情接口更新 A 股价格。
        function updateCnStockPrices() {
            const icon = document.getElementById('refresh-icon-cn');
            if (icon) icon.classList.add('animate-spin');

            const rawSymbols = state.cn.map(item => item.ticker.toLowerCase()).filter(t => t && t !== 'new');
            if (rawSymbols.length === 0) {
                if (icon) icon.classList.remove('animate-spin');
                return;
            }

            const script = document.createElement('script');
            script.src = `https://qt.gtimg.cn/q=${rawSymbols.join(',')}&t=${Date.now()}`;

            script.onload = function() {
                let updatedCount = 0;
                rawSymbols.forEach(symbol => {
                    const dataStr = window['v_' + symbol];
                    if (dataStr) {
                        const parts = dataStr.split('~');
                        const price = parseFloat(parts[3]);
                        const stock = state.cn.find(i => i.ticker.toLowerCase() === symbol);
                        if (stock && price > 0) { stock.price = price; updatedCount++; }
                    }
                });

                if (updatedCount > 0) { saveData(); renderAllRows(); calculate(); }
                if (icon) icon.classList.remove('animate-spin');
                document.body.removeChild(script);
            };
            script.onerror = function() {
                if (icon) icon.classList.remove('animate-spin');
            };
            document.body.appendChild(script);
        }

        // 通过 Finnhub 更新美股价格。
        async function updateUsStockPrices() {
            const apiKey = localStorage.getItem('finnhub_key');
            if (!apiKey) return alert('Please configure Finnhub API Key in System Settings first');

            const icon = document.getElementById('refresh-icon');
            if(icon) icon.classList.add('animate-spin');
            let updatedCount = 0;

            for (let item of state.usd) {
                if (!item.ticker || item.ticker === 'New') continue;
                try {
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.ticker}&token=${apiKey}`);
                    const data = await res.json();
                    if (data.c) { item.price = data.c; updatedCount++; }
                } catch (e) { }
            }

            if (updatedCount > 0) { saveData(); renderAllRows(); calculate(); }
            if(icon) icon.classList.remove('animate-spin');
        }

        // 单独更新 SGOV 价格，方便作为类现金资产显示。
        async function updateSgovPrices() {
            const apiKey = localStorage.getItem('finnhub_key');
            if (!apiKey) return alert('Please configure Finnhub API Key in System Settings first');

            const icon = document.getElementById('refresh-icon-sgov');
            if(icon) icon.classList.add('animate-spin');
            let updatedCount = 0;

            for (let item of state.sgov) {
                if (!item.ticker || item.ticker === 'New') continue;
                try {
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.ticker}&token=${apiKey}`);
                    const data = await res.json();
                    if (data.c) { item.price = data.c; updatedCount++; }
                } catch (e) { }
            }

            if (updatedCount > 0) { saveData(); renderAllRows(); calculate(); }
            if(icon) icon.classList.remove('animate-spin');
        }

        // 刷新回撤监控使用的当前价格。
        async function fetchDrawdownPrices() {
            const fhKey = localStorage.getItem('finnhub_key');
            if (!fhKey) return;

            const icon = document.getElementById('refresh-icon-dd');
            if(icon) icon.classList.add('animate-spin');

            let hasChanges = false;
            for (let i = 0; i < state.drawdown.length; i++) {
                if (!state.drawdown[i].symbol || state.drawdown[i].symbol === 'NEW') continue;
                try {
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${state.drawdown[i].symbol}&token=${fhKey}`);
                    const data = await res.json();
                    if (data && data.c && data.c !== 0) {
                        state.drawdown[i].current = data.c;
                        hasChanges = true;
                    }
                } catch (err) {}
            }
            if (hasChanges) { saveData(); renderDrawdown(); renderDDAlerts(); }
            if(icon) icon.classList.remove('animate-spin');
        }

        // 获取最新 USD/CNY 汇率，并重新计算页面。
        async function fetchLiveRate() {
            const icon = document.querySelector('svg[onclick="fetchLiveRate()"]');
            if(icon) icon.classList.add('animate-spin');
            try {
                const res = await fetch('https://open.er-api.com/v6/latest/USD');
                const data = await res.json();
                if (data.rates.CNY) {
                    document.getElementById('fx-rate').value = data.rates.CNY.toFixed(4);
                    saveData(); calculate();
                }
            } catch (error) {}
            finally { if(icon) icon.classList.remove('animate-spin'); }
        }

        // 给指定资产区域新增一行。
        function addItem(type) {
            const id = Date.now().toString();
            if (type === 'usd') state.usd.push({ id, ticker: 'New', shares: 0, cost: 0, price: 0 });
            else if (type === 'cn') state.cn.push({ id, ticker: 'New', shares: 0, cost: 0, price: 0 });
            else if (type === 'sgov') state.sgov.push({ id, ticker: 'SGOV', shares: 0, cost: 0, price: 0 });
            else if (type === 'cash') state.cash.push({ id, ticker: 'New', amount: 0, currency: 'CNY' });

            saveData(); renderAllRows(); calculate(); initSortable();
        }

        // 隐藏或显示页面上的敏感数字。
        function togglePrivacy() {
            isPrivacyMode = !isPrivacyMode;
            localStorage.setItem('portfolio_privacy', isPrivacyMode);
            const openEye = document.getElementById('eye-open');
            const closedEye = document.getElementById('eye-closed');
            if (isPrivacyMode) { openEye.classList.add('hidden'); closedEye.classList.remove('hidden'); }
            else { openEye.classList.remove('hidden'); closedEye.classList.add('hidden'); }

            renderAllRows();
            calculate();
            initSortable();
        }

        // 切换深色模式，并刷新会受主题影响的组件。
        function toggleTheme() {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            updateChartTheme(isDark);
            setTimeout(loadTradingViewTicker, 50);
            renderCalendar();
            renderYearlySummary();
            if (charts.networth) { charts.networth.destroy(); charts.networth = null; renderNetWorthChart(); }
        }

        // 页面加载时恢复上次选择的主题。
        function loadTheme() {
            if (localStorage.getItem('theme') === 'dark') {
                document.documentElement.classList.add('dark');
            }
        }

        // 让 Chart.js 的颜色跟随当前主题。
        function updateChartTheme(isDark) {
            const textColor = isDark ? '#e8eaed' : '#5f6368';
            Chart.defaults.color = textColor;
            Chart.defaults.borderColor = isDark ? '#3c4043' : '#e5e7eb';
            Object.values(charts).forEach(chart => {
                if(!chart) return;
                if(chart.options.plugins && chart.options.plugins.tooltip) {
                    chart.options.plugins.tooltip.backgroundColor = isDark ? '#303134' : '#fff';
                    chart.options.plugins.tooltip.bodyColor = isDark ? '#e8eaed' : '#5f6368';
                    chart.options.plugins.tooltip.borderColor = isDark ? '#5f6368' : '#dadce0';
                }
                chart.update();
            });
        }

        // 在点击的删除图标旁显示确认删除浮层。
        function toggleDeletePopover(event, type, id) {
            event.stopPropagation();
            const popover = document.getElementById('delete-popover');
            if(itemToDelete && itemToDelete.id === id && !popover.classList.contains('hidden')) return closePopover();
            itemToDelete = { type, id };
            const rect = event.currentTarget.getBoundingClientRect();
            popover.style.top = (window.scrollY + rect.top + 20) + 'px';
            popover.style.left = (window.scrollX + rect.left - 130) + 'px';
            popover.classList.remove('hidden');
            requestAnimationFrame(() => { popover.classList.remove('opacity-0', 'scale-95'); popover.classList.add('opacity-100', 'scale-100'); });
        }

        // 隐藏确认删除浮层。
        function closePopover() {
            const popover = document.getElementById('delete-popover');
            popover.classList.remove('opacity-100', 'scale-100');
            popover.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { popover.classList.add('hidden'); itemToDelete = null; }, 100);
        }

        // 点击页面其他位置时，关闭浮动菜单。
        function handleBodyClick(event) {
            if (!document.getElementById('delete-popover').contains(event.target) && !event.target.closest('.delete-trigger')) closePopover();
            if (!event.target.closest('.ccy-select-wrap') && !event.target.closest('.ccy-menu')) {
                closeAllCcyMenus(null);
            }
        }

        // 确认删除当前选中的资产行。
        document.getElementById('popover-confirm-btn').addEventListener('click', () => {
            if (itemToDelete) {
                if (itemToDelete.type === 'drawdown') {
                    state.drawdown = state.drawdown.filter(i => i.id !== itemToDelete.id);
                    renderDrawdown();
                    renderDDAlerts();
                } else {
                    state[itemToDelete.type] = state[itemToDelete.type].filter(i => i.id !== itemToDelete.id);
                    if(itemToDelete.type === 'cash') renderCashRows();
                    else renderRows(itemToDelete.type, state[itemToDelete.type], itemToDelete.type === 'cn' ? '¥' : '$');
                    calculate();
                }
                saveData();
                closePopover();
            }
        });

        // 处理资产行输入变化，并立即重新计算。
        function handleInput(t) {
            if(t.id==='fx-rate'){calculate();return;}
            let val = t.type==='number' ? parseFloat(t.value)||0 : t.value;
            if (t.type === 'number' && val < 0) { val = 0; t.value = 0; }
            const item=state[t.dataset.type].find(x=>x.id===t.dataset.id);
            if(item){
                if(t.dataset.type==='cash'&&t.dataset.field==='amount') item.amount=val;
                else item[t.dataset.field]=val;
                calculate();
            }
        }

        // 处理回撤监控行的输入变化。
        function handleDrawdownInput(t) {
            let val = t.type === 'number' ? parseFloat(t.value) || 0 : t.value.toUpperCase();
            if (t.type === 'number' && val < 0) { val = 0; t.value = 0; }
            const item = state.drawdown.find(x => x.id === t.dataset.id);
            if(item) {
                item[t.dataset.field] = val;
                if (t.dataset.field === 'high' && item.current === 0 && item.high > 0) {
                    item.current = item.high;
                }
                saveData();
                renderDrawdown();
                renderDDAlerts();
                if (t.dataset.field === 'symbol' && item.symbol) fetchDrawdownPrices();
            }
        }

        // 更新某一行现金的币种。
        function handleCurrencyChange(id, v) { const i=state.cash.find(x=>x.id===id); if(i){ i.currency=v; saveData(); calculate(); } }

        // 初始化 Chart.js 环形图和自定义百分比标签。
        function initCharts() {
            Chart.defaults.font.family = '"Google Sans", "Roboto", sans-serif';
            const tooltipCallback = {
                label: function(ctx) {
                    const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) + '%' : '0%';
                    return ` ${ctx.label || ''}: ${ctx.raw.toFixed(2)} (${pct})`;
                }
            };

            const opts = (cutout) => ({ responsive: true, maintainAspectRatio: false, borderWidth: 0, cutout: cutout, layout: { padding: 0 }, plugins: { legend: { display: false }, tooltip: { enabled: true, borderWidth: 1, callbacks: tooltipCallback } } });

            const segPlugin = {
                id: 'segmentLabels',
                afterDatasetsDraw(chart) {
                    const { ctx, data } = chart;
                    ctx.save();
                    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                    chart.getDatasetMeta(0).data.forEach((dp, i) => {
                        const pct = total > 0 ? (data.datasets[0].data[i] / total * 100) : 0;
                        if (pct > 5) {
                            const { x, y } = dp.tooltipPosition();
                            ctx.font = '14px "Roboto Mono"';
                            if(window.innerWidth > 768) ctx.font = '18px "Roboto Mono"';
                            ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText(pct.toFixed(0) + '%', x, y);
                        }
                    });
                    ctx.restore();
                }
            };

            const cm = document.getElementById('chart-main');
            if(cm) charts.main = new Chart(cm.getContext('2d'), { type: 'doughnut', data: { labels: ['US Stocks', 'CN Stocks', 'Cash', 'SGOV'], datasets: [{ data: [1,1,1,1], backgroundColor: ['#1a73e8', '#fbbc04', '#34a853', '#277ef1'], hoverOffset: 4 }] }, options: opts('55%'), plugins: [segPlugin] });
        }

        // 把新数据写入已有图表。
        function updateChart(c, d) { if(c) { c.data.datasets[0].data = d; c.update(); } }

        // 启用资产行拖拽排序。
        function initSortable() {
            ['usd-inputs', 'cn-inputs', 'sgov-inputs', 'cash-inputs', 'drawdown-list'].forEach(id => {
                const el = document.getElementById(id);
                if (el) Sortable.create(el, { handle: '.drag-handle', animation: 150, ghostClass: 'bg-blue-50', onEnd: (evt) => {
                    const typeMap = { 'usd-inputs': 'usd', 'cn-inputs': 'cn', 'sgov-inputs': 'sgov', 'cash-inputs': 'cash', 'drawdown-list': 'drawdown' };
                    const type = typeMap[id];
                    const list = state[type];
                    const item = list.splice(evt.oldIndex, 1)[0];
                    list.splice(evt.newIndex, 0, item);
                    saveData();
                    if (type === 'drawdown') renderDrawdown();
                    else calculate();
                }});
            });
        }

        // 重建 TradingView 底部行情条，并同步当前主题。
        function loadTradingViewTicker() {
            const container = document.getElementById('tv-ticker-container');
            if (!container) return;
            container.innerHTML = '';
            const widgetDiv = document.createElement('div');
            widgetDiv.className = 'tradingview-widget-container__widget';
            container.appendChild(widgetDiv);

            const isDark = document.documentElement.classList.contains('dark');
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js';
            script.async = true;
            script.innerHTML = JSON.stringify({
                "symbols": [ { "proName": "FOREXCOM:SPXUSD", "title": "S&P 500" }, { "proName": "FOREXCOM:NSXUSD", "title": "US 100" }, { "proName": "FX_IDC:USDCNY", "title": "USD/CNY" }, { "proName": "BITSTAMP:BTCUSD", "title": "Bitcoin" }, { "description": "Gold", "proName": "TVC:GOLD" } ],
                "showSymbolLogo": true, "colorTheme": isDark ? "dark" : "light", "isTransparent": false, "displayMode": "adaptive", "locale": "en"
            });
            container.appendChild(script);
        }

        // 卡片进入视口时播放一次淡入动画。
        function initScrollReveal() {
            document.querySelectorAll('.g-card-static').forEach(card => {
                card.classList.add('reveal-card');
            });

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('active');
                        observer.unobserve(entry.target);
                    }
                });
            }, {
                threshold: 0.1,
                rootMargin: "0px 0px -50px 0px"
            });

            document.querySelectorAll('.reveal-card').forEach(el => observer.observe(el));
        }

        // 页面平滑滚动引擎。
        const lenis = new Lenis({
            duration: 1.2,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            smooth: true
        });

        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);

        // 后台刷新行情和汇率，并设置冷却时间避免频繁请求。
        function autoRefreshPrices(force = false) {
            const lastRefresh = localStorage.getItem('last_auto_refresh');
            const now = Date.now();
            const cooldown = 10 * 60 * 1000;

            if (force || !lastRefresh || (now - parseInt(lastRefresh)) > cooldown) {
                updateCnStockPrices();
                fetchLiveRate();
                if (localStorage.getItem('finnhub_key')) {
                    updateUsStockPrices();
                    updateSgovPrices();
                    fetchDrawdownPrices();
                }
                localStorage.setItem('last_auto_refresh', now.toString());
            }
        }

        // 在中美市场可能收盘后自动备份到 GitHub。
        async function autoSmartBackup() {
            const now = new Date();
            const hour = now.getHours();
            const dateStr = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;

            const lastCnBackup = localStorage.getItem('backup_cn_date');
            const lastUsBackup = localStorage.getItem('backup_us_date');

            let shouldBackup = false;

            if (hour >= 15 && lastCnBackup !== dateStr) {
                shouldBackup = true;
                localStorage.setItem('backup_cn_date', dateStr);
            }
            else if (hour >= 5 && hour < 15 && lastUsBackup !== dateStr) {
                shouldBackup = true;
                localStorage.setItem('backup_us_date', dateStr);
            }

            if (shouldBackup) {
                setTimeout(() => {
                    pushToGithub(true);
                }, 10000);
            }
        }

        // VOO/QQQM 回撤距离的小提醒卡片。
        function renderDDAlerts() {
            const container = document.getElementById('dd-alert-list');
            if (!container) return;

            const targetSymbols = ['VOO', 'QQQM'];
            const filteredDrawdown = (state.drawdown || []).filter(stock => 
                stock.symbol && targetSymbols.includes(stock.symbol.toUpperCase())
            );

            if (filteredDrawdown.length === 0) {
                container.innerHTML = '<div class="text-xs font-mono text-textSecondary dark:text-darkTextSec py-2">未追踪 VOO 或 QQQM。</div>';
                return;
            }

            const drops = [5, 10, 15, 20, 25, 30];
            let html = '';

            filteredDrawdown.forEach(stock => {
                const currentDropPercentage = stock.high > 0 ? ((stock.high - stock.current) / stock.high) * 100 : 0;
                let nextDrop = drops.find(d => currentDropPercentage < d) || 30;
                let prevDrop = drops.slice().reverse().find(d => currentDropPercentage >= d) || 0;
                
                stock.distance = nextDrop - currentDropPercentage;
                stock.progressPct = ((currentDropPercentage - prevDrop) / (nextDrop - prevDrop)) * 100;
                stock.nextDrop = nextDrop;
            });

            filteredDrawdown.sort((a, b) => a.distance - b.distance);

            filteredDrawdown.forEach((stock, index) => {
                let tagText, barColor, tagBg, rowClass;

				if (stock.distance < 1.0) {
				tagText = 'Alert';
				barColor = 'bg-googleRed';
				tagBg = 'bg-red-50 dark:bg-red-900/30 text-googleRed';
				rowClass = index === 0 ? 'bg-red-50/50 dark:bg-red-900/10 rounded-xl animate-pulse-bg' : 'bg-red-50/30 dark:bg-red-900/5 rounded-xl';
			} else if (stock.distance <= 3.0) {
				tagText = 'Monitor';
				barColor = 'bg-googleYellow';
				tagBg = 'bg-yellow-50 dark:bg-yellow-900/20 text-googleYellow';
				rowClass = 'bg-yellow-50/50 dark:bg-yellow-900/10 rounded-xl';
			} else {
				tagText = 'Safe';
				barColor = 'bg-gray-300 dark:bg-gray-600';
				tagBg = 'bg-gray-100 dark:bg-gray-800 text-gray-500';
				rowClass = 'bg-gray-50 dark:bg-gray-800/40 rounded-xl opacity-80';
			}

                const displayDist = stock.distance.toFixed(1);

html += `
                <div class="flex flex-col gap-1.5 ${rowClass}" style="padding-top: 14px; padding-bottom: 24px; padding-left: 20px; padding-right: 20px;">
                    <div class="flex justify-between items-center text-xs text-textPrimary dark:text-darkText">
                        <div class="flex items-baseline gap-2">
                    <span class="font-bold font-mono text-xs ${stock.symbol === 'QQQM' ? 'text-gray-900 dark:text-gray-100' : ''}">
							${stock.symbol}
				</span>
                            <span class="text-xs font-mono text-textSecondary dark:text-darkTextSec"> ${displayDist}% to -${stock.nextDrop}% </span>
                        </div>
                        <span class="text-[0.6rem] font-bold px-1.5 py-0.5 rounded ${tagBg}">${tagText}</span>
                    </div>
                    <div class="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div class="h-full ${barColor} rounded-full transition-all duration-500" style="width: ${Math.max(0, Math.min(100, stock.progressPct))}%"></div>
                    </div>
                </div>`;
            });

            container.innerHTML = html;
        }

        // 页面启动顺序：恢复状态、绘制界面、再刷新外部数据。
        window.onload = function() {
            if (isPrivacyMode) {
                document.getElementById('eye-open').classList.add('hidden');
                document.getElementById('eye-closed').classList.remove('hidden');
            }
            initCharts();
            loadTheme();
            renderAllRows();
            renderDrawdown();
            setNwRange(90);
            calculate();
            initSortable();
            document.getElementById('fx-rate').addEventListener('input', calculate);
            loadTradingViewTicker();
            initScrollReveal();
            autoRefreshPrices();
            autoSmartBackup();
        };
