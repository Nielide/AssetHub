const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/portfolio-model');

test('all views share native values, converted values and portfolio weights', () => {
    const state = { usd:[{ticker:'ABC',shares:2,cost:80,price:100}], cn:[{ticker:'SH000001',shares:10,cost:7,price:8}], sgov:[{ticker:'SGOV',shares:3,cost:50,price:50}], cash:[{amount:500,currency:'CNY'},{amount:100,currency:'HKD'}], fxRate:7,hkdFx:.9 };
    const result = model.snapshot(state);
    assert.equal(result.total,3120);
    assert.equal(result.positions[0].value,200);
    assert.equal(result.positions[0].profit,40);
    assert.equal(result.positions[0].weight,1400/3120*100);
    assert.ok(Math.abs([...result.positions,...result.cash].reduce((sum,item)=>sum+item.weight,0)-100)<1e-10);
    assert.equal(result.currencies.find(item=>item.currency==='USD').value,350);
    assert.equal(result.currencies.find(item=>item.currency==='CNY').value,580);
    assert.equal(state.usd[0].weight,undefined);
});

test('calendar display uses record exchange rates with a fallback for old rows', () => {
    const row={pl:70,total:700,fxRate:7,rate:1};
    assert.equal(model.calendarAmount(row,'pl','USD',8),10);
    assert.equal(model.calendarAmount({pl:80},'pl','USD',8),10);
    assert.equal(model.calendarAmount(row,'total','CNY',8),700);
    assert.deepEqual(row,{pl:70,total:700,fxRate:7,rate:1});
    assert.equal(model.calendarAmount({pl:70,fxRate:0},'pl','USD',7),10);
});
test('asset overview separates five native categories and reconciles investment, cash and currency totals', () => {
    const state={usd:[{shares:2,price:100,cost:80}],sgov:[{shares:3,price:50,cost:50}],cn:[{shares:10,price:8,cost:7}],cash:[{amount:100,currency:'USD'},{amount:30,currency:'USD'},{amount:500,currency:'CNY'},{amount:100,currency:'HKD'}],fxRate:7,hkdFx:.9};
    const before=JSON.stringify(state),data=model.assetOverview(model.snapshot(state));
    assert.deepEqual(data.groups.map(group=>group.value),[350,130,80,500,100]);
    assert.deepEqual(data.groups.map(group=>group.converted),[2450,910,80,500,90]);
    assert.equal(data.investment,2530);assert.equal(data.cash,1500);assert.equal(data.total,4030);
    assert.equal(data.groups[0].count,2);assert.equal(data.groups[1].count,2);
    assert.ok(Math.abs(data.groups.reduce((sum,group)=>sum+group.weight,0)-100)<1e-10);
    assert.ok(Math.abs(data.investmentWeight+data.cashWeight-100)<1e-10);
    assert.equal(JSON.stringify(state),before);
    const revised=model.assetOverview(model.snapshot(state,8));
    assert.equal(revised.investment,2880);assert.equal(revised.cash,1630);assert.equal(revised.total,4510);
});
test('empty asset overview keeps the five requested categories without invalid ratios', () => {
    const data=model.assetOverview(model.snapshot({}));
    assert.equal(data.groups.length,5);assert.equal(data.total,0);assert.equal(data.investmentWeight,0);assert.equal(data.cashWeight,0);
    assert.ok(data.groups.every(group=>group.weight===0&&group.value===0&&group.converted===0));
});

test('overview order survives quotes, drops sold holdings and appends new holdings', () => {
    const positions = [{type:'usd',id:1,price:101},{type:'cn',id:1,price:8},{type:'sgov',id:2,price:100}];
    const keys = ['cn:1','missing:9','usd:1','cn:1'];
    assert.deepEqual(model.orderedPositions(positions,keys).map(model.positionKey),['cn:1','usd:1','sgov:2']);
    assert.equal(model.orderedPositions(positions,keys)[1].price,101);
    assert.deepEqual(model.orderedPositions(positions.slice(1),keys).map(model.positionKey),['cn:1','sgov:2']);
    assert.deepEqual(positions.map(model.positionKey),['usd:1','cn:1','sgov:2']);
});

test('dragging filtered holdings preserves hidden categories and rejects invalid orders', () => {
    const positions = [{type:'usd',id:1},{type:'cn',id:1},{type:'usd',id:2},{type:'sgov',id:1}];
    assert.deepEqual(model.reorderPositions(positions,['usd:2','usd:1']).map(model.positionKey),['usd:2','cn:1','usd:1','sgov:1']);
    assert.equal(model.reorderPositions(positions,['usd:1','usd:1']),positions);
    assert.equal(model.reorderPositions(positions,['usd:1','missing:9']),positions);
    assert.deepEqual(positions.map(model.positionKey),['usd:1','cn:1','usd:2','sgov:1']);
});
