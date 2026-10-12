// Reuse the existing disposable runner unchanged; only narrow its Jest selection.
const childProcess = require('node:child_process');
const original = childProcess.spawnSync;
const jestPath = require.resolve('jest/bin/jest');
const pattern = process.argv[2];
childProcess.spawnSync = (command, args, options) => {
  if (command === process.execPath && args?.[0] === jestPath) {
    args = [...args, '--runTestsByPath', 'test/appointments.e2e-spec.ts',
      ...(pattern ? ['--testNamePattern', pattern] : [])];
  }
  return original(command, args, options);
};
process.argv.push('--e2e');
require('./run-payment-integration.cjs');
