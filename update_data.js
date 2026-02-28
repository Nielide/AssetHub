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

async function updateData() {
    console.log("=== 开始执行自动化更新 ===");

    // 1. 更新美元汇率
    try {
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
        const fxData = await fxRes.json();
        if (fxData && fxData.rates && fxData.rates.CNY) {
            state.fxRate = parseFloat(fxData.rates.CNY.toFixed(4));
            console.log("汇率更新成功:", state.fxRate);
        }
    } catch(e) { console.error("汇率更新失败", e); }

    // 2. 更新美股数据
    if (FINNHUB_KEY && state.usd.length > 0) {
        for (let item of state.usd) {
            if (!item.ticker || item.ticker === 'New') continue;
            try {
                const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${item.ticker}&token=${FINNHUB_KEY}`);
                const data = await res.json();
                if (data.c) {
                    item.price = data.c;
                    console.log(`美股 ${item.ticker} 更新成功:`, item.price);
                }
            } catch(e) { console.error(`美股 ${item.ticker} 更新失败`, e); }
        }
    }

    // 3. 更新 A 股数据
    if (state.cn.length > 0) {
        const symbols = state.cn.map(i => i.ticker.toLowerCase()).filter(t => t && t !== 'new');
        if (symbols.length > 0) {
            try {
                const res = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`);
                const text = await res.text();
                symbols.forEach(symbol => {
                    const regex = new RegExp(`v_${symbol}="(.*?)";`);
                    const match = text.match(regex);
                    if (match) {
                        const parts = match[1].split('~');
                        const price = parseFloat(parts[3]);
                        const stock = state.cn.find(i => i.ticker.toLowerCase() === symbol);
                        if (stock && price > 0) {
                            stock.price = price;
                            console.log(`A股 ${symbol} 更新成功:`, price);
                        }
                    }
                });
            } catch(e) { console.error("A股更新失败", e); }
        }
    }

    // 4. 计算总资产、总成本并自动写入历史记录
    const fx = state.fxRate || 7.25;
    
    const totalUsdStockCost = state.usd.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    const totalCnStockCost = state.cn.reduce((a, i) => a + (i.shares * (i.cost || 0)), 0);
    const totalUsdStockVal = state.usd.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    const totalCnStockVal = state.cn.reduce((a, i) => a + (i.shares * (i.price || 0)), 0);
    
    let totalUsdCashVal = 0, totalRmbCashVal = 0;
    state.cash.forEach(i => { 
        if(i.currency === 'USD') totalUsdCashVal += i.amount; 
        else totalRmbCashVal += i.amount; 
    });
    
    const currentTotalCost = Math.round((totalUsdStockCost + totalUsdCashVal) * fx + totalCnStockCost + totalRmbCashVal);
    const totalUsdAssets = totalUsdStockVal + totalUsdCashVal;
    const totalRmbAssets = totalCnStockVal + totalRmbCashVal;
    const grandTotal = Math.round((totalUsdAssets * fx) + totalRmbAssets);

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
        state.history.push({ date: todayStr, total: grandTotal, cost: currentTotalCost, pl: pl, rate: rate, netFlow: netFlow, value: grandTotal });
    }

    if (state.history.length > 365) state.history.shift();

    // 5. 保存回文件
    fs.writeFileSync(dataPath, JSON.stringify(state, null, 2));
    console.log(`=== 日期: ${todayStr} | 总额: ${grandTotal} | 流水: ${netFlow} | 真实盈亏: ${pl.toFixed(2)} ===`);
}

updateData();
