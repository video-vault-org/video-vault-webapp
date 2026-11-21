/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
  transform: {
    '^.+\\.ts?$': 'ts-jest',
    '^.+\\.[cm]?js$': ['esbuild-jest', { target: 'es2020', loaders: { '.mjs': 'js', '.cjs': 'js' } }]
  },
  // These dependencies ship ESM; Jest's CommonJS test runtime needs their module syntax transformed.
  transformIgnorePatterns: ['/node_modules/(?!typebox/|cookie/|content-disposition/|light-my-request/node_modules/cookie/|@fastify/static/node_modules/content-disposition/)'],
  clearMocks: true,
  testMatch: ['**/tests/**/*.spec.ts'],
  moduleNameMapper: {
    '@/(.*)': '<rootDir>/lib/$1',
    '#/(.*)': '<rootDir>/tests/$1'
  },
  modulePathIgnorePatterns: ['<rootDir>/built', '<rootDir>/frontend']
};
