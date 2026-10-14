/* Daily -> monthly -> annual navigation, using only recorded performance and balances. */
(function() {
    const el=id=>document.getElementById(id);
    let level='daily';
    const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value));
    const valueFor=point=>calViewMode===0?point.profit:calViewMode===1?point.rate:point.total;
    const toneFor=value=>value>0?'gain':value<0?'loss':'flat';
    const formatted=value=>!finite(value)?'—':isPrivacyMode?'••••':calViewMode===1?(value>=0?'+':'−')+Math.abs(value).toFixed(2)+'%':calendarMoney(value,calViewMode===0,calViewMode===0?2:0);
    function period(rows) { return PerformanceModel.calendarPeriod(rows); }
    function updateLegend(rows) {
        el('calendar-basis-legend').hidden=!rows.some(row=>PerformanceModel.investmentPoint(row).legacy);
    }
    window.switchView=next=>{
        level=['monthly','yearly'].includes(next)?next:'daily';
        ['daily','monthly','yearly'].forEach(name=>{
            el('tab-'+name).setAttribute('aria-pressed',String(name===level));
            el('view-'+name).classList.toggle('hidden',name!==level);
        });
        renderCalendar();renderYearlySummary();
    };
    window.setCalendarView=mode=>{
        calViewMode=[0,1,2].includes(mode)?mode:0;
        [0,1,2].forEach(i=>el('view-mode-'+i).setAttribute('aria-pressed',String(i===calViewMode)));
        renderCalendar();renderYearlySummary();
    };
    window.jumpToMonth=month=>{displayDate.setDate(1);displayDate.setMonth(month);switchView('daily');};
    window.jumpToYear=year=>{displayDate.setDate(1);displayDate.setFullYear(year);switchView('monthly');};
    window.changeMonth=offset=>{displayDate.setDate(1);displayDate.setMonth(displayDate.getMonth()+offset);renderCalendar();renderYearlySummary();};
    window.changeYear=offset=>{displayDate.setDate(1);displayDate.setFullYear(displayDate.getFullYear()+offset);renderCalendar();renderYearlySummary();};
    window.changeDecade=offset=>{displayDate.setDate(1);displayDate.setFullYear(Math.floor(displayDate.getFullYear()/10)*10+offset*10);renderYearlySummary();};
    function total(id,label,rows,prefix) {
        const summary=period(rows),value=valueFor(summary);
        el(id).dataset.tone=toneFor(value);el(id).textContent=formatted(value);
        el(label).textContent=prefix+(['盈亏','收益率','总资产'][calViewMode]);
    }
    window.renderYearlySummary=()=>{
        const year=displayDate.getFullYear(),rows=state.history.filter(row=>row.date?.startsWith(year+'-'));
        el('cal-year-display').textContent=year+'年';
        const months=Array.from({length:12},(_,index)=>period(rows.filter(row=>Number(row.date.slice(5,7))===index+1)));
        const max=Math.max(1,...months.map(m=>Math.abs(valueFor(m)||0)));
        el('monthly-grid').innerHTML=months.map((point,index)=>{
            const value=valueFor(point);
            return '<button type="button" data-month="'+index+'" data-has-record="'+finite(value)+'" data-level="'+Math.max(1,Math.ceil(Math.abs(value||0)/max*4))+'" data-tone="'+toneFor(point.profit)+'" onclick="jumpToMonth('+index+')" aria-label="查看 '+year+'年'+(index+1)+'月"><span>'+(index+1)+'月</span><span data-monthly-value="'+(value??'')+'">'+formatted(value)+'</span></button>';
        }).join('');
        total('yearly-total','monthly-summary-label',rows,'全年');
        if(level==='monthly')updateLegend(rows);
        renderAnnualSummary();
    };
    window.renderAnnualSummary=()=>{
        const start=Math.floor(displayDate.getFullYear()/10)*10;
        el('cal-decade-display').textContent=start+'—'+(start+9)+'年';
        const points=Array.from({length:10},(_,i)=>({year:start+i,summary:period(state.history.filter(row=>row.date?.startsWith((start+i)+'-')))}));
        const max=Math.max(1,...points.map(p=>Math.abs(valueFor(p.summary)||0)));
        el('annual-grid').innerHTML=points.map(({year,summary})=>{
            const value=valueFor(summary);
            return '<button type="button" data-year="'+year+'" data-has-record="'+finite(value)+'" data-level="'+Math.max(1,Math.ceil(Math.abs(value||0)/max*4))+'" data-tone="'+toneFor(summary.profit)+'" onclick="jumpToYear('+year+')" aria-label="查看 '+year+'年月份"><span>'+year+'年</span><span data-annual-value="'+(value??'')+'">'+formatted(value)+'</span></button>';
        }).join('');
        const rows=state.history.filter(row=>Number(row.date?.slice(0,4))>=start&&Number(row.date?.slice(0,4))<=start+9);
        total('annual-total','annual-summary-label',rows,'区间');
        if(level==='yearly')updateLegend(rows);
    };
    window.renderCalendar=()=>{
        const year=displayDate.getFullYear(),month=displayDate.getMonth(),prefix=year+'-'+String(month+1).padStart(2,'0');
        el('cal-month-display').textContent=year+'年'+(month+1)+'月';
        const byDate=new Map(state.history.map(row=>[row.date,{...PerformanceModel.investmentPoint(row),total:finite(row.total??row.value)?Number(row.total??row.value):null}]));
        const firstDay=new Date(year,month,1).getDay(),days=new Date(year,month+1,0).getDate(),d=new Date();
        const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        let markup=['日','一','二','三','四','五','六'].map(day=>'<div class="calendar-weekday">'+day+'</div>').join('');
        for(let slot=0;slot<42;slot++) {
            const day=slot-firstDay+1;
            if(day<1||day>days){markup+='<div aria-hidden="true"></div>';continue;}
            const date=prefix+'-'+String(day).padStart(2,'0'),point=byDate.get(date);
            const value=point?(calViewMode===0?point.pl:calViewMode===1?point.rate:point.total):null;
            const text=!point?'':!finite(value)?'—':isPrivacyMode?'••••':calViewMode===1?(value>=0?'+':'−')+Math.abs(value).toFixed(1)+'%':calendarMoney(value,calViewMode===0,0);
            const title=!point?'':point.legacy?'旧口径：包含现金和汇率贡献':point.pl===null?'缺少前一天的持仓记录':'投资收益：不含现金及汇率变动';
            markup+='<div data-date="'+date+'" data-has-record="'+finite(value)+'" data-today="'+(date===today)+'" data-level="'+(Math.abs(point?.rate||0)<.25?1:Math.abs(point?.rate||0)<.75?2:Math.abs(point?.rate||0)<1.5?3:4)+'" data-tone="'+toneFor(point?.pl)+'" class="relative flex flex-col items-center justify-center" title="'+title+'"><span class="calendar-day-number">'+day+'</span><span data-calendar-value data-amount="'+(value??'')+'">'+text+'</span></div>';
        }
        el('calendar-grid').innerHTML=markup;
        if(level==='daily')updateLegend(state.history.filter(row=>row.date?.startsWith(prefix)));
    };
})();
