import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: {
      prettier: prettierPlugin
    },
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite, prettierConfig],
    rules: {
      'prettier/prettier': [
        'error',
        {
          semi: true,
          trailingComma: 'none',
          singleQuote: true,
          printWidth: 150,
          tabWidth: 2
        }
      ]
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser
    }
  }
]);
