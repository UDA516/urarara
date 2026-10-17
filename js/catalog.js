// 機種のデータ。暗号化したもの（envelope）を端末に持ち、起動のたびに手元で復号する。
// ネットへは更新の確認のときだけ行く（version.json を見て、変わっていれば data.enc を取り直す）。
// 店舗名はデータに入れない（判別を始めるときに入れ、端末の記録にだけ残す）。例外は店舗の選択肢（短い名前だけ。2026-10-16）
import { kvGet, kvSet, kvDel } from './db.js';
import { deriveKey, decryptEnvelope } from './crypto.js';

let envelope = null;
let aesKey = null;
let payload = null;

export const data = () => payload;
export const cryptoKey = () => aesKey;   // 画像を解く（images.js）。取り出せない形の鍵
export const machines = () => payload?.machines ?? [];
export const machine = id => machines().find(m => m.id === id) || null;
export const storeChoices = () => payload?.storeChoices ?? [];   // 店舗の選択肢（前のデータには無い）

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

/** 違うパスワードなら例外（OperationError）。手元のデータで開けなければ、新しいデータでも試す
 *  （ロックしているあいだに PC でパスワードが変わったとき。更新の確認は開いてからなので、
 *  手元の古いデータのままだと、新しいパスワードが「違います」になってしまう） */
export async function unlock(password) {
  let key, data;
  try {
    key = await deriveKey(password, envelope);
    data = await decryptEnvelope(key, envelope);
  } catch (e) {
    const next = await fetchJson('data.enc').catch(() => null);
    if (!next || next.salt === envelope.salt) throw e;   // 電波が無い・パスワードは変わっていない
    key = await deriveKey(password, next);
    data = await decryptEnvelope(key, next);
    envelope = next;
    await kvSet('envelope', next);
  }
  payload = data;
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
