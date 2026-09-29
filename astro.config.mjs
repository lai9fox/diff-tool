import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  site: 'https://difftool.fox9.dev',
  integrations: [vue()],
  devToolbar: { enabled: false },
  server: {
    port: 13356
  }
});
