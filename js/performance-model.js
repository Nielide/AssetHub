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
        const positions = Portfolio.snapshot(state,fx).positions;
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
            total:{profit:rows.length ? rows.reduce((sum,row)=>sum+(finite(row.pl)?Number(row.pl):0),0) : null,rate:rows.length ? compound(rows,row=>row.rate) : null}
        };
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
    return {category,selected,weights,record,marketSeries,summary,mergeRecords};
});
