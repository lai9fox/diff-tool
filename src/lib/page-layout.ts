import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { drawerScrollbars, pageScrollbars } from './scrolling';

export function usePageLayout(
  sidebar: Ref<HTMLDialogElement | undefined>,
  headerAnchor: Ref<HTMLElement | undefined>,
) {
  let observer: IntersectionObserver | undefined;
  let sidebarObserver: ResizeObserver | undefined;
  let scrollbarFrame = 0;
  let page: ReturnType<typeof pageScrollbars> | undefined;
  let drawer: ReturnType<typeof drawerScrollbars> | undefined;

  onMounted(() => {
    page = pageScrollbars();
    if (sidebar.value) drawer = drawerScrollbars(sidebar.value);
    sidebarObserver = new ResizeObserver(() => {
      const target = sidebar.value;
      const contentEnd = target?.querySelector('.preferences');
      if (!target || !contentEnd) return;
      // The scrollbar is inside its own viewport. Its translated track can
      // retain stale overflow after a resize, so measure real content instead.
      const bottom = contentEnd.getBoundingClientRect().bottom
        - target.getBoundingClientRect().top + target.scrollTop;
      const padding = Number.parseFloat(getComputedStyle(target).paddingBottom);
      const maxScroll = Math.max(0, bottom + padding - target.clientHeight);
      if (target.scrollTop > maxScroll) target.scrollTop = maxScroll;
      // Let the scroll event reposition the track before measuring overflow.
      cancelAnimationFrame(scrollbarFrame);
      scrollbarFrame = requestAnimationFrame(() => drawer?.update(true));
    });
    if (sidebar.value) sidebarObserver.observe(sidebar.value);
    // Track the header's natural position, which also accounts for notices above it.
    observer = new IntersectionObserver(([entry]) => {
      entry.target.parentElement?.toggleAttribute('data-header-stuck', entry.boundingClientRect.top <= 0);
    }, { rootMargin: '-1px 0px 0px 0px' });
    if (headerAnchor.value) observer.observe(headerAnchor.value);
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    sidebarObserver?.disconnect();
    cancelAnimationFrame(scrollbarFrame);
    drawer?.destroy();
    page?.destroy();
    document.documentElement.removeAttribute('data-sidebar-open');
  });
}
