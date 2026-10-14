const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../js/performance-model'),portfolio=require('../js/portfolio-model');
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
