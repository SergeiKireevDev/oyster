import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supportedNodeRange, supportsNode } from '../server/node-version.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('manifest and lockfile match the runtime security policy', () => {
  assert.equal(JSON.parse(read('../package.json')).engines.node, supportedNodeRange);
  assert.equal(JSON.parse(read('../package-lock.json')).packages[''].engines.node, supportedNodeRange);
});
test('each supported LTS line has its own patch floor', () => {
  for (const v of ['22.23.5', '22.24.0', '24.22.3', '26.13.1']) assert.ok(supportsNode(v), v);
  for (const v of ['22.23.4', '23.9.0', '24.22.2', '25.0.0', '26.13.0', '27.0.0', '22.23.5-rc.1']) assert.ok(!supportsNode(v), v);
});
