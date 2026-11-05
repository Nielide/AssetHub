/* Explicit external funding ledger. CSV import records entries without applying balances. */
(function() {
    const model=FundsModel, el=id=>document.getElementById(id);
    const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
    const money=(value,currency='CNY',signed=false)=>isPrivacyMode?'••••':(signed?(value>=0?'+':'−'):'')+({CNY:'¥',USD:'$',HKD:'HK$'}[currency])+Math.abs(value).toFixed(2);
    const storageKey=()=> 'assethub_funds:'+(localStorage.getItem('gh_repo')||'Nielide/AssetHub')+':'+(localStorage.getItem('gh_path')||'data/data.json');
    let ledger={rows:[],updatedAt:0},loadedKey,year=new Date().getFullYear(),statusTimer;
    function load() {
        if(loadedKey===storageKey()) return;
        loadedKey=storageKey();
        try {const saved=JSON.parse(localStorage.getItem(loadedKey)||'null');ledger=saved?{...saved,rows:saved.rows.map(row=>({...model.record(row,row.id),effect:row.effect}))}:{rows:[],updatedAt:0};}
        catch{ledger={rows:[],updatedAt:0};}
    }
    function persist() {ledger.updatedAt=Date.now();localStorage.setItem(storageKey(),JSON.stringify(ledger));renderFunds();}
    function status(message) {clearTimeout(statusTimer);el('funds-status').textContent=message;if(message)statusTimer=setTimeout(()=>el('funds-status').textContent='',7000);}
    window.getFundRows=()=>{load();return ledger.rows;};
    window.changeFundsYear=offset=>{year+=offset;renderFunds();};
    window.renderFunds=()=>{
        load();if(!el('funds-content')) return;
        const summary=model.summary(ledger.rows,year), month=el('funds-month').value;
        el('funds-year-display').textContent=year+'年';el('funds-currency-year').textContent=year+'年';
        el('funds-metrics').innerHTML=[['年度转入',summary.deposits,'deposit'],['年度转出',summary.withdrawals,'withdrawal'],['年度净投入',summary.net,'net']].map(([label,value,tone])=>'<div class="funds-metric '+tone+'"><span>'+label+'</span><strong>'+money(value,'CNY',tone==='net')+'</strong><small>'+({deposit:'存入资产系统',withdrawal:'从资产系统取出',net:summary.count+' 笔记录'}[tone])+'</small></div>').join('');
        const max=Math.max(1,...summary.months.flatMap(m=>[m.deposits,m.withdrawals]));
        el('funds-months').innerHTML=summary.months.map((m,i)=>'<button type="button" data-funds-month="'+(i+1)+'" aria-pressed="'+(month===String(i+1))+'" title="'+(i+1)+'月：转入 '+money(m.deposits)+'，转出 '+money(m.withdrawals)+'"><span class="funds-month-value">'+(isPrivacyMode?'••••':m.count?(m.net>0?'+':m.net<0?'−':'')+Math.round(Math.abs(m.net)):'—')+'</span><span class="funds-bars"><i style="height:'+(isPrivacyMode?0:m.deposits/max*100)+'%"></i><i style="height:'+(isPrivacyMode?0:m.withdrawals/max*100)+'%"></i></span><span>'+(i+1)+'月</span></button>').join('');
        el('funds-months').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{el('funds-month').value=month===button.dataset.fundsMonth?'all':button.dataset.fundsMonth;renderFunds();}));
        el('funds-currencies').innerHTML=Object.entries(summary.byCurrency).map(([currency,s])=>'<div class="funds-currency-row"><b>'+currency+'</b><span>'+money(s.deposits,currency)+'</span><span>'+money(s.withdrawals,currency)+'</span><strong>'+money(s.net,currency,true)+'</strong></div>').join('');
        const query=el('funds-search').value.trim().toLowerCase(),type=el('funds-type-filter').value,currency=el('funds-currency-filter').value;
        const rows=ledger.rows.filter(row=>row.date.startsWith(year+'-')&&(month==='all'||Number(row.date.slice(5,7))===Number(month))&&(type==='all'||row.type===type)&&(currency==='all'||row.currency===currency)&&(!query||(row.category+' '+row.note).toLowerCase().includes(query))).sort((a,b)=>b.date.localeCompare(a.date));
        el('funds-count').textContent=rows.length+' 条';
        el('funds-content').innerHTML=rows.length?'<table class="transactions-table funds-table"><thead><tr><th>日期</th><th>类型</th><th>用途</th><th>原币金额</th><th>人民币折算</th><th>备注</th><th>现金余额</th><th></th></tr></thead><tbody>'+rows.map(row=>'<tr data-fund-id="'+escape(row.id)+'"><td>'+escape(row.date)+'</td><td><span class="fund-type '+row.type+'">'+(row.type==='deposit'?'↙ 转入':'↗ 转出')+'</span></td><td>'+escape(row.category)+'</td><td class="fund-value">'+money(model.signed(row),row.currency,true)+'</td><td class="fund-value muted" title="记录时汇率 '+row.fx+'">'+money(model.signed(row)*row.fx,'CNY',true)+'</td><td class="fund-note">'+escape(row.note||'—')+'</td><td class="muted">'+(row.effect?'已同步':'仅记录')+'</td><td><button class="icon-button" data-edit-fund="'+escape(row.id)+'" aria-label="编辑 '+escape(row.date)+' 资金记录">⋯</button></td></tr>').join('')+'</tbody></table>':'<div class="funds-empty"><span aria-hidden="true">↙</span><h3>暂无资金记录</h3><p>'+ (summary.count?'调整筛选查看其他记录':'记下每一笔存入与提取')+'</p>'+(!summary.count?'<button class="btn-action" onclick="editFund()">添加第一笔</button>':'')+'</div>';
        el('funds-content').querySelectorAll('[data-edit-fund]').forEach(button=>button.addEventListener('click',()=>editFund(button.dataset.editFund)));
    };
    window.setFundDirection=type=>{
        el('fund-type').value=type;
        document.querySelectorAll('[data-fund-direction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fundDirection===type)));
        el('fund-category').innerHTML=(type==='deposit'?['定期存入','额外存入','其他转入']:['资金提取','大额支出','其他转出']).map(v=>'<option>'+v+'</option>').join('');
        updateFormTotal();
    };
    const currentFx=currency=>currency==='CNY'?1:currency==='USD'?(Number(el('fx-rate').value)||state.fxRate||7.25):(Number(el('hkd-rate').value)||state.hkdFx||.93);
    window.editFund=id=>{
        load();const row=ledger.rows.find(row=>row.id===id);
        el('funds-dialog-title').textContent=row?'编辑资金记录':'添加资金记录';el('fund-id').value=row?.id||'';
        setFundDirection(row?.type||'deposit');el('fund-currency').value=row?.currency||'CNY';el('fund-amount').value=row?.amount||'';el('fund-date').value=row?.date||today();
        if(row?.category&&!Array.from(el('fund-category').options).some(option=>option.value===row.category))el('fund-category').add(new Option(row.category,row.category));
        if(row)el('fund-category').value=row.category;
        el('fund-note').value=row?.note||'';el('fund-fx').value=row?.fx||currentFx(el('fund-currency').value);
        el('fund-sync').checked=!!row?.effect;el('fund-delete').hidden=!row;el('fund-error').textContent='';
        updateFormTotal();el('funds-dialog').showModal();el('fund-amount').focus();
    };
    window.closeFundsEditor=()=>el('funds-dialog').close();
    function formRecord() {return model.record({date:el('fund-date').value,type:el('fund-type').value,currency:el('fund-currency').value,amount:el('fund-amount').value,fx:el('fund-fx').value,category:el('fund-category').value,note:el('fund-note').value},el('fund-id').value||'f-'+crypto.randomUUID());}
    function updateFormTotal() {
        el('fund-fx').readOnly=el('fund-currency').value==='CNY';
        try {const row=formRecord();el('fund-converted').textContent=money(row.amount*row.fx);}catch{el('fund-converted').textContent='—';}
    }
    function applyChange(row,old,sync) {
        if(!old?.effect&&!sync) return;
        const result=model.syncCash(state,row,old?.effect,sync,()=> 'cash-'+crypto.randomUUID());
        if(row)row.effect=result.effect;
        state=result.state;state.lastSavedAt=Date.now();renderAllRows();calculate();
    }
    el('funds-form').addEventListener('submit',event=>{
        event.preventDefault();load();
        try {
            const row=formRecord(),old=ledger.rows.find(r=>r.id===row.id);applyChange(row,old,el('fund-sync').checked);
            const index=ledger.rows.findIndex(r=>r.id===row.id);if(index<0)ledger.rows.push(row);else ledger.rows[index]=row;
            year=Number(row.date.slice(0,4));el('funds-month').value='all';el('funds-type-filter').value='all';el('funds-currency-filter').value='all';el('funds-search').value='';
            persist();closeFundsEditor();status('已保存');
        }catch(error){el('fund-error').textContent=error.message;}
    });
    window.deleteCurrentFund=()=>{
        load();const row=ledger.rows.find(row=>row.id===el('fund-id').value);if(!row)return;
        if(!confirm(row.effect?'删除记录并撤销对应现金变动？':'删除这条资金记录？'))return;
        try {applyChange(null,row,false);ledger.rows=ledger.rows.filter(r=>r.id!==row.id);persist();closeFundsEditor();status('已删除');}
        catch(error){el('fund-error').textContent=error.message;}
    };
    window.importFundsCSV=text=>{load();const result=model.importCSV(text,ledger.rows);ledger.rows=result.rows;persist();status('导入 '+result.added+' 条，跳过 '+result.skipped+' 条重复；现金余额未调整');return result;};
    window.exportFundsCSV=()=>{const url=URL.createObjectURL(new Blob([model.exportCSV(getFundRows())],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='assethub_funds_'+today()+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    function cloudConfig() {
        const repo=localStorage.getItem('gh_repo')||'Nielide/AssetHub',path=localStorage.getItem('gh_path')||'data/data.json',token=localStorage.getItem('gh_token');
        if(!token)throw new Error('请先设置 GitHub 令牌');
        return {url:'https://api.github.com/repos/'+repo+'/contents/'+(path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'')+'funds.csv',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}};
    }
    window.loadFundsCloud=async()=>{
        try {const config=cloudConfig(),response=await fetch(config.url,{headers:config.headers,cache:'no-store'});if(!response.ok)throw new Error(response.status===404?'云端暂无资金记录':'载入失败');const data=await response.json();importFundsCSV(new TextDecoder().decode(Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));localStorage.setItem(storageKey()+':sha',data.sha);}
        catch(error){status(error.message);}
    };
    window.backupFundsCloud=async()=>{
        try {
            const config=cloudConfig(),check=await fetch(config.url,{headers:config.headers,cache:'no-store'});let sha;
            if(check.ok){const data=await check.json();sha=data.sha;if(sha!==localStorage.getItem(storageKey()+':sha')&&!confirm('云端资金记录有更新，继续用本地覆盖？'))return;}
            else if(check.status!==404)throw new Error('无法检查云端资金记录');
            const bytes=new TextEncoder().encode(model.exportCSV(getFundRows())),content=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
            const response=await fetch(config.url,{method:'PUT',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Update external funding ledger',content,...(sha?{sha}:{})})});
            if(!response.ok)throw new Error('资金记录备份失败');const saved=await response.json();localStorage.setItem(storageKey()+':sha',saved.content.sha);status('资金记录已备份');
        }catch(error){status(error.message);}
    };
    for(let m=1;m<=12;m++)el('funds-month').add(new Option(m+'月',String(m)));
    ['funds-search','funds-month','funds-type-filter','funds-currency-filter'].forEach(id=>el(id).addEventListener('input',renderFunds));
    el('funds-form').addEventListener('input',updateFormTotal);
    el('fund-currency').addEventListener('change',()=>{el('fund-fx').value=currentFx(el('fund-currency').value);updateFormTotal();});
    el('funds-import').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{importFundsCSV(await file.text());}catch(error){status(error.message);}finally{event.target.value='';}});
    el('funds-dialog').addEventListener('click',event=>{const b=el('funds-dialog').getBoundingClientRect();if(event.target===el('funds-dialog')&&(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom))closeFundsEditor();});
    window.addEventListener('storage',event=>{if(event.key===storageKey()){loadedKey=null;renderFunds();}});
    const previousOnload=window.onload;
    window.onload=async function(){await previousOnload();load();if(!localStorage.getItem(storageKey())&&(!localStorage.getItem('gh_repo')||localStorage.getItem('gh_repo')==='Nielide/AssetHub')){try{const response=await fetch('./data/funds.csv',{cache:'no-store'});if(response.ok){const result=model.importCSV(await response.text(),ledger.rows);ledger.rows=result.rows;persist();}}catch(error){status(error.message);}}renderFunds();};
})();
