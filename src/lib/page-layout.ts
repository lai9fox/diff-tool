import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { drawerScrollbars, pageScrollbars } from './scrolling';

export function usePageLayout(sidebar: Ref<HTMLDialogElement | undefined>) {
  let observer: ResizeObserver | undefined;
  let page: ReturnType<typeof pageScrollbars> | undefined;
  let drawer: ReturnType<typeof drawerScrollbars> | undefined;
  let media: MediaQueryList | undefined;

  const measure = () => {
    if (!sidebar.value || media?.matches) {
      document.documentElement.removeAttribute('data-sidebar-overflow');
      return;
    }
    // Measure the actual content, including statistics, translations and zoom.
    const gap = Number.parseFloat(getComputedStyle(sidebar.value.parentElement!).paddingTop);
    document.documentElement.toggleAttribute(
      'data-sidebar-overflow',
      sidebar.value.getBoundingClientRect().height + gap * 2 > window.innerHeight + 1,
    );
  };

  const syncDrawer = () => {
    drawer?.destroy();
    drawer = media?.matches && sidebar.value ? drawerScrollbars(sidebar.value) : undefined;
    measure();
  };

  onMounted(() => {
    page = pageScrollbars();
    media = window.matchMedia('(max-width: 820px)');
    media.addEventListener('change', syncDrawer);
    observer = new ResizeObserver(measure);
    if (sidebar.value) observer.observe(sidebar.value);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    syncDrawer();
  });

  onBeforeUnmount(() => {
    observer?.disconnect();
    media?.removeEventListener('change', syncDrawer);
    window.removeEventListener('resize', measure);
    window.visualViewport?.removeEventListener('resize', measure);
    drawer?.destroy();
    page?.destroy();
    document.documentElement.removeAttribute('data-sidebar-overflow');
    document.documentElement.removeAttribute('data-sidebar-open');
  });
}
