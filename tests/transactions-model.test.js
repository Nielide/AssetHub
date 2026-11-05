const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../js/transactions-model');
const csv = body => model.headers.join(',')+'\r\n'+body+'\r\n';

test('round trips signed quantities, precise fractions and blank price currency', () => {
    const source=csv('"BRK.B",2026-01-01,0.004527,256.880000,,0.000000,0.350000,USD\r\nBRK.B,2026-01-02,-0.004527,270.000000,USD,0.000000,0.350000,USD');
    const imported=model.importCSV('\uFEFF'+source);
    assert.equal(imported.rows[0].quantity,.004527);
    assert.equal(imported.rows[0].currency,'USD');
    assert.equal(imported.rows[0].raw['Price Currency'],'');
    assert.equal(imported.rows[1].type,'sell');
    const reimported=model.importCSV(model.exportCSV(imported.rows));
    assert.deepEqual(reimported.rows.map(row=>row.raw),imported.rows.map(row=>row.raw));
});

test('repeated import is idempotent and identical fills within a file are retained', () => {
    const row='ABC,2026-01-01,1,100,USD,0,1,USD';
    const source=csv(row+'\r\n'+row), first=model.importCSV(source);
    assert.equal(first.added,2);
    const second=model.importCSV(source,first.rows);
    assert.equal(second.added,0);assert.equal(second.skipped,2);assert.equal(second.rows.length,2);
});

test('fees are part of moving average cost; incomplete and mixed-currency returns stay unknown', () => {
    const rows=model.importCSV(csv('ABC,2026-01-01,2,100,USD,0,2,USD\r\nABC,2026-01-02,-1,110,USD,0,1,USD')).rows;
    const summary=model.summary(rows,'ABC','USD');
    assert.equal(summary.realized,8);assert.equal(summary.fees.USD,3);
    assert.equal(summary.lots.get('USD:ABC').cost,101);
    assert.equal(model.summary(rows.slice(1),'ABC','USD').realized,null);
    const cny=model.importCSV(csv('XYZ,2026-01-01,1,100,CNY,0,0,CNY\r\nXYZ,2026-01-02,-1,110,CNY,0,0,CNY')).rows;
    assert.equal(model.summary([...rows,...cny]).realized,null);
    const crossCurrency=model.importCSV(csv('XYZ,2026-01-01,1,100,USD,0,2,CNY\r\nXYZ,2026-01-02,-1,110,USD,0,0,USD')).rows;
    assert.equal(model.summary(crossCurrency,'XYZ','USD').realized,null);
    assert.equal(model.fee(model.record({Symbol:'ABC',Date:'2026-01-01',Quantity:'2',Price:'100','Price Currency':'USD','Fees Percentage':'1','Fees Amount':'1','Fees Currency':'USD'})),3);
});

test('invalid imports fail before modifying existing records', () => {
    const existing=model.importCSV(csv('ABC,2026-01-01,1,100,USD,0,1,USD')).rows;
    assert.throws(()=>model.importCSV(csv('ABC,2026-02-30,1,100,USD,0,1,USD'),existing),/第 2 行/);
    assert.throws(()=>model.importCSV(csv('ABC,2026-01-01,1,-100,USD,0,1,USD'),existing),/无效/);
    assert.throws(()=>model.importCSV('Symbol,Date\nABC,2026-01-01'),/8 列/);
    assert.equal(existing.length,1);
});
