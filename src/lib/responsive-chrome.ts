import { onBeforeUnmount, onMounted, onUpdated, type Ref } from 'vue';

type Density = 'full' | 'snug' | 'compact';

/** Measure expanded controls independently of their current visible density. */
export function useResponsiveChrome(root: Ref<HTMLElement | undefined>) {
  let observer: ResizeObserver | undefined;
  let frame = 0;
  const observed = new Set<HTMLElement>();

  function measure(region: HTMLElement, density: Density) {
    const probe = region.cloneNode(true) as HTMLElement;
    probe.classList.add('chrome-measure');
    probe.dataset.density = density;
    probe.setAttribute('aria-hidden', 'true');
    probe.inert = true;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }

  function update() {
    frame = 0;
    if (!root.value) return;
    const regions = new Set(root.value.querySelectorAll<HTMLElement>('.toolbar, .pane-heading'));
    for (const region of observed) {
      if (!regions.has(region)) {
        observer?.unobserve(region);
        observed.delete(region);
      }
    }
    for (const region of regions) {
      if (!observed.has(region)) {
        observer?.observe(region);
        observed.add(region);
      }
      const available = region.getBoundingClientRect().width;
      const previous = region.dataset.density || 'full';
      // A small recovery margin avoids flickering at the fit boundary.
      const full = measure(region, 'full') + (previous !== 'full' ? 16 : 0);
      const snug = measure(region, 'snug') + (previous === 'compact' ? 16 : 0);
      region.dataset.density = available >= full ? 'full' : available >= snug ? 'snug' : 'compact';
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  onMounted(() => {
    observer = new ResizeObserver(schedule);
    if (root.value) observer.observe(root.value);
    document.fonts.addEventListener('loadingdone', schedule);
    schedule();
  });
  // Includes locale, status, undo-clear, line counts and newly mounted headers.
  onUpdated(schedule);
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
    document.fonts.removeEventListener('loadingdone', schedule);
  });
}
