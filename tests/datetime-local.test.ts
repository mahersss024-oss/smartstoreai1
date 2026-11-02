import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { toLocalDateTimeInput } from '@/lib/datetime-local';

test('site-message expiry round-trips unchanged in Riyadh, UTC and daylight-saving zones', () => {
  for (const zone of ['Asia/Riyadh', 'UTC', 'America/New_York']) {
    const script = `const {toLocalDateTimeInput}=require('./lib/datetime-local.ts');
      const results=['2026-11-05T12:00:00.000Z','2026-06-05T12:00:00.000Z'].map(value=>{
        const input=toLocalDateTimeInput(value); return {value,input,saved:new Date(input).toISOString()};
      });console.log(JSON.stringify(results));`;
    const process = spawnSync(globalThis.process.execPath, ['--import', 'tsx', '-e', script], {
      env: { ...globalThis.process.env, TZ: zone }, encoding: 'utf8',
    });
    assert.equal(process.status, 0, process.stderr);
    const results = JSON.parse(process.stdout) as Array<{ value: string; input: string; saved: string }>;
    for (const result of results) assert.equal(result.saved, result.value, zone);
    if (zone === 'Asia/Riyadh') assert.equal(results[0].input, '2026-11-05T15:00');
  }
});

test('an empty or invalid expiry remains empty', () => {
  for (const value of [undefined, null, '', 'invalid']) assert.equal(toLocalDateTimeInput(value), '');
});
