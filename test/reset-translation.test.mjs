import test from 'node:test';
import assert from 'node:assert/strict';
import { translateResetHistory } from '../lib/reset-translation.mjs';
import { classifyResetPost, extractResetTime } from '../lib/reset-classifier.mjs';
test('landing tomorrow uses publication day in the explicit timezone, including UTC date boundary', () => {
  const publishedAt = '2026-10-02T02:14:00Z';
  const text = 'Global reset landing tomorrow 10am PST for all paid ChatGPT accounts.';
  const event = classifyResetPost({ text, publishedAt, sourceUrl: 'https://x.com/thsottiaux/status/2100000000000000001' }, [], Date.parse('2026-10-02T15:00:00Z'));
  assert.equal(event.status, 'scheduled');
  assert.equal(event.targetAt, '2026-10-02T18:00:00.000Z');
  assert.equal(event.scope, '所有付费 ChatGPT 账户');
  assert.equal(extractResetTime('tomorrow 10am PDT', publishedAt).targetAt, '2026-10-02T17:00:00.000Z');
  assert.equal(extractResetTime('tomorrow 25am PST', publishedAt), null);
  assert.equal(classifyResetPost({ text: 'Maybe global reset landing tomorrow 10am PST for ChatGPT.', publishedAt, sourceUrl: event.sourceUrl }), null);
});
test('translation preserves English, caches Chinese, and retries failures', async () => {
  const records = [{ id:'1', text:'Reset is coming.', evidence:'Reset is coming.' }];
  let calls=0;
  const fetchImpl=async()=>{ calls++; return {ok:true,json:async()=>[[['即将重置。']]]}; };
  const translated=await translateResetHistory(records,{fetchImpl});
  assert.equal(translated[0].summary,'即将重置。');
  assert.equal(translated[0].evidence,'Reset is coming.');
  await translateResetHistory(translated,{fetchImpl}); assert.equal(calls,1);
  const failed=await translateResetHistory(records,{fetchImpl:async()=>{throw Error('offline');}});
  assert.deepEqual(failed,records);
  assert.equal((await translateResetHistory(failed,{fetchImpl}))[0].summary,'即将重置。');
});
