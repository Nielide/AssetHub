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
