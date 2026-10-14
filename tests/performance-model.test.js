const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../js/performance-model'),portfolio=require('../js/portfolio-model');
test('monthly and annual asset balances use the final actual snapshot, including zero cash closure',()=>{
    const rows=[{date:'2026-02-01',total:2000,pl:100,rate:10},{date:'2026-02-02',total:1500,investmentPerformance:{pl:-50,rate:-10,total:1000}}];
    const summary=model.calendarPeriod(rows.reverse());
    assert.equal(summary.profit,50);assert.ok(Math.abs(summary.rate+1)<1e-10);assert.equal(summary.total,1500);
    assert.equal(model.calendarPeriod([...rows,{date:'2026-12-31',total:0,pl:0,rate:0}]).total,0);
    assert.equal(model.calendarPeriod([]).total,null);
});
test('investment calendar excludes deposits, cash FX and holding FX movements',()=>{
    const state={usd:[{id:1,shares:2,cost:100,price:100}],cn:[{id:2,shares:10,cost:5,price:5}],cash:[{id:3,currency:'USD',amount:1000}],history:[{date:'2026-01-01',total:10000,pl:8,rate:1}]};
    model.record(state,'2026-01-01',7);
    state.cash[0].amount=2000;state.history.push({date:'2026-01-02',pl:1400,rate:14});
    model.record(state,'2026-01-02',8);
    assert.equal(model.investmentPoint(state.history[1]).pl,0);assert.equal(model.investmentPoint(state.history[1]).rate,0);
    assert.equal(state.history[1].pl,1400);
    state.usd[0].price=110;state.cn[0].price=4;
    model.record(state,'2026-01-02',8);
    assert.equal(model.investmentPoint(state.history[1]).pl,150);
    assert.equal(model.investmentPoint(state.history[1]).total,1800);
});
test('legacy calendar totals remain marked and month return compounds actual rates',()=>{
    const rows=[{date:'2026-01-01',pl:10,rate:10,total:1000},{date:'2026-01-02',pl:999,investmentPerformance:{pl:-5,rate:-10,total:950}}];
    const summary=model.calendarMonth(rows);
    assert.equal(summary.profit,5);assert.ok(Math.abs(summary.rate+1)<1e-10);
    assert.equal(summary.total,950);assert.equal(summary.totalLegacy,false);assert.equal(summary.legacy,true);
    assert.equal(model.investmentPoint(rows[0]).legacy,true);assert.equal(model.investmentPoint(rows[1]).pl,-5);
    assert.equal(model.calendarMonth([]).profit,null);assert.equal(rows[1].pl,999);
});
test('missing previous day is unknown rather than a fabricated daily return',()=>{
    const state={usd:[],cn:[],history:[{date:'2026-01-01',pl:5},{date:'2026-01-03',pl:8}]};
    model.record(state,'2026-01-01',7);model.record(state,'2026-01-03',7);
    assert.equal(model.investmentPoint(state.history[1]).pl,null);
    assert.equal(model.investmentPoint(state.history[1]).legacy,false);
});
test('overview weights use market holdings and exclude cash; all converts currencies',()=>{
    const state={usd:[{id:1,shares:2,price:100,cost:80}],sgov:[{id:2,shares:1,price:100,cost:100}],cn:[{id:3,shares:10,price:7,cost:5}],cash:[{currency:'CNY',amount:10000}],fxRate:7};
    const positions=portfolio.snapshot(state).positions;
    const us=model.weights(positions,'usd'),cn=model.weights(positions,'cn'),all=model.weights(positions,'all');
    assert.ok(Math.abs([...us.values()].reduce((a,b)=>a+b,0)-100)<1e-10);
    assert.equal(cn.get('cn:3'),100);assert.ok(Math.abs(all.get('cn:3')-70/2170*100)<1e-10);
    assert.equal(us.has('cn:3'),false);assert.equal(positions[0].weight,1400/12170*100);
});
test('records native market changes without overwriting legacy total P/L',()=>{
    const state={usd:[{id:1,shares:2,cost:100,price:100}],sgov:[],cn:[{id:2,shares:10,cost:5,price:5}],history:[{date:'2026-01-01',pl:9,rate:1}]};
    model.record(state,'2026-01-01',7);assert.equal(state.history[0].markets.usd.pl,null);assert.equal(state.history[0].pl,9);
    assert.equal(state.history[0].investmentTotal,1450);assert.equal(state.history[0].cashTotal,0);
    state.usd[0].price=110;state.cn[0].price=4;state.history.push({date:'2026-01-02',pl:130,rate:2});
    model.record(state,'2026-01-02',7);assert.equal(state.history[1].markets.usd.pl,20);assert.equal(state.history[1].markets.cn.pl,-10);
    assert.equal(state.history[1].markets.usd.rate,10);assert.equal(state.history[1].pl,130);
    const before=JSON.stringify(state.history);model.record(state,'2026-01-02',7);assert.equal(JSON.stringify(state.history),before);
});
test('selected dates, missing market history and compounded curves are honest',()=>{
    const state={history:[{date:'2020-01-01',pl:100,rate:1},{date:'2026-01-01',pl:7,rate:1,markets:{usd:{value:100,cost:100,pl:null,rate:null}}},{date:'2026-01-02',pl:10,rate:2,markets:{usd:{value:110,cost:100,pl:10,rate:10}}},{date:'2026-01-03',pl:-5,rate:-1,markets:{usd:{value:99,cost:100,pl:-11,rate:-10}}}]};
    assert.equal(model.summary(state,0).cn.profit,null);assert.equal(model.summary(state,30).total.profit,12);
    assert.equal(model.summary(state,0).usd.partial,true);assert.equal(model.summary(state,30).usd.profit,-1);
    assert.ok(Math.abs(model.summary(state,30).usd.rate+1)<1e-10);
    assert.deepEqual(model.marketSeries(state,'usd',30).points.map(p=>p.date),['2026-01-01','2026-01-02','2026-01-03']);
    assert.equal(model.selected(state,3650).length,4);assert.equal(state.history[0].markets,undefined);
});
test('legacy cloud history cannot erase recorded market snapshots',()=>{
    const local=[{date:'2026-01-01',pl:3,markets:{usd:{value:10}}}];
    const legacy=[{date:'2026-01-01',pl:4}];
    assert.deepEqual(model.mergeRecords(local,legacy),[{date:'2026-01-01',pl:4,markets:{usd:{value:10}}}]);
    assert.deepEqual(model.mergeRecords(local,[{date:'2026-01-01',pl:5,markets:{cn:{value:7}}}])[0].markets,{usd:{value:10},cn:{value:7}});
    assert.equal(local[0].pl,3);assert.equal(local[0].markets.cn,undefined);
});
test('drawdown amount belongs to the maximum percentage peak/trough, not the biggest cash decline',()=>{
    const state={history:[{date:'2026-01-01',total:10000,pl:0,rate:0},{date:'2026-01-02',total:8000,pl:-2000,rate:-20},{date:'2026-01-03',total:30000,pl:22000,rate:0},{date:'2026-01-04',total:27000,pl:-3000,rate:-10}]};
    const risk=model.riskSummary(state,0);
    assert.equal(risk.drawdown,-20);assert.equal(risk.amount,-2000);
    assert.equal(risk.from,'2026-01-01');assert.equal(risk.to,'2026-01-02');
    assert.ok(Math.abs(risk.volatility-Math.sqrt(23100))<1e-8);
});
test('range summaries handle legacy values, missing records and monotonic assets',()=>{
    assert.equal(model.riskSummary({history:[{date:'2026-01-01',total:100}]},0).amount,null);
    assert.equal(model.riskSummary({history:[{date:'2026-01-01'},{date:'2026-01-02'}]},0).drawdown,null);
    assert.deepEqual(model.summary({history:[{date:'2026-01-01',value:100}]},0).total,{profit:null,rate:null});
    const state={history:[{date:'2020-01-01',total:100,pl:100,rate:1},{date:'2026-01-01',value:150,pl:50,rate:2},{date:'2026-01-02',value:200,pl:50,rate:3}]};
    assert.equal(model.riskSummary(state,30).drawdown,0);assert.equal(model.riskSummary(state,30).amount,0);
    assert.equal(model.summary(state,30).total.profit,100);
    assert.equal(model.summary(state,0).total.profit,200);
});
test('a long offline interval is not reported as a one-month market return',()=>{
    const state={history:[{date:'2026-01-01',markets:{usd:{value:100,cost:100,pl:null,rate:null}}},{date:'2026-04-01',markets:{usd:{value:120,cost:100,pl:20,rate:20,fromDate:'2026-01-01'}}}]};
    assert.equal(model.summary(state,30).usd.profit,null);assert.equal(model.summary(state,30).usd.rate,null);
    assert.equal(model.summary(state,0).usd.profit,20);assert.equal(model.summary(state,30).usd.partial,true);
});
test('scheduled updater records both markets and retains long histories without network calls',()=>{
    const fs=require('node:fs'),vm=require('node:vm');
    const source=fs.readFileSync(require.resolve('../scripts/update_data_improved.js'),'utf8');
    const start=source.indexOf('function updateHistory(assets)');
    const end=source.indexOf('\n//',start);
    const state={fxRate:7,usd:[{id:1,shares:1,cost:90,price:100}],cn:[{id:2,shares:10,cost:7,price:8}],sgov:[],cash:[],history:Array.from({length:800},(_,i)=>({date:new Date(Date.UTC(2018,0,1+i)).toISOString().slice(0,10),total:700,cost:700,pl:0,rate:0}))};
    const result=vm.runInNewContext(source.slice(start,end)+'\nupdateHistory({grandTotal:780,currentTotalCost:700})',{state,PerformanceModel:model,Date});
    const current=state.history.find(row=>row.date===result.todayStr);
    assert.equal(state.history.length,801);assert.equal(current.fxRate,7);
    assert.equal(current.markets.usd.value,100);assert.equal(current.markets.cn.value,80);
});

test('asset and investment curves use separate real balances and preserve empty history',()=>{
    const state={cash:[{currency:'CNY',amount:99999}],history:[
        {date:'2026-01-01',total:12000},
        {date:'2026-01-02',total:15000,investmentTotal:8000},
        {date:'2026-01-03',total:16000,investmentTotal:0},
        {date:'2026-01-04',total:18000,investmentTotal:9000}
    ]};
    assert.deepEqual(model.valueSeries(state,0).map(p=>p.value),[12000,15000,16000,18000]);
    assert.deepEqual(model.valueSeries(state,0,'investment').map(p=>p.value),[8000,0,9000]);
    assert.equal(model.riskSummary(state,0,'investment').drawdown,-100);
    assert.equal(model.riskSummary(state,0,'investment').amount,-8000);
    assert.equal(model.riskSummary(state,0).drawdown,0);
    assert.deepEqual(model.valueSeries({history:[{date:'2026-01-01',total:12000}]},0,'investment'),[]);
    assert.equal(model.riskSummary({history:[{date:'2026-01-01',investmentTotal:10}]},0,'investment').amount,null);
});
test('reconstructed investment balances require both native markets and recorded historical FX',()=>{
    const state={fxRate:99,history:[
        {date:'2026-01-01',markets:{usd:{value:100},cn:{value:50}},fxRate:7},
        {date:'2026-01-02',markets:{usd:{value:100},cn:{value:50}}},
        {date:'2026-01-03',markets:{usd:{value:100}},fxRate:7},
        {date:'2026-01-04',markets:{usd:{value:0},cn:{value:80}}},
        {date:'2026-01-05',markets:{usd:{value:100},cn:{value:50}},investmentPerformance:{fxRate:8}},
        {date:'2026-01-06',investmentTotal:-1},
        {date:'2026-01-07',investmentTotal:0}
    ]};
    assert.deepEqual(model.valueSeries(state,0,'investment'),[
        {date:'2026-01-01',value:750},{date:'2026-01-04',value:80},{date:'2026-01-05',value:850},{date:'2026-01-07',value:0}
    ]);
});
test('investment windows do not extend to an older snapshot when recent records are missing',()=>{
    const state={history:[{date:'2026-01-01',investmentTotal:100,total:150},{date:'2026-04-01',total:250}]};
    assert.deepEqual(model.valueSeries(state,30,'investment'),[]);
    assert.equal(model.valueSeries(state,0,'investment').length,1);
});
