// Only explicit requests to reply with numbered options become quick replies.
export function claudeReplyChoices(text) {
  const plain = String(text || "").replace(/```[\s\S]*?```/gu, "");
  const cue = plain.match(/(?:回复|回答|选择|请选择|reply|choose|select)[^\n]{0,70}?1\s*[,，、/或or\s]+\s*2[^\n]{0,70}$/imu);
  if (!cue) return [];
  const lines = plain.slice(0, cue.index).split("\n");
  const groups = []; let current = [];
  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,2})[.、)）]\s+(.+)$/u);
    if (!match) continue;
    const number = Number(match[1]);
    if (number === 1) { if (current.length) groups.push(current); current = []; }
    if (number !== current.length + 1 || number > 8) { current = []; continue; }
    const heading = match[2].match(/^\*\*(.+?)\*\*/) || match[2].match(/^(.{1,80}?)[：:]/u);
    const label = (heading?.[1] || match[2]).replace(/[*`_]/gu, "").trim().slice(0, 100);
    current.push({ value: String(number), label });
  }
  if (current.length) groups.push(current);
  return groups.at(-1)?.length >= 2 ? groups.at(-1) : [];
}

export function claudeQuestions(input) {
  const questions = input?.questions;
  if (!Array.isArray(questions) || !questions.length || questions.length > 4) throw Error("无效选择题。");
  return questions.map((q, index) => {
    if (typeof q.question !== "string" || !q.question.trim() || q.question.length > 4000
      || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 12
      || q.options.some(o => typeof o.label !== "string" || !o.label.trim() || o.label.length > 500)
      || new Set(q.options.map(o => o.label)).size !== q.options.length) throw Error("无效选择题。");
    return { id: String(index), question: q.question, header: String(q.header || ""), multiSelect: q.multiSelect === true,
      options: q.options.map((o, i) => ({ id: String(i), label: o.label, description: String(o.description || "").slice(0, 4000) })) };
  });
}

export function claudeQuestionAnswers(input, values) {
  const questions = claudeQuestions(input);
  if (!Array.isArray(values) || values.length !== questions.length) throw Error("请回答全部问题。");
  return Object.fromEntries(questions.map((q, index) => {
    const value = values[index];
    if (!value || !Array.isArray(value.selected) || value.selected.some(id => !q.options.some(o => o.id === id))
      || new Set(value.selected).size !== value.selected.length) throw Error("选择已失效，请重新选择。");
    const custom = typeof value.custom === "string" ? value.custom.trim() : "";
    if (custom.length > 4000) throw Error("自填内容最多 4000 字。");
    const answers = value.selected.map(id => q.options.find(o => o.id === id).label);
    if (custom) answers.push(custom);
    if (!answers.length || (!q.multiSelect && answers.length !== 1)) throw Error("请按单选或多选要求作答。");
    return [input.questions[index].question, q.multiSelect ? answers : answers[0]];
  }));
}
