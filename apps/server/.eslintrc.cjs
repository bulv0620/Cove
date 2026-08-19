module.exports = {
  extends: ['@home-ops/eslint-config/base.cjs'],
  env: { node: true },
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  rules: {
    '@typescript-eslint/no-misused-promises': 'off',
  },
};
