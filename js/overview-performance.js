(function() {
    const el=id=>document.getElementById(id), plots={};
    const ranges=[30,90,180,365,1095,1825,3650,0];
    const currency={USD:'$',CNY:'¥'};
    function text(value,unit,decimals=0) {
        if (!Number.isFinite(value)) return '—';
        if (isPrivacyMode) return '••••';
        return (value<0?'−':'+')+(currency[unit]||'')+Math.abs(value).toFixed(decimals)+(unit==='%'?'%':'');
    }
    function metric(id,value,unit,decimals=0) {
        const node=el(id);if(!node)return;
        if(node.animationId)cancelAnimationFrame(node.animationId);
        const previous=Number(node.dataset.displayValue||0);
        const valid=Number.isFinite(value);
        node.classList.toggle('positive',valid&&value>=0);node.classList.toggle('negative',valid&&value<0);
        node.style.color=!valid?'var(--text-secondary)':value<0?'var(--negative)':'var(--positive)';
        node.style.backgroundColor='transparent';
        node.dataset.value=Number.isFinite(value)?value:'';
        if (!Number.isFinite(value)||isPrivacyMode) {node.textContent=!Number.isFinite(value)&&unit==='%'?'':text(value,unit,decimals);node.animationId=null;return;}
        if(matchMedia('(prefers-reduced-motion: reduce)').matches){node.textContent=text(value,unit,decimals);node.dataset.displayValue=value;return;}
        let start;
        const tick=now=>{if(isPrivacyMode){node.textContent='••••';return;}start??=now;const progress=Math.min((now-start)/450,1);const current=previous+(value-previous)*(1-Math.pow(1-progress,3));node.dataset.displayValue=current;node.textContent=text(current,unit,decimals);node.animationId=progress<1?requestAnimationFrame(tick):null;};
        node.animationId=requestAnimationFrame(tick);
    }
    window.renderOverviewPerformance=function() {
        const summary=PerformanceModel.summary(state,nwRangeDays);
        metric('us-pl-value',summary.usd.profit,'USD');metric('us-pl-pct',summary.usd.rate,'%',2);
        metric('cn-pl-value',summary.cn.profit,'CNY');metric('cn-pl-pct',summary.cn.rate,'%',2);
        metric('total-unrealized-pl-val',summary.total.profit,'CNY');metric('total-unrealized-pl-pct',summary.total.rate,'%',2);
        document.querySelectorAll('[data-market-range]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.marketRange)===nwRangeDays)));
        const values=[...summary.usd.points,...summary.cn.points].map(point=>point.value);
        const low=Math.min(0,...values),high=Math.max(0,...values),padding=Math.max(.5,(high-low)*.12);
        ['usd','cn'].forEach(type=>{
            const data=summary[type],canvas=el('chart-market-'+type),empty=data.points.length<2 || data.rate===null;
            canvas.hidden=empty;canvas.closest('.market-chart-panel').classList.toggle('is-empty',empty);
            el('market-empty-'+type).textContent=empty?(data.points.length?'区间记录不足':'暂无分市场历史'):'';
            el('market-record-'+type).textContent=data.partial&&data.start?'记录始于 '+data.start:'';
            el('market-return-'+type).textContent=text(data.rate,'%',2);
            el('market-profit-'+type).textContent=Number.isFinite(data.profit)?text(data.profit,type==='usd'?'USD':'CNY'):'';
            if(empty){plots[type]?.destroy();delete plots[type];return;}
            const dark=document.documentElement.classList.contains('dark');
            const color=type==='usd'?(dark?'#c3d296':'#879d35'):(dark?'#a6c8d4':'#417b92');
            const labels=data.points.map(point=>point.date),series=data.points.map(point=>point.value);
            const options={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},animation:{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300},plugins:{legend:{display:false},tooltip:{enabled:!isPrivacyMode,displayColors:false,backgroundColor:dark?'#e7ecd5':'#363d28',titleColor:dark?'#303429':'#e7ecd5',bodyColor:dark?'#303429':'#fff',padding:12,callbacks:{label:context=>text(context.raw,'%',2)}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:5,maxRotation:0,color:dark?'#b4bca3':'#656957',font:{size:11},callback:function(value){const date=this.getLabelForValue(value);return nwRangeDays>=365||nwRangeDays===0?date.slice(0,7):date.slice(5);}}},y:{min:low-padding,max:high+padding,position:'right',border:{display:false},grid:{color:dark?'#414b3340':'#dfe2ce80'},ticks:{maxTicksLimit:4,color:dark?'#b4bca3':'#656957',font:{size:11},callback:value=>isPrivacyMode?'••••':value.toFixed(1)+'%'}}}};
            const dataset={data:series,borderColor:color,borderWidth:1.8,pointRadius:0,pointHoverRadius:4,tension:.3,fill:true,backgroundColor:context=>{const {ctx,chartArea}=context.chart;if(!chartArea)return'transparent';const gradient=ctx.createLinearGradient(0,chartArea.top,0,chartArea.bottom);gradient.addColorStop(0,type==='usd'?'rgba(135,157,53,.22)':'rgba(65,123,146,.17)');gradient.addColorStop(1,'transparent');return gradient;}};
            if(plots[type]){plots[type].data={labels,datasets:[dataset]};plots[type].options=options;plots[type].update();}
            else plots[type]=new Chart(canvas.getContext('2d'),{type:'line',data:{labels,datasets:[dataset]},options});
        });
        window.overviewPerformanceCharts=plots;
    };
    window.setMarketRange=days=>setNwRange(ranges.includes(Number(days))?Number(days):0);
    const originalRange=setNwRange;setNwRange=function(days){originalRange(days);renderOverviewPerformance();};
    const originalCalculate=calculate;calculate=function(){originalCalculate();renderOverviewPerformance();};
    const originalApply=applyRemoteState;
    applyRemoteState=function(remote){return originalApply({...remote,history:PerformanceModel.mergeRecords(state.history,remote.history)});};
})();
