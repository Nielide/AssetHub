/* Daily -> monthly -> annual navigation, using only recorded performance and balances. */
(function() {
    const el=id=>document.getElementById(id);
    let level='daily', annualAnchor=new Date().getFullYear();
    const resetGestures=[];
    const finite=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value));
    const valueFor=point=>calViewMode===0?point.profit:calViewMode===1?point.rate:point.total;
    const toneFor=value=>value>0?'gain':value<0?'loss':'flat';
    const formatted=value=>!finite(value)?'—':isPrivacyMode?'••••':calViewMode===1?(value>=0?'+':'−')+Math.abs(value).toFixed(2)+'%':calendarMoney(value,calViewMode===0,calViewMode===0?2:0);
    function period(rows) { return PerformanceModel.calendarPeriod(rows); }

    window.switchView=next=>{
        resetGestures.forEach(reset=>reset());
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
    window.changeCalendarPeriod=offset=>{
        if(level==='yearly'){annualAnchor+=offset*12;renderAnnualSummary();}
        else if(level==='monthly')changeYear(offset);
        else changeMonth(offset);
    };

    window.renderYearlySummary=()=>{
        const year=displayDate.getFullYear(),rows=state.history.filter(row=>row.date?.startsWith(year+'-'));
        el('cal-year-display').textContent=year+'年';
        const months=Array.from({length:12},(_,index)=>period(rows.filter(row=>Number(row.date.slice(5,7))===index+1)));
        const max=Math.max(1,...months.map(m=>Math.abs(valueFor(m)||0)));
        el('monthly-grid').innerHTML=months.map((point,index)=>{
            const value=valueFor(point);
            return '<button type="button" data-month="'+index+'" data-has-record="'+finite(value)+'" data-level="'+Math.max(1,Math.ceil(Math.abs(value||0)/max*4))+'" data-tone="'+toneFor(point.profit)+'" onclick="jumpToMonth('+index+')" aria-label="查看 '+year+'年'+(index+1)+'月"><span>'+(index+1)+'月</span><span data-monthly-value="'+(value??'')+'">'+formatted(value)+'</span></button>';
        }).join('');
        renderAnnualSummary();
    };
    window.renderAnnualSummary=()=>{
        el('cal-annual-display').textContent=annualAnchor+'年';
        const points=Array.from({length:12},(_,i)=>({year:annualAnchor-i,summary:period(state.history.filter(row=>row.date?.startsWith((annualAnchor-i)+'-')))}));
        const max=Math.max(1,...points.map(p=>Math.abs(valueFor(p.summary)||0)));
        el('annual-grid').innerHTML=points.map(({year,summary})=>{
            const value=valueFor(summary);
            return '<button type="button" data-year="'+year+'" data-has-record="'+finite(value)+'" data-level="'+Math.max(1,Math.ceil(Math.abs(value||0)/max*4))+'" data-tone="'+toneFor(summary.profit)+'" onclick="jumpToYear('+year+')" aria-label="查看 '+year+'年月份"><span>'+year+'年</span><span data-annual-value="'+(value??'')+'">'+formatted(value)+'</span></button>';
        }).join('');

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
    };
    // Capture only after horizontal intent is clear, so taps and vertical scroll survive.
    ['calendar-grid','monthly-grid','annual-grid'].forEach(id=>{
        const grid=el(id);
        let pointer=null,suppressUntil=0,motion=null;
        const reset=()=>{
            const id=pointer?.id;pointer=null;
            if(id!==undefined&&grid.hasPointerCapture(id))grid.releasePointerCapture(id);
            grid.style.transform='';grid.classList.remove('is-swiping');motion?.cancel();motion=null;
        };
        resetGestures.push(reset);
        grid.addEventListener('pointerdown',event=>{
            if(!event.isPrimary||event.button!==0)return;
            reset();suppressUntil=0;
            pointer={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dragging:false};
        });
        grid.addEventListener('pointermove',event=>{
            if(!pointer||pointer.id!==event.pointerId)return;
            const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
            if(!pointer.dragging&&Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)){reset();return;}
            if(!pointer.dragging&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.3){
                pointer.dragging=true;grid.setPointerCapture(event.pointerId);grid.classList.add('is-swiping');
            }
            if(pointer.dragging){
                pointer.dx=dx;grid.style.transform='translateX('+Math.max(-100,Math.min(100,dx*.45))+'px)';
                event.preventDefault();
            }
        });
        grid.addEventListener('pointerup',event=>{
            if(!pointer||pointer.id!==event.pointerId)return;
            const dx=pointer.dx,dragging=pointer.dragging;
            reset();
            if(!dragging)return;
            suppressUntil=performance.now()+400;
            if(Math.abs(dx)<60)return;
            const direction=dx<0?1:-1;
            changeCalendarPeriod(direction);
            if(!matchMedia('(prefers-reduced-motion: reduce)').matches)
                motion=grid.animate([{transform:'translateX('+(direction*70)+'px)',opacity:.45},{transform:'translateX(0)',opacity:1}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});
        });
        grid.addEventListener('pointercancel',reset);
        grid.addEventListener('lostpointercapture',event=>{if(event.target===grid&&pointer)reset();});
        grid.addEventListener('click',event=>{
            if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}
        },true);
        grid.addEventListener('keydown',event=>{
            if(event.target!==grid||!['ArrowLeft','ArrowRight'].includes(event.key))return;
            event.preventDefault();reset();changeCalendarPeriod(event.key==='ArrowLeft'?-1:1);
        });
    });

})();
