#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxBin = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
const cliPath = join(__dirname, 'cli.ts');

try {
  execFileSync(tsxBin, [cliPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
} catch (err) {
  process.exit(err.status || 1);
}
