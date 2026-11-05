(function() {
    const dock = document.querySelector('.workspace-nav'), home = document.querySelector('.navigation-home'), header = document.querySelector('.workspace-header');
    if (!dock || !home || !header) return;
    const links = [...dock.querySelectorAll('a')];
    let frame, floating = null;
    function update() {
        const bounds = header.getBoundingClientRect();
        const mobile = matchMedia('(max-width: 980px)').matches;
        const next = mobile || (floating ? bounds.bottom < 20 : bounds.bottom < -8);
        if (next !== floating) {
            floating = next; dock.classList.toggle('is-floating', floating);
            if (dock.dataset.ready && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
                dock.getAnimations().forEach(animation => animation.cancel());
                dock.animate([{opacity:.5},{opacity:1}], {duration:220,easing:'ease-out'});
            }
        }
        if (!floating) home.style.setProperty('--navigation-width', dock.offsetWidth + 'px');
        const active = dock.querySelector('[aria-current="page"]');
        if (!active) return;
        if (dock.scrollWidth > dock.clientWidth && (active.offsetLeft < dock.scrollLeft || active.offsetLeft + active.offsetWidth > dock.scrollLeft + dock.clientWidth)) dock.scrollLeft = active.offsetLeft - (dock.clientWidth - active.offsetWidth) / 2;
        dock.style.setProperty('--nav-active-x', active.offsetLeft + 'px');
        dock.style.setProperty('--nav-active-width', active.offsetWidth + 'px');
        if (!dock.dataset.ready) requestAnimationFrame(() => { dock.dataset.ready = 'true'; });
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
    new MutationObserver(schedule).observe(dock, { subtree:true, attributes:true, attributeFilter:['aria-current'] });
    new ResizeObserver(schedule).observe(dock);
    window.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('resize', schedule, {passive:true});
    dock.addEventListener('keydown', event => {
        const index = links.indexOf(document.activeElement);
        if (index < 0) return;
        const target = event.key === 'ArrowRight' ? (index + 1) % links.length : event.key === 'ArrowLeft' ? (index + links.length - 1) % links.length : event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : null;
        if (target === null) return;
        event.preventDefault(); links[target].focus();
    });
    schedule();
})();
