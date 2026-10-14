(function() {
    const el=id=>document.getElementById(id), escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money=(value,currency,decimals=2)=>isPrivacyMode?'••••':({USD:'$',CNY:'¥',HKD:'HK$'}[currency]||'')+Number(value).toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
    const number=value=>isPrivacyMode?'••••':Number(value).toLocaleString('en-US',{maximumFractionDigits:6});
    const date=()=>{const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');};
    const names={GOOGL:'Alphabet',META:'Meta Platforms',VOO:'先锋标普 500 ETF',QQQM:'纳斯达克 100 ETF',SGOV:'短期美国国债 ETF',IBIT:'iShares 比特币 ETF',NKE:'Nike',UBER:'Uber',NTDOY:'任天堂'};
    let tab='holding',range=90,returnPanel='holdings',priceChart;
    function route() {const parts=(window.assetRoute||'USD:QQQM').split(':');return{currency:parts.shift(),symbol:parts.join(':')};}
    function prices() {const key=window.assetRoute;return (state.priceHistory?.[key]||[]).slice().sort((a,b)=>a.date.localeCompare(b.date));}
    function recordPrices() {
        state.priceHistory ||= {};const today=date();
        const snapshot=PortfolioModel.snapshot(state,el('fx-rate').value), quotes=new Map();
        snapshot.positions.forEach(item=>{if(item.price>0&&item.ticker&&String(item.ticker).trim().toUpperCase()!=='NEW')quotes.set(item.currency+':'+String(item.ticker).trim().toUpperCase(),item.price);});
        (state.drawdown||[]).forEach(item=>{const key=(item.currency||'USD')+':'+item.symbol;if(item.current>0&&item.symbol&&!quotes.has(key))quotes.set(key,item.current);});
        quotes.forEach((price,key)=>{const book=state.priceHistory[key]||=[];const point=book.find(item=>item.date===today);if(point){point.price=price;point.source='snapshot';}else book.push({date:today,price,source:'snapshot'});if(book.length>10000)book.splice(0,book.length-10000);});
    }
    window.openAssetDetail=(symbol,currency='USD')=>{
        symbol=String(symbol).trim().toUpperCase();if(!symbol||symbol==='NEW')return;
        const visible=document.querySelector('.workspace-panel:not([hidden])');if(visible?.dataset.panel!=='asset')returnPanel=visible?.dataset.panel||'holdings';
        tab='holding';navigateWorkspace('asset/'+encodeURIComponent(currency+':'+symbol));scrollTo(0,0);
    };
    window.backFromAsset=()=>navigateWorkspace(returnPanel);
    window.setAssetTab=value=>{tab=['holding','transactions','history','about'].includes(value)?value:'holding';renderAssetDetail();};
    window.setAssetRange=value=>{range=Number(value);renderAssetDetail();};
    function stat(label,value,tone='',title=''){return '<div class="asset-stat-row"'+(title?' title="'+escape(title)+'"':'')+'><span>'+label+'</span><b class="'+tone+'">'+value+'</b></div>';}
    window.renderAssetDetail=()=>{
        if(!el('panel-asset')||!window.assetRoute)return;
        const {symbol,currency}=route(), snapshot=PortfolioModel.snapshot(state,el('fx-rate').value);
        const positions=snapshot.positions.filter(item=>item.currency===currency&&String(item.ticker).trim().toUpperCase()===symbol);
        const quantity=positions.reduce((sum,item)=>sum+item.shares,0), value=positions.reduce((sum,item)=>sum+item.value,0), cost=positions.reduce((sum,item)=>sum+item.costValue,0), weight=positions.reduce((sum,item)=>sum+item.weight,0);
        const book=prices(), price=quantity?value/quantity:book.at(-1)?.price||state.drawdown.find(item=>item.symbol===symbol)?.current||0;
        const rows=getTransactionRows().filter(item=>item.symbol===symbol&&item.currency===currency), summary=TransactionsModel.summary(rows,symbol,currency);
        el('asset-title').textContent=names[symbol]||symbol;el('asset-code').textContent=symbol+' · '+currency;
        const icon=document.querySelector('#panel-holdings input[value="'+CSS.escape(symbol)+'"]')?.parentElement.querySelector('.holding-icon')||document.querySelector('.dd-row input[value="'+CSS.escape(symbol)+'"]')?.parentElement.querySelector('.holding-icon');
        el('asset-icon').innerHTML=icon?.innerHTML||escape(symbol.slice(0,1));el('asset-icon').querySelectorAll('img').forEach(img=>{img.draggable=false;});
        el('asset-price').textContent=price?money(price,currency,currency==='CNY'?3:2):'—';
        const executionPrices=book.length<2&&rows.some(row=>row.price>0);
        const chartBook=executionPrices?[...rows.filter(row=>row.price>0).map(row=>({date:row.date,price:row.price,source:'trade'})),...book].sort((a,b)=>a.date.localeCompare(b.date)):book;
        const lastDate=chartBook.at(-1)?.date||date(), cutoff=new Date(lastDate+'T00:00:00Z');if(range)cutoff.setUTCDate(cutoff.getUTCDate()-range);
        const selected=range?chartBook.filter(point=>point.date>=cutoff.toISOString().slice(0,10)):chartBook;
        const priceReturn=selected.length>1?(selected.at(-1).price/selected[0].price-1)*100:null;
        el('asset-price-return').textContent=priceReturn===null?'—':(priceReturn>=0?'+':'')+priceReturn.toFixed(2)+'%';el('asset-price-return').className=priceReturn===null?'muted':priceReturn<0?'negative':'positive';
        el('asset-chart-empty').textContent=executionPrices?'成交价格 · 当前报价':selected.length<2?(selected.length?'1 条价格记录':'暂无价格记录'):'价格记录';
        el('asset-ranges').innerHTML=[[7,'1周'],[30,'1月'],[90,'3月'],[180,'6月'],[365,'1年'],[1825,'5年'],[0,'全部']].map(([days,label])=>'<button class="nw-range-btn" data-asset-range="'+days+'" aria-pressed="'+(range===days)+'" onclick="setAssetRange('+days+')">'+label+'</button>').join('');
        if(priceChart)priceChart.destroy();
        const dark=document.documentElement.classList.contains('dark');
        priceChart=new Chart(el('chart-asset'),{type:'line',data:{labels:selected.map(item=>item.date),datasets:[{data:selected.map(item=>item.price),borderColor:dark?'#c4d391':'#8a9e36',borderWidth:2,borderDash:executionPrices?[5,4]:[],pointRadius:executionPrices?3:selected.length<2?4:0,pointHoverRadius:4,tension:.18,fill:true,backgroundColor:context=>{const{ctx,chartArea}=context.chart;if(!chartArea)return'transparent';const gradient=ctx.createLinearGradient(0,chartArea.top,0,chartArea.bottom);gradient.addColorStop(0,'rgba(147,165,69,.24)');gradient.addColorStop(1,'rgba(147,165,69,.02)');return gradient;}}]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{enabled:!isPrivacyMode,displayColors:false,callbacks:{label:context=>(selected[context.dataIndex]?.source==='trade'?'成交价 ':'报价 ')+money(context.raw,currency,3)}}},scales:{x:{display:false},y:{display:false}}}});
        const profit=cost>0?value-cost:null, previous=positions.find(item=>item.previousClose>0)?.previousClose||book.filter(item=>item.date<date()).at(-1)?.price;
        const today=previous&&price?(price-previous)*quantity:null;
        const feeText=Object.entries(summary.fees).filter(([,amount])=>amount).map(([unit,amount])=>money(amount,unit)).join(' · ')||'—';
        el('asset-stats').innerHTML='<div class="asset-stats-main"><div><b>'+number(quantity)+'</b><span>股数</span></div><div><b>'+money(value,currency)+'</b><span>市值</span></div></div>'+stat('成本基础',quantity&&cost?money(cost,currency):'—')+stat('平均成本',quantity&&cost?money(cost/quantity,currency,currency==='CNY'?3:2):'—')+stat('组合占比',isPrivacyMode?'••••':weight.toFixed(2)+'%')+'<div class="asset-stats-divider"></div>'+stat('当日变动',today===null?'—':money(today,currency),today===null?'':today<0?'negative':'positive')+stat('浮动盈亏',profit===null?'—':money(profit,currency),profit===null?'':profit<0?'negative':'positive')+stat('浮动收益率',profit===null?'—':(profit>=0?'+':'')+(profit/cost*100).toFixed(2)+'%',profit===null?'':profit<0?'negative':'positive')+stat('已录入交易盈亏',summary.realized===null?'—':money(summary.realized,currency),summary.realized===null?'':summary.realized<0?'negative':'positive','按已录入交易的移动平均成本计算，缺少买入成本时不估算')+stat('手续费',feeText)+stat('交易记录',summary.count+' 条')+'<div class="asset-stats-divider"></div>'+stat('参考高点',state.drawdown.find(item=>item.symbol===symbol)?.high?money(state.drawdown.find(item=>item.symbol===symbol).high,currency):'—');
        document.querySelectorAll('[data-asset-tab]').forEach(button=>{const active=button.dataset.assetTab===tab;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
        if(tab==='transactions'){el('asset-tab-content').innerHTML=transactionMarkup(rows);bindTransactionTable(el('asset-tab-content'));}
        else if(tab==='history')el('asset-tab-content').innerHTML=book.length?'<table class="price-history-table"><thead><tr><th>日期</th><th>价格</th><th>币种</th><th>来源</th></tr></thead><tbody>'+book.slice().reverse().map(point=>'<tr><td>'+escape(point.date)+'</td><td>'+money(point.price,currency,currency==='CNY'?3:2)+'</td><td>'+currency+'</td><td>'+(point.source==='import'?'导入':'记录')+'</td></tr>').join('')+'</tbody></table>':'<div class="empty-state">暂无价格记录</div>';
        else if(tab==='about')el('asset-tab-content').innerHTML='<div class="asset-info-grid">'+stat('代码',escape(symbol))+stat('币种',currency)+stat('市场',currency==='CNY'?'A 股':'美股')+stat('状态',quantity?'持仓':'自选')+'</div>';
        else el('asset-tab-content').innerHTML='<div class="asset-holding-metrics">'+stat('股数',number(quantity))+stat('平均成本',quantity&&cost?money(cost/quantity,currency,3):'—')+stat('市值',money(value,currency))+stat('浮动盈亏',profit===null?'—':money(profit,currency),profit===null?'':profit<0?'negative':'positive')+stat('占比',isPrivacyMode?'••••':weight.toFixed(2)+'%')+'</div>';
    };
    el('asset-price-import').addEventListener('change',async event=>{
        const file=event.target.files[0];if(!file)return;
        try {
            const rows=TransactionsModel.cells(await file.text()),header=rows.shift(),dateIndex=header?.findIndex(value=>/^(date|日期)$/i.test(value)),priceIndex=header?.findIndex(value=>/^(price|close|价格|收盘价)$/i.test(value));
            if(header?.includes('Fees Amount'))throw new Error('交易 CSV 请在交易页导入');
            if(dateIndex<0||priceIndex<0||dateIndex===undefined)throw new Error('价格 CSV 需要 Date 和 Price 列');
            const points=rows.map((values,index)=>{const d=values[dateIndex],price=Number(values[priceIndex]);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d||!(price>0)||!Number.isFinite(price))throw new Error('第 '+(index+2)+' 行价格无效');return{date:d,price,source:'import'};});
            state.priceHistory||={};const byDate=new Map((state.priceHistory[window.assetRoute]||[]).map(point=>[point.date,point]));points.forEach(point=>byDate.set(point.date,point));state.priceHistory[window.assetRoute]=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));saveData();renderAssetDetail();el('asset-status').textContent='导入 '+points.length+' 条价格';
        }catch(error){el('asset-status').textContent=error.message;}finally{event.target.value='';}
    });
    const originalCalculate=calculate;
    calculate=function(){originalCalculate();recordPrices();saveData();if(!el('panel-asset').hidden)renderAssetDetail();if(!el('panel-transactions').hidden)renderTransactions();};
    const originalApply=applyRemoteState;
    applyRemoteState=function(remote){const merged={...(state.priceHistory||{})};Object.entries(remote.priceHistory||{}).forEach(([key,rows])=>{const dates=new Map((merged[key]||[]).map(point=>[point.date,point]));rows.forEach(point=>dates.set(point.date,point));merged[key]=[...dates.values()];});return originalApply({...remote,priceHistory:merged});};
    window.addEventListener('transactionschange',()=>{if(!el('panel-asset').hidden)renderAssetDetail();});
    const originalOnload=window.onload;
    window.onload=async function(){await originalOnload();recordPrices();saveData();if(!el('panel-asset').hidden)renderAssetDetail();};
})();
