// https://eslint.org/docs/user-guide/configuring
// https://github.com/typescript-eslint/typescript-eslint/blob/a10d6714731561ba475530d81ce9befba6453fb0/docs/getting-started/linting/README.md
// https://github.com/typescript-eslint/typescript-eslint/blob/a10d6714731561ba475530d81ce9befba6453fb0/docs/getting-started/linting/TYPED_LINTING.md
// https://www.npmjs.com/package/eslint-config-airbnb-typescript
// https://www.robertcooper.me/using-eslint-and-prettier-in-a-typescript-project

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [
    '@typescript-eslint',
  ],
  env: {es6: true},
  parserOptions: {
    ecmaVersion: 2020,
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  extends: [
    'airbnb-typescript/base',
    'plugin:node/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
    'prettier/@typescript-eslint',
    'plugin:prettier/recommended',
  ],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
    'no-console': 'off',
    'no-continue': 'off',
    'no-plusplus': 'off',
    'no-process-exit': 'off',
    // 'import/no-named-as-default': 'off'
  },
  settings: {
    // https://github.com/benmosher/eslint-plugin-import/issues/1285#issuecomment-463683667
    'import/parsers': {
      '@typescript-eslint/parser': ['js', 'ts'],
    }
  }
};
