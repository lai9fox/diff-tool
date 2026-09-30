export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**', '.astro/**', '.wrangler/**', 'node_modules/**'],
  rules: {
    // CodeMirror owns its camelCase class names; application classes use kebab-case.
    'selector-class-pattern': '^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|cm-[a-zA-Z0-9-]+)$',
  },
  overrides: [
    {
      files: ['src/styles/global.css'],
      // Component rules follow shared element states; selector order reflects the cascade.
      rules: { 'no-descending-specificity': null },
    },
    {
      files: ['**/*.{vue,astro}'],
      customSyntax: 'postcss-html',
    },
  ],
};
