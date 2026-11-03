'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const MODULE_ID = 'memory';
const MAX_MEMORIES = 2000, MAX_EVENT_RECEIPTS = 10000, MAX_OPERATION_RECEIPTS = 2000;
const MAX_FILE_BYTES = 24 * 1024 * 1024, MAX_RESULT_BYTES = 30 * 1024;
const WRITE_TOOLS = ['memory.save', 'memory.confirm', 'memory.delete'];
const SAVE_FIELDS = ['id', 'expectedRevision', 'title', 'text', 'scope', 'sourceTitle', 'sourceUri', 'expiresAt'];
const RECORD_FIELDS = ['id', 'title', 'text', 'scope', 'status', 'source', 'origin', 'revision', 'createdAt', 'updatedAt', 'expiresAt', 'observation'];
const fold = value => value.normalize('NFKC').toLocaleLowerCase('de-DE');
const clone = value => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
class MemoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fail(code, message) { throw new MemoryError(code, message); }
function checkSignal(signal) { signal?.throwIfAborted(); }
function object(value, allowed, label = 'Die Parameter') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENTS', `${label} sind ungültig.`);
}
function argsObject(value, allowed) {
  object(value, allowed);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 16000) fail('ARGUMENTS_TOO_LARGE', 'Die Anfrage überschreitet die Größenbegrenzung.');
}
function integer(value, fallback, min, max) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_ARGUMENTS', 'Eine Position, Seitengröße oder Versionsnummer ist ungültig.');
  return value;
}
function resourceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) fail('INVALID_ID', 'Die Erinnerungs-ID ist ungültig.');
  return value;
}
function text(value, label, max, multiline = false, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) || (typeof value.isWellFormed === 'function' && !value.isWellFormed())) fail('INVALID_ARGUMENTS', `${label} ist ungültig oder zu lang (maximal ${max} Zeichen).`);
  return value.trim();
}
function cut(value, max) {
  let end = Math.min(value.length, max);
  if (end < value.length && /[\ud800-\udbff]/.test(value[end - 1]) && /[\udc00-\udfff]/.test(value[end])) end--;
  return value.slice(0, end);
}
function timestamp(value, empty = false) {
  if (empty && value === '') return '';
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail('INVALID_ARGUMENTS', 'Das Datum muss ein gültiger ISO-Zeitpunkt mit Zeitzone sein.');
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) fail('INVALID_ARGUMENTS', 'Das Datum enthält einen ungültigen Kalendertag oder eine ungültige Uhrzeit.');
  return new Date(value).toISOString();
}
function url(value) {
  const result = text(value, 'Die Quellenadresse', 1000, false, true);
  if (!result) return '';
  let parsed;
  try { parsed = new URL(result); } catch { fail('INVALID_ARGUMENTS', 'Die Quellenadresse ist ungültig.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('INVALID_ARGUMENTS', 'Quellenadressen benötigen HTTP(S) ohne Zugangsdaten.');
  return result;
}
function saveArguments(args) {
  argsObject(args, SAVE_FIELDS);
  const values = {
    ...(args.id !== undefined ? { id: resourceId(args.id) } : {}),
    ...(args.expectedRevision !== undefined ? { expectedRevision: integer(args.expectedRevision, undefined, 1, Number.MAX_SAFE_INTEGER - 1) } : {}),
    title: text(args.title, 'Der Titel', 120), text: text(args.text, 'Die Erinnerung', 2000, true),
    ...(args.scope !== undefined ? { scope: text(args.scope, 'Der Geltungsbereich', 120, false, true) } : {}),
    ...(args.sourceTitle !== undefined ? { sourceTitle: text(args.sourceTitle, 'Die Quelle', 300) } : {}),
    ...(args.sourceUri !== undefined ? { sourceUri: url(args.sourceUri) } : {}),
    ...(args.expiresAt !== undefined ? { expiresAt: timestamp(args.expiresAt, true) } : {})
  };
  if (values.expectedRevision !== undefined && !values.id) fail('INVALID_ARGUMENTS', 'Eine Versionsprüfung benötigt die ID einer vorhandenen Erinnerung.');
  return values;
}
function revisionArguments(args) {
  argsObject(args, ['id', 'expectedRevision']);
  return { id: resourceId(args.id), expectedRevision: integer(args.expectedRevision, undefined, 1, Number.MAX_SAFE_INTEGER - 1) };
}
function safeResult(result) {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) fail('RESULT_TOO_LARGE', 'Das Ergebnis ist zu groß. Bitte eine kleinere Seite abrufen.');
  return result;
}
function validateOperation(operation) {
  if (operation === undefined) return;
  object(operation, ['runId', 'actionId', 'attemptId', 'argsHash']);
  if (!['runId', 'actionId', 'attemptId'].every(key => typeof operation[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(operation[key])) || !/^[a-f0-9]{64}$/.test(operation.argsHash)) fail('INVALID_OPERATION', 'Die Aktionsidentität ist ungültig.');
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const STOP_WORDS = new Set(('aber alle alles also am an and are as at auch auf aus bei bin bis bitte das dass dein dem den der des die dies diese du durch ein eine einem einen einer eines er es etwas for from für gibt habe haben hat haben heute ich im in ist it ja kann kannst kein keine like man me mehr mein meine mir mit muss nach nein nicht noch nur oder of on our please sehr sein seine sich sie sind so soll the their to um und unser unsere uns vom von vor war warum was we welche welcher welchem welchen wenn wer wem wen werden wieso weshalb wie wir wird wo wann wohin whose who what which where when why how zu zum zur über').split(/\s+/));
function words(value) {
  return [...new Set((fold(value).match(/[\p{L}\p{N}]+/gu) || []).filter(item => item.length >= 2 && !STOP_WORDS.has(item)))];
}
function expired(memory, now) { return !!memory.expiresAt && Date.parse(memory.expiresAt) <= Date.parse(now); }
function candidateText(value) {
  // Capture conservative review candidates, never infer facts or execute embedded requests.
  const normalized = value.toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (normalized.length < 20 || /\?$/.test(normalized) || /^(?:bitte\s+)?(?:öffne|zeige|suche|finde|lies|lösche|erstelle|schreibe|sende|antworte|prüfe|prüf|kannst du|könntest du|merke dir|merk dir|remember|open|show|search|find|read|delete|create|write|send|please)\b/i.test(normalized)) return undefined;
  return cut(normalized, 2000).trim();
}

/** Activation and retrieval are read-only; only explicit writes/events create the store. */
exports.activate = async ({ moduleId, dataDirectory }) => {
  if (moduleId !== MODULE_ID || typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory)) throw new Error('Das Gedächtnis benötigt seinen eigenen lokalen Datenspeicher.');
  const file = path.join(dataDirectory, 'memories.json');
  let queue = Promise.resolve();
  const serialize = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const emptyStore = () => ({ schemaVersion: 1, memories: [], operationReceipts: [], eventReceipts: [] });
  function validateRecord(memory) {
    object(memory, RECORD_FIELDS);
    resourceId(memory.id);
    for (const [key, max, multiline, empty] of [['title', 120, false, false], ['text', 2000, true, false], ['scope', 120, false, true]]) if (text(memory[key], key, max, multiline, empty) !== memory[key]) fail('INVALID_STORE', 'Der Gedächtnisspeicher enthält ungültige Texte.');
    if (!['confirmed', 'candidate'].includes(memory.status) || !['manual', 'chat'].includes(memory.origin)) fail('INVALID_STORE', 'Der Gedächtnisspeicher enthält einen ungültigen Status.');
    integer(memory.revision, undefined, 1, Number.MAX_SAFE_INTEGER - 1);
    timestamp(memory.createdAt); timestamp(memory.updatedAt);
    if (memory.expiresAt !== undefined) timestamp(memory.expiresAt);
    object(memory.source, ['title', 'uri']);
    if (text(memory.source.title, 'Die Quelle', 300) !== memory.source.title || (memory.source.uri !== undefined && (!memory.source.uri || url(memory.source.uri) !== memory.source.uri))) fail('INVALID_STORE', 'Der Gedächtnisspeicher enthält eine ungültige Quelle.');
    if (memory.observation !== undefined) {
      object(memory.observation, ['moduleId', 'eventId', 'sessionId', 'messageId', 'truncated', 'turnStatus']);
      const o = memory.observation;
      if (o.moduleId !== 'ovd-assistant' || typeof o.truncated !== 'boolean') fail('INVALID_STORE', 'Die Beobachtungsquelle ist ungültig.');
      for (const key of ['eventId', 'sessionId', 'messageId']) text(o[key], key, key === 'eventId' ? 160 : 128);
      if (o.turnStatus !== undefined && !['completed', 'failed', 'cancelled', 'limited', 'uncertain', 'running'].includes(o.turnStatus)) fail('INVALID_STORE', 'Der beobachtete Vorgangsstatus ist ungültig.');
    }
    return memory;
  }
  function validateStore(raw) {
    object(raw, ['schemaVersion', 'memories', 'operationReceipts', 'eventReceipts']);
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.memories) || raw.memories.length > MAX_MEMORIES || !Array.isArray(raw.operationReceipts) || raw.operationReceipts.length > MAX_OPERATION_RECEIPTS || !Array.isArray(raw.eventReceipts) || raw.eventReceipts.length > MAX_EVENT_RECEIPTS) fail('INVALID_STORE', 'Das Speicherformat ist unbekannt oder überschreitet seine Grenzen.');
    const ids = new Set();
    for (const memory of raw.memories) { validateRecord(memory); if (ids.has(memory.id)) fail('INVALID_STORE', 'Eine Erinnerungs-ID ist doppelt vorhanden.'); ids.add(memory.id); }
    const actions = new Set();
    for (const receipt of raw.operationReceipts) {
      object(receipt, ['runId', 'actionId', 'argsHash', 'toolName', 'result']);
      if (!WRITE_TOOLS.includes(receipt.toolName) || !/^[a-f0-9]{64}$/.test(receipt.argsHash) || !['runId', 'actionId'].every(key => typeof receipt[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt[key])) || receipt.result?.outcome !== 'completed') fail('INVALID_STORE', 'Ein Aktionsbeleg ist ungültig.');
      const key = JSON.stringify([receipt.runId, receipt.actionId]);
      if (actions.has(key)) fail('INVALID_STORE', 'Ein Aktionsbeleg ist doppelt vorhanden.'); actions.add(key); safeResult(receipt.result);
      if (receipt.toolName === 'memory.delete') { object(receipt.result, ['outcome', 'deleted', 'id']); if (receipt.result.deleted !== true) fail('INVALID_STORE', 'Ein Löschbeleg ist ungültig.'); resourceId(receipt.result.id); }
      else { object(receipt.result, ['outcome', 'memory']); validateRecord(receipt.result.memory); }
    }
    const events = new Set();
    for (const receipt of raw.eventReceipts) {
      object(receipt, ['moduleId', 'eventId', 'hash', 'recordedAt', 'memoryId', 'decision']);
      if (receipt.moduleId !== 'ovd-assistant' || !/^[a-f0-9]{64}$/.test(receipt.hash) || !['candidate', 'observed', 'ignored'].includes(receipt.decision)) fail('INVALID_STORE', 'Ein Ereignisbeleg ist ungültig.');
      text(receipt.eventId, 'Ereignis-ID', 160); timestamp(receipt.recordedAt); if (receipt.memoryId !== undefined) resourceId(receipt.memoryId);
      const key = JSON.stringify([receipt.moduleId, receipt.eventId]);
      if (events.has(key)) fail('INVALID_STORE', 'Ein Ereignisbeleg ist doppelt vorhanden.'); events.add(key);
    }
    return raw;
  }
  async function readStore(signal) {
    checkSignal(signal);
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) fail('INVALID_STORE', 'Der lokale Gedächtnisspeicher ist ungültig oder zu groß.');
      let raw;
      try { raw = JSON.parse(await handle.readFile({ encoding: 'utf8' })); } catch { fail('INVALID_STORE', 'Der lokale Gedächtnisspeicher kann nicht gelesen werden. Bestehende Daten wurden nicht verändert.'); }
      checkSignal(signal);
      try { return validateStore(raw); } catch (error) { if (error instanceof MemoryError) fail('INVALID_STORE', 'Der lokale Gedächtnisspeicher enthält ungültige Daten. Bestehende Daten wurden nicht verändert.'); throw error; }
    } catch (error) { if (error.code === 'ENOENT') return emptyStore(); throw error; }
    finally { await handle?.close(); }
  }
  async function writeStore(store, signal) {
    checkSignal(signal);
    // Never acknowledge a mutation that writes a store our own reader rejects.
    // This also checks event-derived records and durable receipts before any I/O.
    validateStore(store);
    const encoded = JSON.stringify(store) + '\n';
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FILE_BYTES) fail('STORAGE_FULL', 'Der lokale Gedächtnisspeicher ist voll. Es wurden keine Daten entfernt.');
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const temporary = path.join(dataDirectory, `.memory-${randomUUID()}.tmp`);
    let handle, renamed = false, writeError;
    try {
      handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(encoded, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
      checkSignal(signal); await fs.rename(temporary, file); renamed = true;
      let directory;
      try { directory = await fs.open(dataDirectory, 'r'); await directory.sync(); }
      catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
      finally { await directory?.close(); }
    } catch (error) { writeError = error; }
    finally {
      try { await handle?.close(); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      catch (error) { writeError ??= error; }
    }
    if (writeError) { if (renamed) fail('OUTCOME_UNCERTAIN', 'Die Änderung wurde ersetzt, ihre dauerhafte Speicherung konnte aber nicht abschließend bestätigt werden. Bitte den aktuellen Stand prüfen und nicht automatisch wiederholen.'); throw writeError; }
  }
  function existing(store, id) { const memory = store.memories.find(item => item.id === id); if (!memory) fail('NOT_FOUND', 'Diese Erinnerung ist nicht mehr vorhanden. Bitte die Liste aktualisieren.'); return memory; }
  function receiptResult(store, toolName, operation) {
    if (!operation) return;
    const receipt = store.operationReceipts.find(item => item.runId === operation.runId && item.actionId === operation.actionId);
    if (!receipt) return;
    if (receipt.toolName !== toolName || receipt.argsHash !== operation.argsHash) fail('OPERATION_CONFLICT', 'Diese Aktionsidentität wurde mit anderen Parametern verwendet.');
    return clone(receipt.result);
  }
  function recordResult(store, toolName, operation, result) {
    if (!operation) return;
    if (store.operationReceipts.length >= MAX_OPERATION_RECEIPTS) fail('RECEIPT_STORAGE_FULL', 'Der Aktionsbelegspeicher ist voll. Es wurden keine Erinnerungen verändert.');
    store.operationReceipts.push({ runId: operation.runId, actionId: operation.actionId, argsHash: operation.argsHash, toolName, result: clone(result) });
  }
  const tool = handler => async (args = {}, context = {}) => {
    try { checkSignal(context.signal); validateOperation(context.operation); return safeResult(await handler(args, context)); }
    catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      return { outcome: error.code === 'OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed', error: { code: error instanceof MemoryError ? error.code : 'STORAGE_ERROR', message: error instanceof MemoryError ? error.message : 'Der lokale Gedächtnisspeicher konnte nicht verarbeitet werden. Bitte den aktuellen Stand prüfen, bevor eine Schreibaktion erneut gestartet wird.' } };
    }
  };
  const tools = {
    'memory.list': tool(async (args, { signal }) => {
      argsObject(args, ['query', 'status', 'scope', 'offset', 'limit']);
      const query = args.query === undefined ? '' : text(args.query, 'Der Suchtext', 200, false, true), status = args.status ?? 'all';
      if (!['all', 'confirmed', 'candidate'].includes(status)) fail('INVALID_ARGUMENTS', 'Der Erinnerungsstatus ist ungültig.');
      const scope = args.scope === undefined ? undefined : text(args.scope, 'Der Geltungsbereich', 120, false, true);
      const offset = integer(args.offset, 0, 0, MAX_MEMORIES), limit = integer(args.limit, 20, 1, 50);
      return serialize(async () => {
        const store = await readStore(signal), terms = fold(query).split(/\s+/).filter(Boolean);
        const matches = store.memories.filter(item => (status === 'all' || item.status === status) && (scope === undefined || fold(item.scope) === fold(scope)) && terms.every(term => fold([item.title, item.text, item.scope, item.source.title].join(' ')).includes(term))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const memories = [];
        for (const memory of matches.slice(offset, offset + limit)) { checkSignal(signal); if (Buffer.byteLength(JSON.stringify([...memories, memory]), 'utf8') > 25 * 1024) break; memories.push(memory); }
        const hasMore = offset + memories.length < matches.length;
        return { memories, total: matches.length, countExact: true, complete: true, hasMore, ...(hasMore ? { nextOffset: offset + memories.length } : {}), observedAt: new Date().toISOString(), scope: { query, status, ...(scope !== undefined ? { scope } : {}) } };
      });
    }),
    'memory.read': tool(async (args, { signal }) => { argsObject(args, ['id']); const id = resourceId(args.id); return serialize(async () => ({ memory: existing(await readStore(signal), id) })); }),
    'memory.status': tool(async (args, { signal }) => {
      argsObject(args, []);
      return serialize(async () => {
        const store = await readStore(signal), now = new Date().toISOString(), groups = new Map();
        for (const item of store.memories) { const key = fold(item.scope), previous = groups.get(key); if (previous) previous.count++; else groups.set(key, { scope: item.scope, count: 1 }); }
        const scopeCounts = [...groups.values()].sort((a, b) => a.scope.localeCompare(b.scope, 'de-DE'));
        return { counts: { all: store.memories.length, confirmed: store.memories.filter(item => item.status === 'confirmed').length, candidate: store.memories.filter(item => item.status === 'candidate').length, expired: store.memories.filter(item => expired(item, now)).length }, scopeCounts: scopeCounts.slice(0, 50), scopeCountsHasMore: scopeCounts.length > 50, eventReceipts: store.eventReceipts.length, operationReceipts: store.operationReceipts.length, limits: { memories: MAX_MEMORIES, eventReceipts: MAX_EVENT_RECEIPTS, operationReceipts: MAX_OPERATION_RECEIPTS }, ...(store.eventReceipts.length ? { lastEventAt: store.eventReceipts.at(-1).recordedAt } : {}), learningPolicy: 'review_candidates', observedAt: now };
      });
    }),
    'memory.save': tool(async (args, { signal, operation }) => {
      const values = saveArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'memory.save', operation); if (recorded) return recorded;
        const previous = values.id ? store.memories.find(item => item.id === values.id) : undefined;
        if (previous && previous.revision !== values.expectedRevision) fail('REVISION_CONFLICT', 'Diese Erinnerung wurde zwischenzeitlich geändert. Bitte erneut lesen und die aktuelle Version prüfen.');
        if (!previous && values.expectedRevision !== undefined) fail('NOT_FOUND', 'Die zu ersetzende Erinnerung ist nicht mehr vorhanden.');
        if (!previous && store.memories.length >= MAX_MEMORIES) fail('MEMORY_FULL', 'Das Gedächtnis ist auf 2000 Einträge begrenzt. Bitte nicht mehr benötigte Einträge bewusst löschen.');
        const now = new Date().toISOString(), source = { title: values.sourceTitle ?? previous?.source.title ?? 'Vom Nutzer ausdrücklich gespeichert' };
        const sourceUri = values.sourceUri ?? previous?.source.uri; if (sourceUri) source.uri = sourceUri;
        const expiry = values.expiresAt ?? previous?.expiresAt;
        const memory = { id: values.id || randomUUID(), title: values.title, text: values.text, scope: values.scope ?? previous?.scope ?? '', status: 'confirmed', source, origin: previous?.origin ?? 'manual', revision: previous ? previous.revision + 1 : 1, createdAt: previous?.createdAt ?? now, updatedAt: now, ...(expiry ? { expiresAt: expiry } : {}), ...(previous?.observation ? { observation: previous.observation } : {}) };
        if (previous) store.memories[store.memories.indexOf(previous)] = memory; else store.memories.push(memory);
        const result = { outcome: 'completed', memory }; recordResult(store, 'memory.save', operation, result); await writeStore(store, signal); return result;
      });
    }),
    'memory.confirm': tool(async (args, { signal, operation }) => {
      const { id, expectedRevision } = revisionArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'memory.confirm', operation); if (recorded) return recorded;
        const previous = existing(store, id); if (previous.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Dieser Vorschlag wurde zwischenzeitlich geändert. Bitte erneut lesen.');
        const memory = previous.status === 'confirmed' ? previous : { ...previous, status: 'confirmed', revision: previous.revision + 1, updatedAt: new Date().toISOString() };
        store.memories[store.memories.indexOf(previous)] = memory;
        const result = { outcome: 'completed', memory }; recordResult(store, 'memory.confirm', operation, result); if (memory !== previous || operation) await writeStore(store, signal); return result;
      });
    }),
    'memory.delete': tool(async (args, { signal, operation }) => {
      const { id, expectedRevision } = revisionArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'memory.delete', operation); if (recorded) return recorded;
        const memory = existing(store, id); if (memory.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Diese Erinnerung wurde zwischenzeitlich geändert. Bitte erneut lesen.');
        store.memories = store.memories.filter(item => item.id !== id); const result = { outcome: 'completed', deleted: true, id };
        recordResult(store, 'memory.delete', operation, result); await writeStore(store, signal); return result;
      });
    }),
    'memory.recall': tool(async (args, { signal }) => {
      argsObject(args, ['query', 'sessionId', 'now', 'limit', 'maxChars']);
      const query = text(args.query, 'Die Frage', 6000, true, true), sessionId = text(args.sessionId, 'Die Chat-ID', 128), now = timestamp(args.now);
      const limit = integer(args.limit, undefined, 1, 20), maxChars = integer(args.maxChars, undefined, 1, 8000);
      return serialize(async () => {
        const store = await readStore(signal), terms = words(query);
        if (!terms.length) return { memories: [], hasMore: false };
        const ranked = [];
        for (const item of store.memories) {
          checkSignal(signal); if (item.status !== 'confirmed' || expired(item, now)) continue;
          const title = fold(item.title), body = fold(item.text), scope = fold(item.scope), titleWords = words(item.title), bodyWords = words(item.text), scopeWords = words(item.scope);
          let score = 0, matches = 0;
          for (const term of terms) {
            const exact = titleWords.includes(term) || bodyWords.includes(term), partial = term.length >= 4 && (title.includes(term) || body.includes(term));
            const scopeMatch = scopeWords.includes(term) || term.length >= 4 && scope.includes(term);
            if (exact || partial || scopeMatch) { matches++; score += titleWords.includes(term) ? 5 : exact ? 3 : 1; if (scopeMatch) score += 4; }
          }
          if (!matches) continue;
          score += matches / terms.length;
          if (item.observation?.sessionId === sessionId) score += 0.5;
          ranked.push({ item, score });
        }
        ranked.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id));
        const memories = [];
        for (const { item } of ranked) {
          checkSignal(signal); if (memories.length >= limit) break;
          const sourceTitle = item.scope ? cut(`${item.source.title} · Bereich: ${item.scope}`, 300) : item.source.title;
          const memory = { id: item.id, text: item.text, source: { title: sourceTitle, ...(item.source.uri ? { uri: item.source.uri } : {}), reference: { type: 'memory', id: item.id } }, updatedAt: item.updatedAt, ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}) };
          if (JSON.stringify([...memories, memory]).length > maxChars) continue;
          memories.push(memory);
        }
        return { memories, hasMore: memories.length < ranked.length };
      });
    }),
    'memory.reference': tool(async (args, { signal }) => {
      argsObject(args, ['id']); const id = resourceId(args.id);
      return serialize(async () => {
        const memory = existing(await readStore(signal), id), now = new Date().toISOString();
        if (memory.status !== 'confirmed') fail('UNCONFIRMED_MEMORY', 'Dieser Vorschlag muss vor dem Anhängen geprüft und als Erinnerung gespeichert werden.');
        const content = [memory.status === 'candidate' ? 'Unbestätigter Vorschlag aus einer Nutzeräußerung; vor Verwendung prüfen.' : 'Vom Nutzer gespeicherte Erinnerung; Quelle und Gültigkeit beachten.', ...(expired(memory, now) ? ['Diese Erinnerung ist abgelaufen.'] : []), ...(memory.scope ? [`Geltungsbereich: ${memory.scope}`] : []), `Quelle: ${memory.source.title}`, ...(memory.source.uri ? [`Quellenadresse: ${memory.source.uri}`] : []), ...(memory.expiresAt ? [`Gültig bis: ${memory.expiresAt}`] : []), '', memory.text].join('\n');
        return { moduleId: MODULE_ID, type: 'memory', id, title: memory.title, description: memory.scope || memory.source.title, mediaType: 'text/plain', size: Buffer.byteLength(content, 'utf8'), icon: 'chat', readable: true, truncated: false, capturedAt: now, text: content, sourceVersion: String(memory.revision), sourceUpdatedAt: memory.updatedAt, metadata: { scope: memory.status === 'candidate' ? 'Vollständiger unbestätigter Erinnerungsvorschlag' : 'Vollständige gespeicherte Erinnerung' } };
      });
    })
  };
  return {
    tools,
    onEvent: async (event, { signal } = {}) => {
      checkSignal(signal);
      object(event, ['version', 'id', 'type', 'source', 'occurredAt', 'payload']);
      object(event.source, ['moduleId']);
      if (event.version !== 1 || event.source?.moduleId !== 'ovd-assistant' || !['chat.request.committed', 'chat.turn.finished'].includes(event.type)) fail('INVALID_EVENT', 'Dieses Ereignis gehört nicht zu einer unterstützten Chatquelle.');
      text(event.id, 'Die Ereignis-ID', 160); timestamp(event.occurredAt);
      const p = event.payload;
      if (event.type === 'chat.request.committed') {
        object(p, ['sessionId', 'messageId', 'role', 'text', 'truncated']);
        if (p.role !== 'user' || typeof p.truncated !== 'boolean') fail('INVALID_EVENT', 'Das Nutzerereignis ist ungültig.');
        text(p.sessionId, 'Die Chat-ID', 128); text(p.messageId, 'Die Nachrichten-ID', 128);
        // Host excerpts may cut an emoji's surrogate pair. Validate the envelope,
        // then normalize only the review candidate; never block all later events.
        if (typeof p.text !== 'string' || p.text.length > 3000) fail('INVALID_EVENT', 'Die Nutzerbeobachtung ist ungültig oder zu groß.');
      } else {
        object(p, ['sessionId', 'requestMessageId', 'currentRequestMessageId', 'assistantMessageId', 'runId', 'rootRunId', 'kind', 'status', 'assistantText', 'truncated', 'actionCounts', 'actionCountsScope', 'claimsAreUnverified']);
        for (const key of ['sessionId', 'requestMessageId', 'currentRequestMessageId', 'assistantMessageId']) text(p[key], key, 128);
        if (!['initial', 'continuation'].includes(p.kind) || !['completed', 'failed', 'cancelled', 'limited', 'uncertain', 'running'].includes(p.status) || p.claimsAreUnverified !== true || p.actionCountsScope !== 'root_run' || typeof p.truncated !== 'boolean') fail('INVALID_EVENT', 'Das Abschlussereignis ist ungültig.');
        if (typeof p.assistantText !== 'string' || p.assistantText.length > 3000) fail('INVALID_EVENT', 'Die Antwortbeobachtung ist ungültig oder zu groß.');
        object(p.actionCounts, ['completed', 'failed', 'cancelled', 'uncertain', 'pending']);
        for (const key of ['completed', 'failed', 'cancelled', 'uncertain', 'pending']) integer(p.actionCounts[key], undefined, 0, Number.MAX_SAFE_INTEGER);
        for (const key of ['runId', 'rootRunId']) if (p[key] !== undefined) text(p[key], key, 128);
      }
      const hash = digest(event);
      return serialize(async () => {
        const store = await readStore(signal), receipt = store.eventReceipts.find(item => item.moduleId === event.source.moduleId && item.eventId === event.id);
        if (receipt) { if (receipt.hash !== hash) fail('EVENT_CONFLICT', 'Die Ereignis-ID wurde mit verändertem Inhalt wiederverwendet.'); return { ack: event.id }; }
        if (store.eventReceipts.length >= MAX_EVENT_RECEIPTS) fail('EVENT_RECEIPT_STORAGE_FULL', 'Der Ereignisbelegspeicher ist voll. Das Ereignis wurde nicht bestätigt.');
        const now = new Date().toISOString(); let memoryId, decision = 'ignored';
        if (event.type === 'chat.request.committed') {
          const candidate = candidateText(p.text);
          const sameContent = candidate && store.memories.find(item => fold(item.text) === fold(candidate));
          if (candidate && !sameContent) {
            if (store.memories.length >= MAX_MEMORIES) fail('MEMORY_FULL', 'Das Gedächtnis ist voll. Das Ereignis wurde nicht bestätigt.');
            memoryId = randomUUID(); decision = 'candidate';
            const title = cut(candidate.split(/[\r\n]/)[0].replace(/\s+/g, ' ').trim(), 120).trim() || 'Nutzeräußerung prüfen';
            store.memories.push({ id: memoryId, title, text: candidate, scope: '', status: 'candidate', source: { title: 'Nutzeräußerung im Chat' }, origin: 'chat', revision: 1, createdAt: now, updatedAt: now, observation: { moduleId: event.source.moduleId, eventId: event.id, sessionId: p.sessionId, messageId: p.messageId, truncated: p.truncated || candidate !== p.text.trim() } });
          } else if (sameContent) { memoryId = sameContent.id; decision = 'observed'; }
        } else {
          const memory = store.memories.find(item => item.observation?.sessionId === p.sessionId && item.observation?.messageId === p.requestMessageId);
          if (memory) { memoryId = memory.id; decision = 'observed'; memory.observation.turnStatus = p.status; }
        }
        store.eventReceipts.push({ moduleId: event.source.moduleId, eventId: event.id, hash, recordedAt: now, ...(memoryId ? { memoryId } : {}), decision });
        await writeStore(store, signal); return { ack: event.id };
      });
    },
    prepareOperation: async ({ toolName, args }, { signal } = {}) => {
      checkSignal(signal); if (!WRITE_TOOLS.includes(toolName)) return { args };
      const values = toolName === 'memory.save' ? saveArguments(args) : revisionArguments(args);
      return serialize(async () => { const store = await readStore(signal), id = values.id || randomUUID(), memory = store.memories.find(item => item.id === id); return { args: { ...values, id }, resource: { id, version: memory ? String(memory.revision) : 'absent' } }; });
    },
    reconcile: async ({ toolName, operation }, { signal } = {}) => {
      validateOperation(operation);
      if (!operation || !WRITE_TOOLS.includes(toolName)) return { state: 'unknown', detail: 'Für diese Aktion ist kein dauerhafter Aktionsbeleg verfügbar.' };
      return serialize(async () => { try { const store = await readStore(signal), result = receiptResult(store, toolName, operation); return result ? { state: 'completed', result, detail: 'Die lokale Änderung und ihr Aktionsbeleg wurden gemeinsam gespeichert.' } : { state: 'unknown', detail: 'Kein passender dauerhafter Aktionsbeleg liegt vor. Nicht automatisch wiederholen.' }; } catch (error) { if (signal?.aborted) throw error; return { state: 'unknown', detail: 'Der Aktionsstatus konnte nicht zuverlässig gelesen werden. Nicht automatisch wiederholen.' }; } });
    },
    dispose: async () => { await queue; }
  };
};
