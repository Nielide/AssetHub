const test=require('node:test'),assert=require('node:assert/strict'),model=require('../js/funds-model');
const row=(id,date,type,currency,amount,fx)=>model.record({date,type,currency,amount,fx},id);
test('annual funding uses recorded FX and preserves native totals, excludes other years',()=>{
    const rows=[row('a','2026-01-01','deposit','CNY',1000,1),row('b','2026-02-01','deposit','HKD',2000,.9),row('c','2026-02-02','withdrawal','HKD',500,.92),row('d','2025-01-01','deposit','USD',100,7)];
    const summary=model.summary(rows,2026);
    assert.equal(summary.deposits,2800);assert.equal(summary.withdrawals,460);assert.equal(summary.net,2340);
    assert.equal(summary.byCurrency.HKD.net,1500);assert.equal(summary.months[1].net,1340);assert.equal(summary.count,3);
});
test('synchronization is reversible, applies edit differences and rejects overdrafts atomically',()=>{
    const original={cash:[{id:7,currency:'CNY',amount:300}],history:[{date:'2026-01-01',pl:9}]};
    const entry=row('a','2026-01-01','deposit','CNY',1000,1), first=model.syncCash(original,entry,null,true);
    assert.equal(first.state.cash[0].amount,1300);assert.equal(original.cash[0].amount,300);
    const second=model.syncCash(first.state,{...entry,amount:800},first.effect,true);assert.equal(second.state.cash[0].amount,1100);
    assert.equal(model.syncCash(second.state,null,second.effect,false).state.cash[0].amount,300);
    assert.throws(()=>model.syncCash(original,{...entry,type:'withdrawal'},null,true),/余额不足/);assert.equal(original.cash[0].amount,300);
    assert.deepEqual(second.state.history,original.history);
});
test('editing synchronized currency and creating a cash currency keep balances coherent',()=>{
    const state={cash:[{id:'cny',currency:'CNY',amount:1000}]};
    const initial=model.syncCash(state,row('a','2026-01-01','deposit','CNY',100,1),null,true);
    const changed=model.syncCash(initial.state,row('a','2026-01-01','deposit','HKD',200,.9),initial.effect,true,()=> 'hkd');
    assert.equal(changed.state.cash[0].amount,1000);assert.equal(changed.state.cash[1].amount,200);
});
test('CSV round trips Chinese, commas, quotes, newlines and duplicate IDs without cash effects',()=>{
    const a={...row('a','2026-01-01','deposit','CNY',100,1),note:'存钱, "奖金"\n保留',effect:{id:'cash',currency:'CNY',delta:100}};
    const csv=model.exportCSV([a]);const result=model.importCSV(csv);
    assert.equal(result.rows[0].note,a.note);assert.equal(result.rows[0].effect,undefined);
    assert.equal(model.importCSV(csv,[a]).skipped,1);assert.equal(model.importCSV(csv,[a]).rows[0].effect.delta,100);
    assert.throws(()=>model.importCSV(model.exportCSV([{...a,amount:200}]),[a]),/不同内容/);
    assert.equal(a.amount,100);
});
test('invalid dates, currencies, negative amounts and nonfinite rates fail validation',()=>{
    const entry=row('a','2026-01-01','deposit','CNY',100,1);
    for(const patch of [{date:'2026-02-30'},{currency:'EUR'},{amount:0},{amount:-1},{amount:1.111},{fx:0},{fx:Infinity},{fx:7},{type:'buy'}]) assert.throws(()=>model.record({...entry,...patch}));
});
