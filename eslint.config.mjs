import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  { files: ['src/**/*.ts'], extends: [js.configs.recommended, ...ts.configs.recommended],
    rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['test/**/*.mjs', 'scripts/**/*.mjs'], rules: { 'no-unreachable': 'error', 'no-constant-condition': 'error' } },
);
