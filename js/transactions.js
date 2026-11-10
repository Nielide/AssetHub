/* CSV ledger: local cache and explicit CSV backup are independent of daily history. */
(function() {
    const model = TransactionsModel, el = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const number = value => Number(value).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6 });
    const money = (value, currency) => isPrivacyMode ? '••••' : ({USD:'$', CNY:'¥', HKD:'HK$'}[currency] || '') + Number(value).toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const priceMoney = (value, currency) => isPrivacyMode ? '••••' : ({USD:'$', CNY:'¥', HKD:'HK$'}[currency] || '') + Number(value).toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 6 });
    const date = () => { const now = new Date(); return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0'); };
    const storageKey = () => 'assethub_transactions:' + (localStorage.getItem('gh_repo') || 'Nielide/AssetHub') + ':' + (localStorage.getItem('gh_path') || 'data/data.json');
    let ledger = { rows: [], updatedAt: 0 }, loadedKey, statusTimer, view = localStorage.getItem('assethub_transactions_view') === 'table' ? 'table' : 'list';
    function load() {
        if (loadedKey === storageKey()) return;
        loadedKey = storageKey();
        try { const saved = JSON.parse(localStorage.getItem(loadedKey) || 'null'); ledger = saved ? { ...saved, rows: saved.rows.map(row => ({ ...model.record(row.raw, row.id), effect: row.effect })) } : { rows: [], updatedAt: 0 }; }
        catch { ledger = { rows: [], updatedAt: 0 }; }
    }
    function persist() {
        ledger.updatedAt = Date.now(); localStorage.setItem(storageKey(), JSON.stringify(ledger));
        renderTransactions(); window.dispatchEvent(new Event('transactionschange'));
    }
    function status(message) { clearTimeout(statusTimer); el('transactions-status').textContent = message; if (message) statusTimer = setTimeout(() => { el('transactions-status').textContent = ''; }, 6000); }
    window.getTransactionRows = () => { load(); return ledger.rows; };
    window.setTransactionView = mode => { view = mode === 'table' ? 'table' : 'list'; localStorage.setItem('assethub_transactions_view', view); renderTransactions(); };
    window.transactionMarkup = (rows, mode = 'list') => {
        const title = mode === 'table' ? ['代码','日期','数量','价格','价格币种','手续费率 %','手续费','费用币种',''] : ['资产','日期','类型','股数','成交价','手续费','总额',''];
        const body = rows.slice().sort((a,b) => b.date.localeCompare(a.date)).map(row => {
            const type = {buy:'买入',sell:'卖出',fee:'手续费'}[row.type], charge = model.fee(row);
            const total = charge === null ? null : Math.abs(row.quantity) * row.price + (row.type === 'sell' ? -charge : charge);
            const fields = mode === 'table' ? [escape(row.symbol),escape(row.date),isPrivacyMode ? '••••' : number(row.quantity),priceMoney(row.price,row.currency),escape(row.raw['Price Currency'] || '—'),number(row.feePct),money(row.feeAmount,row.feeCurrency),escape(row.raw['Fees Currency'] || '—')] : ['<button class="transaction-asset" data-symbol="'+escape(row.symbol)+'" data-currency="'+row.currency+'">'+escape(row.symbol)+'</button>',escape(row.date),'<span class="trade-type trade-type-'+row.type+'">'+type+'</span>',isPrivacyMode ? '••••' : number(Math.abs(row.quantity)),priceMoney(row.price,row.currency),money(row.feeAmount,row.feeCurrency)+(row.feePct ? ' + '+number(row.feePct)+'%' : ''),total === null ? '—' : money(total,row.currency)];
            return '<tr data-transaction-id="'+escape(row.id)+'">'+fields.map(field => '<td>'+field+'</td>').join('')+'<td><button class="icon-button transaction-edit" data-id="'+escape(row.id)+'" aria-label="编辑 '+escape(row.symbol)+' 交易">⋯</button></td></tr>';
        }).join('');
        return rows.length ? '<table class="transactions-table"><thead><tr>'+title.map(label=>'<th>'+label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>' : '<div class="empty-state">暂无交易记录</div>';
    };
    window.bindTransactionTable = container => {
        container.querySelectorAll('.transaction-edit').forEach(button => button.addEventListener('click', () => editTransaction(button.dataset.id)));
        container.querySelectorAll('.transaction-asset').forEach(button => button.addEventListener('click', () => openAssetDetail(button.dataset.symbol, button.dataset.currency)));
    };
    window.renderTransactions = () => {
        load(); if (!el('transactions-content')) return;
        const query = el('transactions-search').value.trim().toUpperCase(), type = el('transactions-type').value, currency = el('transactions-currency').value;
        const from = el('transactions-from').value, to = el('transactions-to').value;
        const rows = ledger.rows.filter(row => (!query || row.symbol.includes(query)) && (type === 'all' || row.type === type) && (currency === 'all' || row.currency === currency) && (!from || row.date >= from) && (!to || row.date <= to));
        const summary = model.summary(rows);
        el('transactions-count').textContent = rows.length + (rows.length !== ledger.rows.length ? ' / '+ledger.rows.length : '') + ' 条';
        const feeText = Object.entries(summary.fees).filter(([,value])=>value).map(([currency,value])=>money(value,currency)).join(' · ') || '—';
        el('transactions-metrics').innerHTML = '<div><span>买入</span><b>'+summary.buys+'</b></div><div><span>卖出</span><b>'+summary.sells+'</b></div><div><span>手续费</span><b>'+feeText+'</b></div>';
        el('transactions-content').innerHTML = transactionMarkup(rows, view); bindTransactionTable(el('transactions-content'));
        document.querySelectorAll('[data-transaction-view]').forEach(button => { const active = button.dataset.transactionView === view; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    };
    window.importTransactionsCSV = text => {
        load(); const result = model.importCSV(text, ledger.rows, () => 't-'+crypto.randomUUID());
        ledger.rows = result.rows; persist(); status('导入 '+result.added+' 条，跳过 '+result.skipped+' 条重复'); return result;
    };
    window.exportTransactionsCSV = () => {
        const blob = new Blob([model.exportCSV(getTransactionRows())], { type:'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'stock_events_transactions_'+date()+'.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    window.closeTransactionEditor = () => el('transaction-dialog').close();
    window.editTransaction = (id, asset) => {
        load(); const row = ledger.rows.find(item=>item.id===id), parts = (asset || '').split(':');
        el('transaction-dialog-title').textContent = row ? '编辑交易' : '添加交易';
        el('trade-id').value = row?.id || ''; el('trade-type').value = row?.type || 'buy';
        el('trade-symbol').value = row?.symbol || parts.slice(1).join(':'); el('trade-date').value = row?.date || date();
        el('trade-quantity').value = row ? Math.abs(row.quantity) : ''; el('trade-price').value = row?.price ?? '';
        el('trade-currency').value = row?.currency || parts[0] || 'USD'; el('trade-fee-pct').value = row?.feePct || 0;
        el('trade-fee').value = row?.feeAmount || 0; el('trade-fee-currency').value = row?.feeCurrency || el('trade-currency').value;
        el('trade-sync').checked = !!row?.effect; el('trade-delete').hidden = !row; el('trade-error').textContent = '';
        updateFormTotal(); el('transaction-dialog').showModal(); el('trade-symbol').focus();
    };
    function formRecord() {
        const quantity = el('trade-type').value === 'fee' ? 0 : Number(el('trade-quantity').value) * (el('trade-type').value === 'sell' ? -1 : 1);
        if (el('trade-type').value !== 'fee' && !Math.abs(quantity)) throw new Error('请填写股数');
        return model.record({Symbol:el('trade-symbol').value.trim().toUpperCase(),Date:el('trade-date').value,Quantity:String(quantity),Price:el('trade-price').value,'Price Currency':el('trade-currency').value,'Fees Percentage':el('trade-fee-pct').value || '0','Fees Amount':el('trade-fee').value || '0','Fees Currency':el('trade-fee-currency').value}, el('trade-id').value || 't-'+crypto.randomUUID());
    }
    function updateFormTotal() {
        const isFee = el('trade-type').value === 'fee';
        ['trade-quantity','trade-price'].forEach(id => { el(id).disabled=isFee; el(id).required=!isFee; if(isFee) el(id).value=0; });
        try { const row = formRecord(), fee = model.fee(row); el('trade-total').textContent = fee === null ? '—' : money(Math.abs(row.quantity)*row.price+(row.type==='sell'?-fee:fee),row.currency); }
        catch { el('trade-total').textContent = '—'; }
        el('trade-sync').disabled = el('trade-type').value === 'fee';
    }
    function undoEffect(portfolio, effect) {
        if (!effect) return;
        const item = portfolio[effect.type].find(item=>String(item.id)===effect.id);
        if (!item || Math.abs(item.shares-effect.after.shares)>1e-7 || Math.abs(item.cost-effect.after.cost)>1e-7) throw new Error('持仓已变化，请先取消同步持仓');
        if (effect.created) portfolio[effect.type] = portfolio[effect.type].filter(item=>String(item.id)!==effect.id);
        else { item.shares = effect.before.shares; item.cost = effect.before.cost; }
    }
    function syncPosition(portfolio, row) {
        const type = row.currency === 'CNY' ? 'cn' : row.symbol === 'SGOV' ? 'sgov' : 'usd';
        if (row.currency === 'HKD' || row.type === 'fee') throw new Error('该记录暂不支持同步持仓');
        let item = portfolio[type].find(item=>String(item.ticker).trim().toUpperCase()===row.symbol), created = !item;
        if (!item && row.type === 'sell') throw new Error('没有可卖出的持仓');
        if (!item) { item = {id:'h-'+crypto.randomUUID(),ticker:row.symbol,shares:0,cost:0,price:row.price}; portfolio[type].push(item); }
        const before = {shares:Number(item.shares),cost:Number(item.cost)}, charge = model.fee(row);
        if (charge === null) throw new Error('同步持仓需要相同的成交和手续费币种');
        if (row.type === 'sell' && -row.quantity > item.shares + 1e-7) throw new Error('卖出股数超过当前持仓');
        if (row.type === 'buy') item.cost = (item.shares*item.cost+row.quantity*row.price+charge)/(item.shares+row.quantity);
        item.shares = Math.max(0,item.shares+row.quantity);
        return {type,id:String(item.id),created,before,after:{shares:item.shares,cost:item.cost}};
    }
    window.deleteCurrentTransaction = () => {
        load(); const id = el('trade-id').value, row = ledger.rows.find(item=>item.id===id); if (!row) return;
        if (!confirm('删除这条交易记录？')) return;
        try {
            if (row.effect) { const copy = JSON.parse(JSON.stringify(state)); undoEffect(copy,row.effect); state = copy; state.lastSavedAt = Date.now(); renderAllRows(); calculate(); }
            ledger.rows = ledger.rows.filter(item=>item.id!==id); persist(); closeTransactionEditor();
        } catch(error) { el('trade-error').textContent = error.message; }
    };
    function cloudConfig() {
        const repo = localStorage.getItem('gh_repo') || 'Nielide/AssetHub', path = localStorage.getItem('gh_path') || 'data/data.json', token = localStorage.getItem('gh_token');
        if (!token) throw new Error('请先设置 GitHub 令牌');
        const file = (path.includes('/') ? path.slice(0,path.lastIndexOf('/')+1) : '')+'transactions.csv';
        return {url:'https://api.github.com/repos/'+repo+'/contents/'+file,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}};
    }
    window.loadTransactionsCloud = async () => {
        try { const config = cloudConfig(), response = await fetch(config.url,{headers:config.headers,cache:'no-store'}); if (!response.ok) throw new Error(response.status===404?'云端暂无流水':'载入失败'); const data = await response.json(); const text = new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\s/g,'')),char=>char.charCodeAt(0))); const result = importTransactionsCSV(text); localStorage.setItem(storageKey()+':sha',data.sha); status('载入 '+result.added+' 条，保留本地记录'); }
        catch(error) { status(error.message); }
    };
    window.backupTransactionsCloud = async () => {
        try {
            const config = cloudConfig(), text = model.exportCSV(getTransactionRows());
            const check = await fetch(config.url,{headers:config.headers,cache:'no-store'}); let sha;
            if (check.ok) { const data=await check.json(); sha=data.sha; if (sha!==localStorage.getItem(storageKey()+':sha') && !confirm('云端流水有更新，继续用本地覆盖？')) return; }
            else if (check.status!==404) throw new Error('无法检查云端流水');
            const bytes = new TextEncoder().encode(text), content = btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
            const response=await fetch(config.url,{method:'PUT',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Update transaction ledger',content,...(sha?{sha}:{})})});
            if (!response.ok) throw new Error('流水备份失败'); const saved=await response.json(); localStorage.setItem(storageKey()+':sha',saved.content.sha); status('流水已备份');
        } catch(error) { status(error.message); }
    };
    el('transactions-import').addEventListener('change',async event=>{const file=event.target.files[0]; if (!file) return; try {importTransactionsCSV(await file.text());}catch(error){status(error.message);}finally{event.target.value='';}});
    ['transactions-search','transactions-type','transactions-currency','transactions-from','transactions-to'].forEach(id=>el(id).addEventListener('input',renderTransactions));
    el('transaction-form').addEventListener('input',updateFormTotal);
    el('transaction-form').addEventListener('submit',event=>{
        event.preventDefault(); load();
        try {
            const row=formRecord(), old=ledger.rows.find(item=>item.id===row.id), sync=el('trade-sync').checked && row.type!=='fee';
            if (sync || old?.effect) {
                const copy=JSON.parse(JSON.stringify(state));
                try { undoEffect(copy,old?.effect); } catch(error) { if(sync) throw error; }
                if (sync) row.effect=syncPosition(copy,row);
                state=copy; state.lastSavedAt=Date.now(); renderAllRows(); calculate();
            }
            const index=ledger.rows.findIndex(item=>item.id===row.id); if(index<0) ledger.rows.push(row); else ledger.rows[index]=row;
            persist(); closeTransactionEditor(); status('已保存');
        } catch(error) {el('trade-error').textContent=error.message;}
    });
    el('transaction-dialog').addEventListener('click',event=>{const dialog=el('transaction-dialog'),bounds=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom))closeTransactionEditor();});
    window.addEventListener('storage',event=>{if(event.key===storageKey()){loadedKey=null;renderTransactions();window.dispatchEvent(new Event('transactionschange'));}});
    const originalOnload=window.onload;
    window.onload=async function(){
        await originalOnload(); load();
        if (!localStorage.getItem(storageKey()) && (!localStorage.getItem('gh_repo') || localStorage.getItem('gh_repo') === 'Nielide/AssetHub')) {
            try { const response=await fetch('./data/transactions.csv',{cache:'no-store'}); if(response.ok) { const result=model.importCSV(await response.text(),[],()=> 't-'+crypto.randomUUID()); ledger.rows=result.rows;persist(); } } catch(error) { status(error.message); }
        }
        renderTransactions();
    };
})();
