import {stat} from 'node:fs/promises';

// Board ownership is durable; it is not a process-lifetime activity signal.
// A fresh local rollout still requires an explicit terminal event. Old or
// non-local board entries cannot represent a turn in this desktop process.
export async function isHostReplyIdle(repository, threadId, hostStartedAt, {statFile = stat} = {}) {
  if (!Number.isFinite(hostStartedAt) || hostStartedAt <= 0) return repository.isConversationIdle(threadId);
  const record = await repository.resolveExactEfficiencyRecord(threadId);
  if (!record) return true;
  const info = await statFile(record.filePath);
  if (info.mtimeMs < hostStartedAt) return true;
  return repository.isConversationIdle(threadId);
}
