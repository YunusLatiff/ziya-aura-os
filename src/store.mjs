import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'data');
const DB = path.join(ROOT, 'aura.json');
fs.mkdirSync(ROOT, { recursive: true });

const empty = () => ({
  agents: {}, tasks: [], events: [], incidents: [], leadBatches: [], leads: [], leadRegistry: [], emailDrafts: [], auditLogs: [],
  meta: { createdAt: new Date().toISOString() }
});

export function load() {
  if (!fs.existsSync(DB)) return empty();
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return empty(); }
}

function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

export function save(db) {
  const data = JSON.stringify(db, null, 2);
  const tmp = path.join(ROOT, `aura.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data, 'utf8');
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      fs.renameSync(tmp, DB);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM','EBUSY','EACCES'].includes(error.code)) throw error;
      sleep(attempt * 75);
    }
  }
  try {
    fs.writeFileSync(DB, data, 'utf8');
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  } catch (fallbackError) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw new Error(`Aura database save failed. Rename error: ${lastError?.message}. Direct-write error: ${fallbackError.message}`);
  }
}

export function mutate(fn) {
  const db = load();
  const result = fn(db);
  save(db);
  return result;
}

export function dbPath() { return DB; }
