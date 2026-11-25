import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  base: './',
  test: { include: ['tests/{unit,integration}/**/*.test.ts'] },
  build: {
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'three-core', test: /\/three\/build\/three\.core\.js$/ },
      { name: 'three-webgl', test: /\/three\/build\/three\.module\.js$/ },
      { name: 'math-typesetting', test: /\/katex\/dist\/katex\.mjs$/ },
    ] } } },
  },
});
