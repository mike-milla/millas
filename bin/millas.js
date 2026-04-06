#!/usr/bin/env node

'use strict';

const { program, bootstrap } = require('../src/cli');

// Bootstrap async then parse
(async () => {
  try {
    await bootstrap();
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
