/* Actual daily market snapshots. Legacy total history is never split or backfilled. */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./portfolio-model'));
    else root.PerformanceModel = factory(root.PortfolioModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(Portfolio) {
    const category = type => type === 'sgov' ? 'usd' : type;
    const finite = value => value !== null && value !== undefined && Number.isFinite(Number(value));
    const history = state => (state.history || []).slice().sort((a,b) => a.date.localeCompare(b.date));
    function selected(state, days) {
        const rows = history(state);
        if (!days || !rows.length) return rows;
        const cutoff = new Date(rows[rows.length-1].date + 'T12:00:00');
        cutoff.setDate(cutoff.getDate() - days);
        const date = cutoff.getFullYear()+'-'+String(cutoff.getMonth()+1).padStart(2,'0')+'-'+String(cutoff.getDate()).padStart(2,'0');
        return rows.filter(row => row.date >= date);
    }
    function weights(positions, market) {
        const shown = positions.filter(item => market === 'all' || category(item.type) === market);
        const total = shown.reduce((sum,item) => sum + item.converted,0);
        return new Map(shown.map(item => [Portfolio.positionKey(item), total ? item.converted / total * 100 : 0]));
    }
    function record(state, date, fx) {
        const row = (state.history || []).find(row => row.date === date);
        if (!row) return;
        const snapshot = Portfolio.snapshot(state,fx), positions = snapshot.positions;
        row.investmentTotal = positions.reduce((sum,item) => sum + item.converted,0);
        row.cashTotal = snapshot.cash.reduce((sum,item) => sum + item.converted,0);
        row.markets ||= {};
        ['usd','cn'].forEach(type => {
            const owned = positions.filter(item => category(item.type) === type);
            const value = owned.reduce((sum,item) => sum + item.value,0);
            const cost = owned.reduce((sum,item) => sum + item.costValue,0);
            const previous = history(state).filter(point => point.date < date && finite(point.markets?.[type]?.value) && finite(point.markets?.[type]?.cost)).pop();
            const baseline = previous?.markets[type];
            const netFlow = baseline ? cost - baseline.cost : null;
            const pl = baseline ? value - baseline.value - netFlow : null;
            row.markets[type] = {value,cost,netFlow,pl,fromDate:previous?.date || null,rate:baseline && baseline.value > 0 ? pl / baseline.value * 100 : null,currency:type === 'usd' ? 'USD' : 'CNY'};
        });
        const previous = history(state).filter(point => point.date < date && ['usd','cn'].every(type => finite(point.markets?.[type]?.value) && finite(point.markets?.[type]?.cost))).pop();
        const span = previous ? Math.round((Date.parse(date)-Date.parse(previous.date))/86400000) : null;
        let profit = null, baseline = null;
        if (previous && span === 1) {
            const old = previous.markets, current = row.markets;
            const change = type => current[type].value - old[type].value - (current[type].cost - old[type].cost);
            profit = change('usd') * snapshot.fx + change('cn');
            baseline = old.usd.value * snapshot.fx + old.cn.value;
        }
        row.investmentPerformance = {pl:profit,rate:baseline > 0 ? profit / baseline * 100 : null,total:row.investmentTotal,fromDate:previous?.date || null,fxRate:snapshot.fx};
    }

    // Calendar returns compare native holdings at one common FX rate: no cash or FX P/L.
    function investmentPoint(row) {
        const modern = row.investmentPerformance;
        return modern ? {pl:modern.pl,rate:modern.rate,total:modern.total,legacy:false,fromDate:modern.fromDate}
            : {pl:finite(row.pl)?Number(row.pl):null,rate:finite(row.rate)?Number(row.rate):null,total:finite(row.total??row.value)?Number(row.total??row.value):null,legacy:true};
    }
    function calendarMonth(rows) {
        const points=rows.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(investmentPoint);
        const profits=points.filter(p=>finite(p.pl)), rates=points.filter(p=>finite(p.rate));
        return {profit:profits.length?profits.reduce((sum,p)=>sum+Number(p.pl),0):null,
            rate:rates.length?compound(rates,p=>p.rate):null, total:points.at(-1)?.total??null,
            legacy:points.some(p=>p.legacy), totalLegacy:points.at(-1)?.legacy??false, count:points.length};
    }
    // Calendar "total assets" always uses the real account balance, including cash.
    // Income keeps its investment/legacy basis; never add balances across dates.
    function calendarPeriod(rows) {
        const last=rows.slice().sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
        return {...calendarMonth(rows),total:finite(last?.total??last?.value)?Number(last.total??last.value):null};
    }
    function compound(rows, getRate) {
        return (rows.reduce((growth,row) => growth * (1 + (finite(getRate(row)) ? Number(getRate(row)) : 0) / 100),1)-1)*100;
    }
    function marketSeries(state, type, days) {
        const all = history(state), windowRows = selected(state,days);
        const rows = windowRows.filter(row => finite(row.markets?.[type]?.value));
        let boundary = null;
        if(days && all.length){const date=new Date(all[all.length-1].date+'T12:00:00');date.setDate(date.getDate()-days-1);boundary=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
        const within = row => !boundary || !row.markets[type].fromDate || row.markets[type].fromDate >= boundary;
        const recorded = rows.filter(row => finite(row.markets[type].pl) && within(row));
        let growth = 1;
        const points = [];
        if (rows.length) {
            const previous = all.filter(row => row.date < rows[0].date && finite(row.markets?.[type]?.value)).pop();
            if (previous) points.push({date:previous.date,value:0});
        }
        rows.forEach(row => {
            const rate = row.markets[type].rate;
            if (finite(rate) && within(row)) growth *= 1 + Number(rate)/100;
            points.push({date:row.date,value:(growth-1)*100});
        });
        return {
            points, profit:recorded.length ? recorded.reduce((sum,row) => sum+Number(row.markets[type].pl),0) : null,
            rate:rows.some(row=>finite(row.markets[type].rate)&&within(row)) ? compound(rows.filter(within),row=>row.markets[type].rate) : null,
            start:rows[0]?.date || null,
            partial:!!rows.length && (windowRows.some(row=>!finite(row.markets?.[type]?.value)) || rows.some(row=>!within(row)))
        };
    }
    function summary(state, days) {
        const rows = selected(state,days);
        return {
            usd:marketSeries(state,'usd',days),cn:marketSeries(state,'cn',days),
            total:{profit:rows.some(row=>finite(row.pl)) ? rows.reduce((sum,row)=>sum+(finite(row.pl)?Number(row.pl):0),0) : null,rate:rows.some(row=>finite(row.rate)) ? compound(rows,row=>row.rate) : null}
        };
    }
    // This drawdown measures the displayed asset balance, including cash flows.
    // Retain the amount from the same peak/trough pair as the largest percentage.
    function riskSummary(state, days) {
        const rows = selected(state, days);
        const values = rows.filter(row => finite(row.total ?? row.value) && Number(row.total ?? row.value) >= 0);
        let peak = null, peakDate = null, drawdown = 0, amount = 0, from = null, to = null;
        values.forEach(row => {
            const value = Number(row.total ?? row.value);
            if (peak === null || value > peak) { peak = value; peakDate = row.date; }
            const decline = peak > 0 ? (peak - value) / peak * 100 : 0;
            if (decline > drawdown) { drawdown = decline; amount = peak - value; from = peakDate; to = row.date; }
        });
        const rates = rows.filter(row => finite(row.rate)).map(row => Number(row.rate));
        const mean = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : 0;
        const variance = rates.length > 1 ? rates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rates.length - 1) : null;
        return { drawdown: values.length > 1 ? -drawdown || 0 : null, amount: values.length > 1 ? -amount || 0 : null, from, to, volatility: variance === null ? null : Math.sqrt(variance * 252) };
    }
    function mergeRecords(previous, incoming) {
        const byDate=new Map();
        [...(Array.isArray(previous)?previous:[]),...(Array.isArray(incoming)?incoming:[])].forEach(row=>{
            if(!row?.date)return;
            const existing=byDate.get(row.date),merged={...existing,...row};
            if(existing?.markets||row.markets)merged.markets={...existing?.markets,...row.markets};
            byDate.set(row.date,merged);
        });
        return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
    }
    return {category,selected,weights,record,marketSeries,summary,riskSummary,mergeRecords,investmentPoint,calendarMonth,calendarPeriod};
});
