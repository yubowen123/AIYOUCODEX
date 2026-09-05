import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PreviewRepository } from '../lib/preview-data.mjs';

test('history cache evicts inactive threads without truncating messages or reordering LRU', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'aiyou-history-cache-'));
  try {
    const sessions = path.join(codexHome, 'sessions');
    await mkdir(sessions);
    const ids = ['01a03475-e06a-7813-a3c9-c9080f3556f1', '01a03475-e06a-7813-a3c9-c9080f3556f2', '01a03475-e06a-7813-a3c9-c9080f3556f3'];
    for (const id of ids) {
      await writeFile(path.join(sessions, `rollout-${id}.jsonl`), JSON.stringify({type:'response_item', payload:{type:'message',role:'user',id:'m',content:[{type:'input_text',text:`message-${id}`}]}})+'\n');
    }
    const repository = new PreviewRepository({codexHome, maxHistoryEntries:2});
    await repository.readConversationHistory(ids[0]);
    await repository.readConversationHistory(ids[1]);
    await repository.readConversationHistory(ids[0]);
    await repository.readConversationHistory(ids[2]);
    assert.deepEqual([...repository.conversationHistoryCache.keys()], [ids[0], ids[2]]);
    const restored = await repository.readConversationHistory(ids[1]);
    assert.equal(restored.messages[0].text, `message-${ids[1]}`);
    assert.equal(restored.totalCount, 1);
    assert.deepEqual([...repository.conversationHistoryCache.keys()], [ids[2], ids[1]]);
    repository.maxHistorySourceBytes = 1;
    await repository.readConversationHistory(ids[0]);
    assert.deepEqual([...repository.conversationHistoryCache.keys()], [ids[0]]);
  } finally { await rm(codexHome, {recursive:true, force:true}); }
});
