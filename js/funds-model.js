/* External capital movements are independent of trades and investment returns. */
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./transactions-model'));
    else root.FundsModel = factory(root.TransactionsModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(CSV) {
    const headers = ['ID','Date','Type','Currency','Amount','CNY Rate','Category','Note'];
    const currencies = ['CNY','HKD','USD'];
    function record(raw, id) {
        const date = String(raw.date || ''), amount = Number(raw.amount), fx = Number(raw.fx);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('请填写有效日期');
        if (!['deposit','withdrawal'].includes(raw.type)) throw new Error('请选择转入或转出');
        if (!currencies.includes(raw.currency)) throw new Error('不支持的币种');
        if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100)) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new Error('金额必须大于 0，最多两位小数');
        if (!Number.isFinite(fx) || !Number.isFinite(amount * fx) || fx <= 0 || (raw.currency === 'CNY' && fx !== 1)) throw new Error('人民币折算汇率无效');
        id = String(id || raw.id || '');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('记录编号无效');
        const category = String(raw.category || (raw.type === 'deposit' ? '定期存入' : '资金提取')).trim();
        const note = String(raw.note || '').trim();
        if (category.length > 40 || note.length > 500) throw new Error('用途或备注过长');
        return {id,date,type:raw.type,currency:raw.currency,amount,fx,category,note};
    }
    const signed = row => row.amount * (row.type === 'deposit' ? 1 : -1);
    function summary(rows, year) {
        const selected = rows.filter(row => !year || row.date.startsWith(String(year)+'-'));
        const months = Array.from({length:12}, () => ({deposits:0,withdrawals:0,net:0,count:0}));
        const byCurrency = Object.fromEntries(currencies.map(currency => [currency,{deposits:0,withdrawals:0,net:0}]));
        let deposits=0,withdrawals=0;
        selected.forEach(row => {
            const key=row.type==='deposit'?'deposits':'withdrawals', converted=row.amount*row.fx;
            if(key==='deposits') deposits+=converted; else withdrawals+=converted;
            const month=months[Number(row.date.slice(5,7))-1]; month[key]+=converted; month.net+=signed(row)*row.fx; month.count++;
            byCurrency[row.currency][key]+=row.amount; byCurrency[row.currency].net+=signed(row);
        });
        return {deposits,withdrawals,net:deposits-withdrawals,months,byCurrency,count:selected.length};
    }
    // Apply only the difference when editing a synchronized record. Import never applies cash.
    // Work on a clone so a failed edit cannot leave a half-applied balance change.
    function syncCash(state, row, oldEffect, enabled, makeId = () => 'cash-'+Date.now()) {
        const copy=JSON.parse(JSON.stringify(state)); copy.cash ||= [];
        const deltas=new Map();
        if(oldEffect) {
            const item=copy.cash.find(item=>String(item.id)===oldEffect.id && item.currency===oldEffect.currency);
            if(!item) throw new Error('关联的现金余额已删除，无法撤销同步');
            deltas.set(item.id,-oldEffect.delta);
        }
        let effect;
        if(enabled && row) {
            let item=copy.cash.find(item=>item.currency===row.currency);
            if(!item) { item={id:makeId(),ticker:row.currency,currency:row.currency,amount:0}; copy.cash.push(item); }
            const delta=signed(row);
            deltas.set(item.id,(deltas.get(item.id)||0)+delta);
            effect={id:String(item.id),currency:row.currency,delta};
        }
        deltas.forEach((delta,id)=>{
            const item=copy.cash.find(item=>item.id===id), next=Number(item.amount||0)+delta;
            if(!Number.isFinite(next) || next < -1e-7) throw new Error('现金余额不足，无法同步这笔变动');
            item.amount=Math.max(0,Math.round(next*100)/100);
        });
        return {state:copy,effect};
    }
    const escape = value => /[",\r\n]/.test(String(value)) ? '"'+String(value).replace(/"/g,'""')+'"' : String(value);
    function exportCSV(rows) {
        return '\uFEFF'+headers.join(',')+'\r\n'+rows.map(row=>[row.id,row.date,row.type,row.currency,row.amount,row.fx,row.category,row.note].map(escape).join(',')).join('\r\n')+(rows.length?'\r\n':'');
    }
    function importCSV(text, existing=[]) {
        const parsed=CSV.cells(text), columns=parsed.shift();
        if(!columns || columns.length!==headers.length || headers.some((h,i)=>h!==columns[i].trim())) throw new Error('请使用 AssetHub 的资金记录 CSV');
        const incoming=parsed.map((v,i)=>{try {
            if(v.length!==headers.length) throw new Error('列数不一致');
            return record({date:v[1],type:v[2],currency:v[3],amount:v[4],fx:v[5],category:v[6],note:v[7]},v[0]);
        }catch(error){throw new Error('第 '+(i+2)+' 行：'+error.message);}});
        const byId=new Map(existing.map(row=>[row.id,row])), added=[];let skipped=0;
        for(const row of incoming) {
            const previous=byId.get(row.id);
            if(previous) {
                const plain=record(previous,previous.id);
                if(JSON.stringify(plain)!==JSON.stringify(row)) throw new Error('记录 '+row.id+' 已有不同内容，请先核对');
                skipped++;
            } else { added.push(row);byId.set(row.id,row); }
        }
        return {rows:[...existing,...added],added:added.length,skipped};
    }
    return {headers,record,signed,summary,syncCash,exportCSV,importCSV};
});
