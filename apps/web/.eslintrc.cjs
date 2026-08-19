module.exports = {
  extends: ['@home-ops/eslint-config/base.cjs', 'plugin:react-hooks/recommended'],
  env: { browser: true },
  parserOptions: {
    project: ['./tsconfig.app.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
};
