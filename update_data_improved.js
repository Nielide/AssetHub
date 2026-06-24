const fs = require('fs');

// 读取你的数据文件
const dataPath = './data.json';
let state = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// === 确保所有核心字段存在，防止报错 ===
if (!state.history) state.history = [];
if (!state.usd) state.usd = [];
if (!state.cn) state.cn = [];
if (!state.cash) state.cash = [];
if (!state.sgov) state.sgov = []; // 【修复】补充 SGOV
if (!state.drawdown) state.drawdown = []; // 【修复】补充 Drawdown
if (!state.fxRate) state.fxRate = 7.25;
if (!state.hkdFx) state.hkdFx = 0.93; // 【修复】补充港币汇率

// 获取环境变量中的 Finnhub 密钥
const FINNHUB_KEY = process.env.FINNHUB_KEY;

function fetchWithTimeout(url, timeout = 10000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

// ============ 汇率更新 ============
async function updateFXRate() {
    try {
        const fxRes = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 8000);
        if (!fxRes.ok) throw new Error(`HTTP ${fxRes.status}`);
        const fxData = await fxRes.json();
        
        if (fxData && fxData.rates && fxData.rates.CNY) {
            state.fxRate = Math.round(fxData.rates.CNY * 10000) / 10000;
            console.log("✅ 汇率更新成功:", state.fxRate);
            return true;
        }
    } catch(e) {
        console.error("❌ 汇率更新失败 (方案1):", e.message);
        try {
            const res2 = await fetchWithTimeout('https://api.exchangerate-api.com/v4/latest/USD', 8000);
            if (res2.ok) {
                const data = await res2.json();
                if (data.rates && data.rates.CNY) {
                    state.fxRate = Math.round(data.rates.CNY * 10000) / 10000;
                    console.log("✅ 汇率更新成功 (备选方案):", state.fxRate);
                    return true;
                }
            }
        } catch(e2) {
            console.error("❌ 备选汇率方案也失败:", e2.message);
        }
    }
    console.warn("⚠️ 汇率未更新，使用上次值:", state.fxRate);
    return false;
}

// ============ Finnhub 数据更新 (USD, SGOV, Drawdown) ============
async function updateFinnhubData() {
    if (!FINNHUB_KEY) {
        console.log("⏭️ 跳过美股相关更新 (无密钥)");
        return;
    }

    // 收集所有需要通过 Finnhub 查询的 ticker (去重)
    const symbolsToFetch = new Set();
    state.usd.forEach(i => { if (i.ticker && i.ticker !== 'New') symbolsToFetch.add(i.ticker); });
    state.sgov.forEach(i => { if (i.ticker && i.ticker !== 'New') symbolsToFetch.add(i.ticker); });
    state.drawdown.forEach(i => { if (i.symbol && i.symbol !== 'NEW') symbolsToFetch.add(i.symbol); });

    let successCount = 0;
    
    // 遍历抓取最新价格
    for (let symbol of symbolsToFetch) {
        try {
            const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`, 8000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            if (data.c && typeof data.c === 'number' && data.c > 0) {
                const price = data.c;
                // 分别更新三个数组中的价格
                state.usd.filter(i => i.ticker === symbol).forEach(i => i.price = price);
                state.sgov.filter(i => i.ticker === symbol).forEach(i => i.price = price);
                state.drawdown.filter(i => i.symbol === symbol).forEach(i => {
                    i.current = price;
                    if (i.current === 0 && i.high > 0) i.current = i.high;
                });
                
                console.log(`✅ 美股/标的 ${symbol} 更新成功: $${price}`);
                successCount++;
            }
        } catch(e) {
            console.error(`❌ 美股/标的 ${symbol} 更新失败:`, e.message);
        }
    }
    console.log(`📊 Finnhub 数据更新完成: ${successCount}/${symbolsToFetch.size} 成功`);
}

// ============ A股数据更新 ============
async function updateCNStocks() {
    const symbols = state.cn.map(i => i.ticker.toLowerCase()).filter(t => t && t !== 'new');
    if (symbols.length === 0) return;

    let successCount = 0;
    try {
        const res = await fetchWithTimeout(`https://qt.gtimg.cn/q=${symbols.join(',')}`, 10000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        
        symbols.forEach(symbol => {
            try {
                const regex = new RegExp(`v_${symbol}="([^"]*)"`, 'i');
                const match = text.match(regex);
                if (match && match[1]) {
                    const parts = match[1].split('~');
                    const price = parseFloat(parts[3]);
                    if (price > 0) {
                        const stock = state.cn.find(i => i.ticker.toLowerCase() === symbol);
                        if (stock) {
                            stock.price = price;
                            console.log(`✅ A股 ${symbol.toUpperCase()} 更新成功: ¥${price}`);
                            successCount++;
                        }
                    }
                }
            } catch(e) {
                console.error(`❌ A股 ${symbol.toUpperCase()} 解析失败:`, e.message);
            }
        });
    } catch(e) {
        console.error("❌ A股更新失败:", e.message);
    }
    console.log(`📊 A股更新完成: ${successCount}/${symbols.length} 成功`);
}

// ============ 【修复】资产计算逻辑 (保持与前端完全一致) ============
function calculateAssets() {
    const fx = state.fxRate || 7.25;
    const hkdFx = state.hkdFx || 0.93;
    
    // 计算成本
    const totalUsdStockCost = state.usd.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    const totalCnStockCost = state.cn.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    const totalSgovCost = state.sgov.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    
    // 计算现值
    const totalUsdStockVal = state.usd.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    const totalCnStockVal = state.cn.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    const totalSgovVal = state.sgov.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    
    // 现金 (修复港币逻辑)
    let totalUsdCashVal = 0, totalRmbCashVal = 0, totalHkdCashVal = 0;
    state.cash.forEach(i => {
        if (i.currency === 'USD') totalUsdCashVal += i.amount;
        else if (i.currency === 'HKD') totalHkdCashVal += i.amount;
        else totalRmbCashVal += i.amount;
    });
    
    // 总值与总成本
    const currentTotalCost = Math.round((totalUsdStockCost + totalUsdCashVal + totalSgovCost) * fx + (totalHkdCashVal * hkdFx) + totalCnStockCost + totalRmbCashVal);
    
    const totalUsdAssets = totalUsdStockVal + totalUsdCashVal + totalSgovVal;
    const totalHkdAssets = totalHkdCashVal;
    const totalRmbAssets = totalCnStockVal + totalRmbCashVal;
    
    const grandTotal = Math.round((totalUsdAssets * fx) + (totalHkdAssets * hkdFx) + totalRmbAssets);

    return { grandTotal, currentTotalCost, totalUsdAssets, totalRmbAssets };
}

// ============ 历史记录更新 ============
function updateHistory(assets) {
    const { grandTotal, currentTotalCost } = assets;
    
    // 获取北京时间
    const bjTime = new Date(new Date().getTime() + 8 * 3600 * 1000);
    const todayStr = bjTime.toISOString().split('T')[0];

    const pastRecords = state.history.filter(h => h.date !== todayStr);
    let baseline = pastRecords.length > 0 ? pastRecords[pastRecords.length - 1] : null;

    if (!baseline) {
        if (!state.day1Baseline) state.day1Baseline = { total: grandTotal, cost: currentTotalCost };
        baseline = state.day1Baseline;
    } else {
        delete state.day1Baseline;
    }

    if (baseline && baseline.cost === undefined) {
        baseline.cost = currentTotalCost;
    }

    let pl = 0, rate = 0, netFlow = 0;
    if (baseline) {
        const prevTotal = baseline.total || baseline.value || grandTotal;
        const prevCost = baseline.cost;

        netFlow = currentTotalCost - prevCost;
        pl = grandTotal - prevTotal - netFlow;
        rate = prevTotal > 0 ? (pl / prevTotal) * 100 : 0;
    }

    let todayRecord = state.history.find(h => h.date === todayStr);
    if (todayRecord) {
        todayRecord.total = grandTotal;
        todayRecord.cost = currentTotalCost;
        todayRecord.pl = pl;
        todayRecord.rate = rate;
        todayRecord.netFlow = netFlow;
        todayRecord.value = grandTotal;
    } else {
        state.history.push({
            date: todayStr, total: grandTotal, cost: currentTotalCost,
            pl: pl, rate: rate, netFlow: netFlow, value: grandTotal
        });
    }

    if (state.history.length > 730) state.history.shift(); // 前端改成了 730天，这里对齐

    return { todayStr, pl, rate, netFlow };
}

// ============ 主函数 ============
async function updateData() {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 开始执行自动化更新");
    console.log("=".repeat(50) + "\n");

    try {
        console.log("📍 步骤1: 更新汇率...");
        await updateFXRate();

        console.log("\n📍 步骤2: 更新美股及标的 (Finnhub)...");
        await updateFinnhubData();

        console.log("\n📍 步骤3: 更新A股...");
        await updateCNStocks();

        console.log("\n📍 步骤4: 计算资产...");
        const assets = calculateAssets();

        console.log("\n📍 步骤5: 更新历史记录...");
        const history = updateHistory(assets);

        // 【修复】防冲突核心：必须更新 lastSavedAt，告诉前端云端数据已被脚本修改
        state.lastSavedAt = Date.now();

        console.log("\n📍 步骤6: 保存文件...");
        fs.writeFileSync(dataPath, JSON.stringify(state, null, 2));
        console.log("✅ 数据已保存到文件\n");

        console.log("=".repeat(50));
        console.log("📊 本次更新总结");
        console.log("=".repeat(50));
        console.log(`📅 日期: ${history.todayStr}`);
        console.log(`💰 总资产: ¥${assets.grandTotal.toLocaleString()}`);
        console.log(`💳 成本基准: ¥${assets.currentTotalCost.toLocaleString()}`);
        console.log(`💵 净流入流出: ¥${history.netFlow.toLocaleString()}`);
        console.log(`📈 本日盈亏: ¥${history.pl.toFixed(0)} (${history.rate.toFixed(2)}%)`);
        console.log("=".repeat(50) + "\n");

    } catch(e) {
        console.error("\n❌ 致命错误:", e.message);
        console.error(e.stack);
        process.exit(1);
    }
}

updateData();
