'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MODULE_ID = 'skill-library';
const MAX_SKILLS = 500;
const MAX_INSTRUCTIONS = 6000;
const MAX_INSTRUCTION_BYTES = 8192;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_RECEIPTS = 1000;
const MAX_RESULT_BYTES = 30 * 1024;
const SAVE_FIELDS = ['id', 'expectedRevision', 'title', 'description', 'tags', 'instructions', 'category', 'favorite'];
const WRITE_TOOLS = ['skill-library.save', 'skill-library.delete', 'skill-library.set_favorite'];
const fold = value => value.normalize('NFKC').toLocaleLowerCase('de-DE');
const own = (value, key) => Object.hasOwn(value, key);

class SkillError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new SkillError(code, message); }
function checkSignal(signal) { signal?.throwIfAborted(); }
function argsObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENTS', 'Die Skillparameter sind ungültig.');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 16000) fail('ARGUMENTS_TOO_LARGE', 'Die Anfrage ist zu groß. Bitte die Anweisungen kürzen.');
}
function integer(value, fallback, min, max) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_ARGUMENTS', 'Eine Seitengröße, Position oder Versionsnummer ist ungültig.');
  return value;
}
function resourceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) fail('INVALID_ID', 'Die Skill-ID ist ungültig.');
  return value;
}
function text(value, label, max, multiline = false, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) fail('INVALID_ARGUMENTS', `${label} ist ungültig oder zu lang (maximal ${max} Zeichen).`);
  // Reject isolated UTF-16 surrogates so paging and UTF-8 persistence are lossless.
  if (typeof value.isWellFormed === 'function' && !value.isWellFormed()) fail('INVALID_ARGUMENTS', `${label} enthält ungültige Zeichen.`);
  return value.trim();
}
function tags(value = []) {
  if (!Array.isArray(value) || value.length > 12) fail('INVALID_ARGUMENTS', 'Es sind höchstens 12 Schlagwörter erlaubt.');
  const result = value.map(item => text(item, 'Ein Schlagwort', 40));
  if (new Set(result.map(item => item.toLocaleLowerCase('de-DE'))).size !== result.length) fail('INVALID_ARGUMENTS', 'Schlagwörter dürfen nicht doppelt vorkommen.');
  return result;
}
function category(value) {
  const result = text(value, 'Die Kategorie', 60, false, true);
  if (['alle', 'favoriten'].includes(fold(result))) fail('RESERVED_CATEGORY', 'Alle und Favoriten sind feste Ansichten und können nicht als eigene Kategorie verwendet werden.');
  return result;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_ARGUMENTS', `${label} muss wahr oder falsch sein.`);
  return value;
}
function saveArguments(args) {
  argsObject(args, SAVE_FIELDS);
  const result = {
    ...(args.id !== undefined ? { id: resourceId(args.id) } : {}),
    ...(args.expectedRevision !== undefined ? { expectedRevision: integer(args.expectedRevision, undefined, 1, Number.MAX_SAFE_INTEGER - 1) } : {}),
    title: text(args.title, 'Der Titel', 120),
    description: text(args.description, 'Die Beschreibung', 400, false, true),
    tags: tags(args.tags),
    ...(args.category !== undefined ? { category: category(args.category) } : {}),
    ...(args.favorite !== undefined ? { favorite: boolean(args.favorite, 'Favorit') } : {}),
    instructions: text(args.instructions, 'Die Arbeitsanweisung', MAX_INSTRUCTIONS, true)
  };
  if (result.expectedRevision !== undefined && !result.id) fail('INVALID_ARGUMENTS', 'Eine Versionsprüfung benötigt die ID des vorhandenen Skills.');
  if (Buffer.byteLength(result.instructions, 'utf8') > MAX_INSTRUCTION_BYTES) fail('INSTRUCTIONS_TOO_LARGE', 'Die Arbeitsanweisung darf höchstens 8192 UTF-8-Bytes enthalten. Bitte den Text kürzen.');
  return result;
}
function deleteArguments(args) {
  argsObject(args, ['id', 'expectedRevision']);
  return { id: resourceId(args.id), expectedRevision: integer(args.expectedRevision, undefined, 1, Number.MAX_SAFE_INTEGER - 1) };
}
function favoriteArguments(args) {
  argsObject(args, ['id', 'favorite', 'expectedRevision']);
  return { id: resourceId(args.id), favorite: boolean(args.favorite, 'Favorit'), expectedRevision: integer(args.expectedRevision, undefined, 1, Number.MAX_SAFE_INTEGER - 1) };
}
function metadata(skill) {
  const { id, title, description, tags: skillTags, revision, createdAt, updatedAt, category: skillCategory = '', favorite = false } = skill;
  return { id, title, description, tags: [...skillTags], category: skillCategory, favorite, revision, createdAt, updatedAt };
}
function validDate(value) { return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)); }
function validateOperation(operation) {
  if (operation === undefined) return;
  if (!operation || typeof operation !== 'object' || Array.isArray(operation) || Object.keys(operation).some(key => !['runId', 'actionId', 'attemptId', 'argsHash'].includes(key)) || !['runId', 'actionId', 'attemptId'].every(key => typeof operation[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(operation[key])) || !/^[a-f0-9]{64}$/.test(operation.argsHash)) fail('INVALID_OPERATION', 'Die gespeicherte Aktionsidentität ist ungültig.');
}
function sameAction(receipt, operation) { return receipt.runId === operation.runId && receipt.actionId === operation.actionId; }
function safeResult(result) {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESULT_BYTES) fail('RESULT_TOO_LARGE', 'Das Ergebnis ist zu groß. Bitte eine kleinere Seite abrufen.');
  return result;
}

/** No dependencies or installer hooks: all data lives in the host-owned module directory. */
exports.activate = async ({ moduleId, dataDirectory }) => {
  if (moduleId !== MODULE_ID || typeof dataDirectory !== 'string' || !path.isAbsolute(dataDirectory)) throw new Error('Die Skill-Bibliothek benötigt ihren eigenen lokalen Datenspeicher.');
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(dataDirectory, 'skills.json');
  let queue = Promise.resolve();
  const serialize = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };

  function validateStore(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['schemaVersion', 'skills', 'receipts'].includes(key)) || ![1, 2].includes(raw.schemaVersion) || !Array.isArray(raw.skills) || raw.skills.length > MAX_SKILLS || !Array.isArray(raw.receipts) || raw.receipts.length > MAX_RECEIPTS) fail('INVALID_STORE', 'Der Skill-Speicher ist ungültig oder hat ein unbekanntes Format. Bestehende Daten wurden nicht verändert.');
    const ids = new Set(), skills = [];
    for (const skill of raw.skills) {
      if (!skill || typeof skill !== 'object' || Array.isArray(skill) || Object.keys(skill).some(key => !['id', 'title', 'description', 'tags', 'instructions', 'revision', 'createdAt', 'updatedAt', 'category', 'favorite'].includes(key))) fail('INVALID_STORE', 'Der Skill-Speicher enthält einen ungültigen Eintrag.');
      if (raw.schemaVersion === 2 && (!own(skill, 'category') || !own(skill, 'favorite'))) fail('INVALID_STORE', 'Der Skill-Speicher enthält unvollständige Kategorien oder Favoriten.');
      const normalized = saveArguments({ id: skill.id, title: skill.title, description: skill.description, tags: skill.tags, instructions: skill.instructions, category: skill.category ?? '', favorite: skill.favorite ?? false });
      if (ids.has(normalized.id) || !Number.isSafeInteger(skill.revision) || skill.revision < 1 || !validDate(skill.createdAt) || !validDate(skill.updatedAt)) fail('INVALID_STORE', 'Der Skill-Speicher enthält ungültige IDs, Versionen oder Datumsangaben.');
      if (normalized.title !== skill.title || normalized.description !== skill.description || normalized.instructions !== skill.instructions || (own(skill, 'category') && normalized.category !== skill.category) || (own(skill, 'favorite') && normalized.favorite !== skill.favorite)) fail('INVALID_STORE', 'Der Skill-Speicher enthält ungültige Texte.');
      ids.add(normalized.id);
      skills.push({ ...skill, category: normalized.category, favorite: normalized.favorite });
    }
    const actions = new Set();
    for (const receipt of raw.receipts) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || Object.keys(receipt).some(key => !['runId', 'actionId', 'argsHash', 'toolName', 'result'].includes(key)) || !/^[a-f0-9]{64}$/.test(receipt.argsHash) || !WRITE_TOOLS.includes(receipt.toolName) || !['runId', 'actionId'].every(key => typeof receipt[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(receipt[key]))) fail('INVALID_STORE', 'Ein gespeicherter Aktionsbeleg ist ungültig.');
      const key = JSON.stringify([receipt.runId, receipt.actionId]);
      if (actions.has(key) || !receipt.result || receipt.result.outcome !== 'completed') fail('INVALID_STORE', 'Ein gespeicherter Aktionsbeleg ist ungültig.');
      safeResult(receipt.result);
      actions.add(key);
    }
    // Read legacy data without rewriting it. The next deliberate mutation writes
    // schema 2 atomically together with all skills and existing action receipts.
    return { schemaVersion: 2, skills, receipts: raw.receipts };
  }
  async function readStore(signal) {
    checkSignal(signal);
    let handle;
    try {
      handle = await fs.open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) fail('INVALID_STORE', 'Der Skill-Speicher ist zu groß oder ungültig. Bestehende Daten wurden nicht verändert.');
      let raw;
      try { raw = JSON.parse(await handle.readFile({ encoding: 'utf8' })); }
      catch { fail('INVALID_STORE', 'Der Skill-Speicher konnte nicht gelesen werden. Bestehende Daten wurden nicht verändert.'); }
      checkSignal(signal);
      try { return validateStore(raw); }
      catch (error) { if (error instanceof SkillError) fail('INVALID_STORE', 'Der Skill-Speicher enthält ungültige Daten. Bestehende Daten wurden nicht verändert.'); throw error; }
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 2, skills: [], receipts: [] };
      throw error;
    } finally { await handle?.close(); }
  }
  async function writeStore(store, signal) {
    checkSignal(signal);
    const encoded = JSON.stringify(store) + '\n';
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FILE_BYTES) fail('STORAGE_FULL', 'Der lokale Skill-Speicher ist voll.');
    const temporary = path.join(dataDirectory, `.skills-${randomUUID()}.tmp`);
    let handle, renamed = false, writeError;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(encoded, 'utf8');
      await handle.sync();
      await handle.close(); handle = undefined;
      checkSignal(signal);
      await fs.rename(temporary, file);
      renamed = true;
      // Directory fsync makes the replacement durable where the platform supports it.
      let directory;
      try { directory = await fs.open(dataDirectory, 'r'); await directory.sync(); }
      catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
      finally { await directory?.close(); }
    } catch (error) { writeError = error; }
    finally {
      try { await handle?.close(); await fs.rm(temporary, { force: true }); }
      catch (error) { writeError ??= error; }
    }
    if (writeError) {
      if (renamed) fail('OUTCOME_UNCERTAIN', 'Die Änderung wurde ersetzt, ihre dauerhafte Speicherung konnte aber nicht abschließend bestätigt werden. Bitte Bibliothek und Aktionsstatus prüfen; nicht automatisch wiederholen.');
      throw writeError;
    }
  }
  function existingSkill(store, id) {
    const skill = store.skills.find(item => item.id === id);
    if (!skill) fail('NOT_FOUND', 'Dieser Skill ist nicht mehr vorhanden. Bitte die Bibliothek aktualisieren.');
    return skill;
  }
  function receiptResult(store, toolName, operation) {
    if (!operation) return;
    const receipt = store.receipts.find(item => sameAction(item, operation));
    if (!receipt) return;
    if (receipt.argsHash !== operation.argsHash || receipt.toolName !== toolName) fail('OPERATION_CONFLICT', 'Diese Aktion wurde bereits mit anderen Parametern gespeichert.');
    const result = structuredClone(receipt.result);
    if (result.skill) {
      result.skill.category ??= '';
      result.skill.favorite ??= false;
    }
    return result;
  }
  function recordResult(store, toolName, operation, result) {
    if (!operation) return;
    if (store.receipts.length >= MAX_RECEIPTS) fail('RECEIPT_STORAGE_FULL', 'Der Aktionsbelegspeicher ist voll. Es wurden keine Skills verändert.');
    store.receipts.push({ runId: operation.runId, actionId: operation.actionId, argsHash: operation.argsHash, toolName, result: structuredClone(result) });
  }
  const tool = handler => async (args = {}, context = {}) => {
    try {
      checkSignal(context.signal);
      validateOperation(context.operation);
      return safeResult(await handler(args, context));
    } catch (error) {
      if (context.signal?.aborted || error.name === 'AbortError') throw error;
      return { outcome: error.code === 'OUTCOME_UNCERTAIN' ? 'uncertain' : 'failed', error: { code: error instanceof SkillError ? error.code : 'STORAGE_ERROR', message: error instanceof SkillError ? error.message : 'Der lokale Skill-Speicher konnte nicht verarbeitet werden. Bitte die Bibliothek aktualisieren, bevor du eine Schreibaktion erneut startest.' } };
    }
  };

  const tools = {
    'skill-library.list': tool(async (args, { signal }) => {
      argsObject(args, ['query', 'category', 'favoritesOnly', 'offset', 'limit']);
      const selectedCategory = args.category === undefined ? undefined : category(args.category);
      const favoritesOnly = args.favoritesOnly === undefined ? false : boolean(args.favoritesOnly, 'Favoritenfilter');
      const query = args.query === undefined ? '' : text(args.query, 'Der Suchtext', 120, false, true);
      const offset = integer(args.offset, 0, 0, MAX_SKILLS);
      const limit = integer(args.limit, 20, 1, 50);
      return serialize(async () => {
        const store = await readStore(signal);
        const terms = query.toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean);
        const matches = store.skills.filter(skill => {
          const haystack = [skill.title, skill.description, skill.category, ...skill.tags].join(' ').toLocaleLowerCase('de-DE');
          return (!favoritesOnly || skill.favorite) && (selectedCategory === undefined || fold(skill.category) === fold(selectedCategory)) && terms.every(term => haystack.includes(term));
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        const skills = [];
        for (const skill of matches.slice(offset, offset + limit)) {
          const next = metadata(skill);
          if (Buffer.byteLength(JSON.stringify([...skills, next]), 'utf8') > 24 * 1024) break;
          skills.push(next);
        }
        checkSignal(signal);
        const hasMore = offset + skills.length < matches.length;
        return { skills, total: matches.length, countExact: true, complete: true, hasMore, ...(hasMore ? { nextOffset: offset + skills.length } : {}), observedAt: new Date().toISOString(), scope: ['Lokale Skill-Bibliothek', ...(selectedCategory !== undefined ? [selectedCategory ? `Kategorie: ${selectedCategory}` : 'Ohne Kategorie'] : []), ...(favoritesOnly ? ['Nur Favoriten'] : []), ...(query ? [`Titel, Beschreibung, Kategorie und Schlagwörter gefiltert nach: ${query}`] : [])].join('; ') };
      });
    }),
    'skill-library.categories': tool(async (args, { signal }) => {
      argsObject(args, ['query', 'offset', 'limit']);
      const query = args.query === undefined ? '' : text(args.query, 'Der Suchtext', 120, false, true);
      const offset = integer(args.offset, 0, 0, MAX_SKILLS), limit = integer(args.limit, 50, 1, 50);
      return serialize(async () => {
        const store = await readStore(signal), groups = new Map();
        for (const skill of store.skills) {
          if (!skill.category) continue;
          const key = fold(skill.category), existing = groups.get(key);
          if (existing) existing.count++;
          else groups.set(key, { name: skill.category, count: 1 });
        }
        const terms = fold(query).split(/\s+/).filter(Boolean);
        const matches = [...groups.values()].filter(item => terms.every(term => fold(item.name).includes(term))).sort((a, b) => a.name.localeCompare(b.name, 'de-DE'));
        const categories = matches.slice(offset, offset + limit), hasMore = offset + categories.length < matches.length;
        checkSignal(signal);
        return { categories, total: matches.length, allCount: store.skills.length, favoriteCount: store.skills.filter(skill => skill.favorite).length, uncategorizedCount: store.skills.filter(skill => !skill.category).length, countExact: true, complete: true, hasMore, ...(hasMore ? { nextOffset: offset + categories.length } : {}), observedAt: new Date().toISOString(), scope: query ? `Kategorienamen der lokalen Bibliothek gefiltert nach: ${query}; Systemzähler umfassen den gesamten Bestand` : 'Kategorien und Systemzähler der gesamten lokalen Skill-Bibliothek' };
      });
    }),
    'skill-library.read': tool(async (args, { signal }) => {
      argsObject(args, ['id', 'offset', 'limit']);
      const id = resourceId(args.id), offset = integer(args.offset, 0, 0, MAX_INSTRUCTIONS), limit = integer(args.limit, 4000, 1, 4000);
      return serialize(async () => {
        const skill = existingSkill(await readStore(signal), id);
        if (offset > skill.instructions.length) fail('INVALID_OFFSET', 'Die Textposition liegt außerhalb der Arbeitsanweisung.');
        if (offset > 0 && /[\udc00-\udfff]/.test(skill.instructions[offset] || '') && /[\ud800-\udbff]/.test(skill.instructions[offset - 1])) fail('INVALID_OFFSET', 'Die Textposition liegt innerhalb eines Zeichens. Bitte den gelieferten Folgeoffset verwenden.');
        let end = Math.min(offset + limit, skill.instructions.length);
        if (end < skill.instructions.length && /[\ud800-\udbff]/.test(skill.instructions[end - 1]) && /[\udc00-\udfff]/.test(skill.instructions[end])) end--;
        if (end === offset && offset < skill.instructions.length) fail('INVALID_ARGUMENTS', 'Die Seitengröße ist für dieses Zeichen zu klein. Bitte mindestens zwei Zeichen anfordern.');
        const hasMore = end < skill.instructions.length;
        return { skill: metadata(skill), instructions: skill.instructions.slice(offset, end), totalCharacters: skill.instructions.length, hasMore, ...(hasMore ? { nextOffset: end } : {}), complete: !hasMore };
      });
    }),
    'skill-library.save': tool(async (args, { signal, operation }) => {
      const values = saveArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'skill-library.save', operation);
        if (recorded) return recorded;
        const previous = values.id ? store.skills.find(item => item.id === values.id) : undefined;
        if (previous && (values.expectedRevision === undefined || values.expectedRevision !== previous.revision)) fail('REVISION_CONFLICT', 'Dieser Skill wurde zwischenzeitlich geändert. Bitte erneut lesen und die aktuelle Version prüfen.');
        if (!previous && values.expectedRevision !== undefined) fail('NOT_FOUND', 'Der zu ersetzende Skill ist nicht mehr vorhanden.');
        if (!previous && store.skills.length >= MAX_SKILLS) fail('LIBRARY_FULL', 'Die Bibliothek ist auf 500 Skills begrenzt.');
        const timestamp = new Date().toISOString();
        const requestedCategory = values.category ?? previous?.category ?? '';
        const skillCategory = requestedCategory ? store.skills.find(item => fold(item.category) === fold(requestedCategory))?.category || requestedCategory : '';
        const skill = { id: values.id || randomUUID(), title: values.title, description: values.description, tags: values.tags, category: skillCategory, favorite: values.favorite ?? previous?.favorite ?? false, instructions: values.instructions, revision: previous ? previous.revision + 1 : 1, createdAt: previous ? previous.createdAt : timestamp, updatedAt: timestamp };
        if (previous) store.skills[store.skills.indexOf(previous)] = skill;
        else store.skills.push(skill);
        const result = { outcome: 'completed', skill: metadata(skill) };
        recordResult(store, 'skill-library.save', operation, result);
        await writeStore(store, signal);
        return result;
      });
    }),
    'skill-library.set_favorite': tool(async (args, { signal, operation }) => {
      const { id, favorite, expectedRevision } = favoriteArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'skill-library.set_favorite', operation);
        if (recorded) return recorded;
        const previous = existingSkill(store, id);
        if (previous.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Dieser Skill wurde zwischenzeitlich geändert. Bitte erneut lesen, bevor du den Favoritenstatus änderst.');
        const skill = previous.favorite === favorite ? previous : { ...previous, favorite, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
        store.skills[store.skills.indexOf(previous)] = skill;
        const result = { outcome: 'completed', skill: metadata(skill) };
        recordResult(store, 'skill-library.set_favorite', operation, result);
        if (skill !== previous || operation) await writeStore(store, signal);
        return result;
      });
    }),
    'skill-library.delete': tool(async (args, { signal, operation }) => {
      const { id, expectedRevision } = deleteArguments(args);
      return serialize(async () => {
        const store = await readStore(signal), recorded = receiptResult(store, 'skill-library.delete', operation);
        if (recorded) return recorded;
        const previous = existingSkill(store, id);
        if (previous.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Dieser Skill wurde zwischenzeitlich geändert. Bitte erneut lesen, bevor du ihn löschst.');
        store.skills = store.skills.filter(item => item.id !== id);
        const result = { outcome: 'completed', deleted: true, id };
        recordResult(store, 'skill-library.delete', operation, result);
        await writeStore(store, signal);
        return result;
      });
    }),
    'skill-library.reference': tool(async (args, { signal }) => {
      argsObject(args, ['id']);
      const id = resourceId(args.id);
      return serialize(async () => {
        const skill = existingSkill(await readStore(signal), id);
        return { moduleId: MODULE_ID, type: 'skill', id, title: skill.title, description: skill.description, mediaType: 'text/markdown', size: Buffer.byteLength(skill.instructions, 'utf8'), icon: 'grid', readable: true, truncated: false, capturedAt: new Date().toISOString(), text: skill.instructions, sourceVersion: String(skill.revision), sourceUpdatedAt: skill.updatedAt, metadata: { scope: 'Vollständige Arbeitsanweisung dieses Skills' } };
      });
    })
  };

  return {
    tools,
    prepareOperation: async ({ toolName, args }, { signal } = {}) => {
      checkSignal(signal);
      if (!WRITE_TOOLS.includes(toolName)) return { args };
      const normalized = toolName === 'skill-library.save' ? saveArguments(args) : toolName === 'skill-library.set_favorite' ? favoriteArguments(args) : deleteArguments(args);
      return serialize(async () => {
        const store = await readStore(signal);
        const id = normalized.id || randomUUID();
        const skill = store.skills.find(item => item.id === id);
        return { args: { ...normalized, id }, resource: { id, version: skill ? String(skill.revision) : 'absent' } };
      });
    },
    reconcile: async ({ toolName, operation }, { signal } = {}) => {
      validateOperation(operation);
      if (!operation || !WRITE_TOOLS.includes(toolName)) return { state: 'unknown', detail: 'Für diese Aktion ist kein dauerhafter Schreibbeleg verfügbar.' };
      return serialize(async () => {
        try {
          const store = await readStore(signal);
          const result = receiptResult(store, toolName, operation);
          if (result) return { state: 'completed', result, detail: 'Die lokale Änderung und ihr Aktionsbeleg wurden gemeinsam gespeichert.' };
          return { state: 'unknown', detail: 'Es liegt kein passender dauerhafter Aktionsbeleg vor. Die Aktion wird nicht automatisch wiederholt.' };
        } catch (error) {
          if (signal?.aborted) throw error;
          return { state: 'unknown', detail: 'Der Aktionsstatus konnte nicht zuverlässig gelesen werden. Die Aktion wird nicht automatisch wiederholt.' };
        }
      });
    },
    dispose: async () => { await queue; }
  };
};
