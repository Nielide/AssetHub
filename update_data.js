const fs = require('fs');

// 读取你的数据文件
const dataPath = './data.json';
let state = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// === 【修复点】确保所有核心字段存在，防止 filter 报错 ===
if (!state.history) state.history = [];
if (!state.usd) state.usd = [];
if (!state.cn) state.cn = [];
if (!state.cash) state.cash = [];
if (!state.fxRate) state.fxRate = 7.25;

// 获取环境变量中的 Finnhub 密钥
const FINNHUB_KEY = process.env.FINNHUB_KEY;

// ============ 【新增】超时控制函数 ============
function fetchWithTimeout(url, timeout = 10000) {
    return Promise.race([
        fetch(url),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
}

// ============ 【改进】汇率更新 ============
async function updateFXRate() {
    try {
        // 方案1: 使用 open.er-api.com
        const fxRes = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 8000);
        
        if (!fxRes.ok) {
            throw new Error(`HTTP ${fxRes.status}`);
        }
        
        const fxData = await fxRes.json();
        
        if (fxData && fxData.rates && fxData.rates.CNY) {
            // 改进：直接使用数值运算，避免字符串转换丢失精度
            const newRate = Math.round(fxData.rates.CNY * 10000) / 10000;
            state.fxRate = newRate;
            console.log("✅ 汇率更新成功:", state.fxRate);
            return true;
        }
    } catch(e) {
        console.error("❌ 汇率更新失败 (方案1):", e.message);
        
        // 方案2：备选API (exchangerate-api.com 的免费方案)
        try {
            const res2 = await fetchWithTimeout('https://api.exchangerate-api.com/v4/latest/USD', 8000);
            if (res2.ok) {
                const data = await res2.json();
                if (data.rates && data.rates.CNY) {
                    const newRate = Math.round(data.rates.CNY * 10000) / 10000;
                    state.fxRate = newRate;
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

// ============ 【改进】美股数据更新 ============
async function updateUSStocks() {
    if (!FINNHUB_KEY || state.usd.length === 0) {
        console.log("⏭️ 跳过美股更新 (无密钥或无持仓)");
        return;
    }

    let successCount = 0;
    for (let item of state.usd) {
        if (!item.ticker || item.ticker === 'New') continue;
        
        try {
            const res = await fetchWithTimeout(
                `https://finnhub.io/api/v1/quote?symbol=${item.ticker}&token=${FINNHUB_KEY}`,
                8000
            );
            
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            
            const data = await res.json();
            
            if (data.c && typeof data.c === 'number' && data.c > 0) {
                item.price = data.c;
                console.log(`✅ 美股 ${item.ticker} 更新成功: $${item.price}`);
                successCount++;
            } else {
                console.warn(`⚠️ 美股 ${item.ticker} 返回无效数据:`, data);
            }
        } catch(e) {
            console.error(`❌ 美股 ${item.ticker} 更新失败:`, e.message);
        }
    }
    
    console.log(`📊 美股更新完成: ${successCount}/${state.usd.length} 成功`);
}

// ============ 【改进】A股数据更新 ============
async function updateCNStocks() {
    if (state.cn.length === 0) {
        console.log("⏭️ 跳过A股更新 (无持仓)");
        return;
    }

    const symbols = state.cn
        .map(i => i.ticker.toLowerCase())
        .filter(t => t && t !== 'new');
    
    if (symbols.length === 0) return;

    let successCount = 0;
    
    try {
        // 方案1: 腾讯财经API
        const res = await fetchWithTimeout(
            `https://qt.gtimg.cn/q=${symbols.join(',')}`,
            10000
        );
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        
        const text = await res.text();
        
        symbols.forEach(symbol => {
            try {
                // 改进：更灵活的正则表达式
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
                } else {
                    console.warn(`⚠️ A股 ${symbol.toUpperCase()} 未找到数据`);
                }
            } catch(e) {
                console.error(`❌ A股 ${symbol.toUpperCase()} 解析失败:`, e.message);
            }
        });
        
    } catch(e) {
        console.error("❌ A股更新失败 (方案1):", e.message);
        
        // 方案2: 使用 YahooFinance API (可选，需要额外配置)
        console.warn("⚠️ 考虑配置备选A股数据源 (如 Python tushare 库)");
    }
    
    console.log(`📊 A股更新完成: ${successCount}/${symbols.length} 成功`);
}

// ============ 【改进】资产计算和历史记录 ============
function calculateAssets() {
    const fx = state.fxRate || 7.25;
    
    // 计算成本
    const totalUsdStockCost = state.usd.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    const totalCnStockCost = state.cn.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    
    // 计算现值
    const totalUsdStockVal = state.usd.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    const totalCnStockVal = state.cn.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    
    // 现金
    let totalUsdCashVal = 0, totalRmbCashVal = 0;
    state.cash.forEach(i => {
        if (i.currency === 'USD') totalUsdCashVal += i.amount;
        else totalRmbCashVal += i.amount;
    });
    
    // 总值（以人民币计）
    const currentTotalCost = Math.round((totalUsdStockCost + totalUsdCashVal) * fx + totalCnStockCost + totalRmbCashVal);
    const totalUsdAssets = totalUsdStockVal + totalUsdCashVal;
    const totalRmbAssets = totalCnStockVal + totalRmbCashVal;
    const grandTotal = Math.round((totalUsdAssets * fx) + totalRmbAssets);

    return {
        grandTotal,
        currentTotalCost,
        totalUsdAssets,
        totalRmbAssets,
        breakdown: {
            usdStockVal: totalUsdStockVal,
            cnStockVal: totalCnStockVal,
            usdCash: totalUsdCashVal,
            rmbCash: totalRmbCashVal
        }
    };
}

// ============ 【改进】历史记录更新 ============
function updateHistory(assets) {
    const { grandTotal, currentTotalCost } = assets;
    
    // 获取北京时间
    const bjTime = new Date(new Date().getTime() + 8 * 3600 * 1000);
    const todayStr = bjTime.toISOString().split('T')[0];

    const pastRecords = state.history.filter(h => h.date !== todayStr);
    let baseline = pastRecords.length > 0 ? pastRecords[pastRecords.length - 1] : null;

    if (!baseline) {
        if (!state.day1Baseline) {
            state.day1Baseline = { total: grandTotal, cost: currentTotalCost };
        }
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
            date: todayStr,
            total: grandTotal,
            cost: currentTotalCost,
            pl: pl,
            rate: rate,
            netFlow: netFlow,
            value: grandTotal
        });
    }

    if (state.history.length > 365) {
        state.history.shift();
    }

    return { todayStr, pl, rate, netFlow };
}

// ============ 【新增】主函数异常处理 ============
async function updateData() {
    console.log("\n" + "=".repeat(50));
    console.log("🚀 开始执行自动化更新");
    console.log("=".repeat(50) + "\n");

    try {
        // 1. 更新汇率
        console.log("📍 步骤1: 更新汇率...");
        await updateFXRate();

        // 2. 更新美股
        console.log("\n📍 步骤2: 更新美股...");
        await updateUSStocks();

        // 3. 更新A股
        console.log("\n📍 步骤3: 更新A股...");
        await updateCNStocks();

        // 4. 计算资产
        console.log("\n📍 步骤4: 计算资产...");
        const assets = calculateAssets();

        // 5. 更新历史
        console.log("\n📍 步骤5: 更新历史记录...");
        const history = updateHistory(assets);

        // 6. 保存文件
        fs.writeFileSync(dataPath, JSON.stringify(state, null, 2));
        console.log("\n✅ 数据已保存到文件\n");

        // 输出总结
        console.log("=".repeat(50));
        console.log("📊 本次更新总结");
        console.log("=".repeat(50));
        console.log(`📅 日期: ${history.todayStr}`);
        console.log(`💰 总资产: ¥${assets.grandTotal.toLocaleString()}`);
        console.log(`   ├─ 美元资产: $${assets.totalUsdAssets.toFixed(2)}`);
        console.log(`   └─ 人民币资产: ¥${assets.totalRmbAssets.toFixed(0)}`);
        console.log(`💳 成本: ¥${assets.currentTotalCost.toLocaleString()}`);
        console.log(`💵 净流入: ¥${history.netFlow.toLocaleString()}`);
        console.log(`📈 浮动盈亏: ¥${history.pl.toFixed(0)} (${history.rate.toFixed(2)}%)`);
        console.log("=".repeat(50) + "\n");

    } catch(e) {
        console.error("\n❌ 致命错误:", e.message);
        console.error(e.stack);
        process.exit(1);
    }
}

updateData();
