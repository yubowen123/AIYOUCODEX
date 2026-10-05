/** Translate public RSS text only; never send account or conversation data. */
export async function translateResetText(value, { fetchImpl = fetch } = {}) {
  const source = String(value || '').slice(0, 600);
  if (!source || !/[a-z]{3}/i.test(source) || /[\u3400-\u9fff]/u.test(source)) return source;
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  for (const [key, value] of Object.entries({ client: 'gtx', sl: 'auto', tl: 'zh-CN', dt: 't', q: source })) url.searchParams.set(key, value);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Translation HTTP ${response.status}`);
  const result = await response.json();
  const translated = result?.[0]?.map(part => part?.[0] || '').join('');
  if (!translated || !/[\u3400-\u9fff]/u.test(translated)) throw new Error('Translation returned no Chinese text');
  return translated.slice(0, 600);
}

export async function translateResetHistory(records, options = {}) {
  const result = [];
  for (const record of records) {
    const source = record.text || record.translationSource || record.evidence || record.summary;
    if (record.translationSource === source && record.evidenceTranslation) { result.push(record); continue; }
    try {
      const translated = await translateResetText(source, options);
      result.push({ ...record, summary: translated.slice(0, 240), evidenceTranslation: translated, translationSource: source });
    } catch { result.push(record); } // Keep evidence; an untranslated record is retried next tick.
  }
  return result;
}
