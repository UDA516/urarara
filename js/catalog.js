// 機種のデータ。暗号化したもの（envelope）を端末に持ち、起動のたびに手元で復号する。
// ネットへは更新の確認のときだけ行く（version.json を見て、変わっていれば data.enc を取り直す）。
// 店舗はデータに入れない（判別を始めるときに自由に入れ、端末の記録にだけ残す）
import { kvGet, kvSet, kvDel } from './db.js';
import { deriveKey, decryptEnvelope } from './crypto.js';

let envelope = null;
let aesKey = null;
let payload = null;

export const data = () => payload;
export const machines = () => payload?.machines ?? [];
export const machine = id => machines().find(m => m.id === id) || null;

/** "20261006-153000" → "10/6 15:30版" */
export function versionLabel(v = payload?.version) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(v || '');
  return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]}版` : (v || '—');
}

async function fetchJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} を取れませんでした（${r.status}）`);
  return r.json();
}

/** 起動。'ready'（開けた）か 'locked'（パスワードが要る）。手元に無く、取りにも行けなければ例外 */
export async function boot() {
  envelope = await kvGet('envelope');
  if (!envelope) {
    envelope = await fetchJson('data.enc');
    await kvSet('envelope', envelope);
  }
  const stored = await kvGet('key');
  if (stored && stored.salt === envelope.salt) {
    try {
      payload = await decryptEnvelope(stored.key, envelope);
      aesKey = stored.key;
      return 'ready';
    } catch (e) {
      console.warn('保存した鍵で開けませんでした', e);
    }
  }
  return 'locked';
}

/** 違うパスワードなら例外（OperationError） */
export async function unlock(password) {
  const key = await deriveKey(password, envelope);
  payload = await decryptEnvelope(key, envelope);
  aesKey = key;
  try {
    await kvSet('key', { key, salt: envelope.salt });
  } catch (e) {
    console.warn('鍵を保存できない端末です（開くたびにパスワードを聞きます）', e);
  }
}

export async function lock() {
  await kvDel('key');
  aesKey = null;
  payload = null;
}

/** 'same' | 'updated' | 'relock'（PC でパスワードが変わった）| 'offline' */
export async function checkUpdate() {
  let ver, next;
  try { ver = await fetchJson('version.json'); } catch { return 'offline'; }
  if (ver.version === envelope.version) return 'same';
  try { next = await fetchJson('data.enc'); } catch { return 'offline'; }
  if (next.salt !== envelope.salt) {
    envelope = next;
    await kvSet('envelope', next);
    await kvDel('key');
    aesKey = null;
    return 'relock';
  }
  const fresh = await decryptEnvelope(aesKey, next);
  envelope = next;
  payload = fresh;
  await kvSet('envelope', next);
  return 'updated';
}
