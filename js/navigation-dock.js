(function() {
    const dock = document.querySelector('.workspace-nav');
    if (!dock) return;
    const links = [...dock.querySelectorAll('a')];
    let frame;
    function update() {
        const active = dock.querySelector('[aria-current="page"]');
        if (!active) return;
        dock.style.setProperty('--nav-active-x', active.offsetLeft + 'px');
        dock.style.setProperty('--nav-active-width', active.offsetWidth + 'px');
        if (!dock.dataset.ready) requestAnimationFrame(() => { dock.dataset.ready = 'true'; });
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); }
    new MutationObserver(schedule).observe(dock, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    new ResizeObserver(schedule).observe(dock);
    dock.addEventListener('keydown', event => {
        const index = links.indexOf(document.activeElement);
        if (index < 0) return;
        const target = event.key === 'ArrowRight' ? (index + 1) % links.length : event.key === 'ArrowLeft' ? (index + links.length - 1) % links.length : event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1 : null;
        if (target === null) return;
        event.preventDefault(); links[target].focus();
    });
    schedule();
})();
