import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

export default defineConfig({
  integrations: [vue()],
  devToolbar: { enabled: false },
  server: {
    port: 13356
  }
});
