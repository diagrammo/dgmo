'use strict';

// In-tree ESLint plugin for dgmo. Rules live in ./rules and are
// re-exported under short names so the eslint config can refer to
// them as `name-normalize/<rule>`.

module.exports = {
  rules: {
    'required-at-insertion': require('./rules/name-normalize-required-at-insertion'),
  },
};
