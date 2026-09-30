import eslintConfig from '@lai9fox/eslint-config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default eslintConfig({
  typescript: true,
  vue: true,
  ignores: ['.astro/**', '.wrangler/**'],
  overrides: [
    ...astro.configs['flat/recommended'],
    {
      files: ['src/**/*.{ts,vue,astro}', 'src/**/*.astro/*.js'],
      languageOptions: { globals: globals.browser },
    },
    {
      files: ['*.{js,mjs}', 'tests/**/*.mjs'],
      languageOptions: { globals: globals.node },
    },
  ],
});
