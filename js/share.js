// 判別の共有。途中の判別の値（機種・前任者・自分の G数と回数）を短い文字列（SM2.…）にして人に渡し、
// 受け取った側はその値で判別を始める（画面は views\judge.js）。
// 暗号化はしない（読み込むには台メモを開く＝パスワードが要るので、暗号化しても読める人は変わらない）。
// 機種と項目は名前から作った短い番号で入れる。項目を並び順でなく番号で引くので、送った側と受けた側で
// データの版が違っても、今の表にある項目だけを入れられる（2026-10-14 ユーザーの希望「入れられるとこだけ入れる」）。
// メモは入れない。店舗・台番号は選んだときだけ
import * as catalog from './catalog.js';
import * as J from './juggler.js';

const PREFIX = 'SM2.';
/** G数の欄（記録の項目名のまま。startAllG・totalAllG は総G もある機種だけ）。並びを変えない（印のビットの順） */
const FIELDS = ['startG', 'totalG', 'prevBig', 'prevReg', 'startAllG', 'totalAllG'];
const PLACE = 1 << FIELDS.length;   // 欄の印の次のビット: 店舗・台番号が入っている
const MAX = 999999;                 // テンキーは6桁まで
const EPOCH = Date.UTC(2026, 0, 1); // 時刻は 2026-01-01 からの分で入れる
const utf8 = new TextEncoder();

/** FNV-1a（32bit）。機種・項目の短い番号と、確かめ用の数字に使う */
function fnv(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}
const machineTag = id => fnv(utf8.encode(id)) & 0xffffff;
const itemTag = id => fnv(utf8.encode(id)) & 0xffff;

const toB64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

/** データの版（"20261014-135854"）を分に。読めなければ 0 */
function versionMinutes(v) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(v || '');
  return m ? Math.max(0, Math.round((Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - EPOCH) / 60000)) : 0;
}
function versionOf(min) {
  const d = new Date(EPOCH + min * 60000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

function writer() {
  const out = [];
  return {
    out,
    u8: v => out.push(v & 0xff),
    u16: v => out.push((v >>> 8) & 0xff, v & 0xff),
    u24: v => out.push((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff),
    /** 0 以上の整数を7ビットずつ（小さい数は1バイト） */
    uv(v) {
      v = Math.max(0, Math.floor(v) || 0);
      do {
        const b = v % 128;
        v = Math.floor(v / 128);
        out.push(v ? b | 0x80 : b);
      } while (v);
    },
    bytes: b => out.push(...b),
  };
}

/** 足りなければ例外（途中で切れた文字列） */
function reader(buf) {
  let i = 0;
  const need = n => { if (i + n > buf.length) throw new Error('短すぎます'); };
  return {
    get done() { return i === buf.length; },
    u8() { need(1); return buf[i++]; },
    u16() { need(2); i += 2; return (buf[i - 2] << 8) | buf[i - 1]; },
    u24() { need(3); i += 3; return (buf[i - 3] << 16) | (buf[i - 2] << 8) | buf[i - 1]; },
    uv() {
      let v = 0, mul = 1, b;
      do {
        need(1);
        b = buf[i++];
        v += (b & 0x7f) * mul;
        mul *= 128;
        if (mul > 2 ** 35) throw new Error('数が大きすぎます');
      } while (b & 0x80);
      return v;
    },
    bytes(n) { need(n); i += n; return buf.slice(i - n, i); },
  };
}

/** 途中の判別 s を共有の文字列にする。withPlace なら店舗・台番号も入れる。
 *  中身: 機種の番号・共有した時刻・データの版・欄の印と G数・回数（項目の番号と回数）・（店舗と台番号）・確かめ用の数字 */
export function makeShare(s, { withPlace = false } = {}) {
  const w = writer();
  w.u24(machineTag(s.machineId));
  w.uv((Date.now() - EPOCH) / 60000);
  w.uv(versionMinutes(catalog.data()?.version));
  const place = withPlace && !!(s.store || s.num);
  let mask = place ? PLACE : 0;
  FIELDS.forEach((k, i) => { if (s[k] != null) mask |= 1 << i; });
  w.u8(mask);
  FIELDS.forEach(k => { if (s[k] != null) w.uv(s[k]); });
  const counts = Object.entries(s.counts || {}).filter(([, v]) => Number.isFinite(v));
  w.uv(counts.length);
  for (const [id, v] of counts) {
    w.u16(itemTag(id));
    w.uv(v);
  }
  if (place) {
    w.uv(Number(s.num) || 0);
    const b = utf8.encode((s.store || '').slice(0, 40));
    w.uv(b.length);
    w.bytes(b);
  }
  w.u16(fnv(w.out) & 0xffff);
  return PREFIX + toB64url(w.out);
}

function parse(body) {
  const r = reader(body);
  const x = { tag: r.u24(), sharedAt: EPOCH + r.uv() * 60000, ver: r.uv(), fields: {}, counts: [], store: null, num: '' };
  const mask = r.u8();
  FIELDS.forEach((k, i) => { if (mask & (1 << i)) x.fields[k] = r.uv(); });
  const n = r.uv();
  if (n > 500) throw new Error('項目が多すぎます');
  for (let i = 0; i < n; i++) x.counts.push([r.u16(), r.uv()]);
  if (mask & PLACE) {
    const num = r.uv();
    x.num = num ? String(num) : '';
    x.store = new TextDecoder('utf-8', { fatal: true }).decode(r.bytes(r.uv())).trim() || null;
  }
  if (!r.done) throw new Error('余りがあります');
  return x;
}

/** 共有の文字列を読んで確かめる（前後に別の文字があってもよい）。読めなければ、そのまま画面に出せる文の Error。
 *  返すもの: 機種 m・共有した時刻・G数の欄・回数（今の表にある項目だけ）・店舗と台番号（入っていれば）・
 *  データの版が違えば相手の版・今の表に無くて入れなかった項目の数 */
export function readShare(text) {
  const hit = String(text || '').match(/SM2\.([A-Za-z0-9_-]{8,})/);
  if (!hit) throw new Error('共有の文字列が見つかりません（「SM2.」で始まる文字列を貼ってください）');
  const broken = new Error('読めませんでした。途中で切れているか、打ち間違いがあります（もう一度コピーしてもらってください）');
  let x;
  try {
    const buf = fromB64url(hit[1]);
    const body = buf.slice(0, -2);
    if (buf.length < 8 || ((buf[buf.length - 2] << 8) | buf[buf.length - 1]) !== (fnv(body) & 0xffff)) throw broken;
    x = parse(body);
  } catch {
    throw broken;
  }
  const hits = catalog.machines().filter(m => J.isJudgeable(m) && machineTag(m.id) === x.tag);
  if (hits.length !== 1) throw new Error('この機種の判別の表が今のデータにありません。データの更新を確かめてください（共有した側のデータのほうが新しいかもしれません）');
  const m = hits[0];
  const ok = v => Number.isInteger(v) && v >= 0 && v <= MAX;
  const all = !!J.names(m).all;
  const fields = {};
  for (const k of FIELDS) {
    if ((k === 'startAllG' || k === 'totalAllG') && !all) continue;
    if (ok(x.fields[k])) fields[k] = x.fields[k];
  }
  // 項目は番号で引く。今の表に無い項目と、番号が重なって決められない項目は入れない
  const byTag = new Map();
  for (const it of J.myItems(m)) {
    const t = itemTag(it.id);
    byTag.set(t, byTag.has(t) ? null : it.id);
  }
  const counts = {};
  let dropped = 0;
  for (const [t, v] of x.counts) {
    const id = byTag.get(t);
    if (id && ok(v)) counts[id] = v; else dropped++;
  }
  return {
    m, fields, counts, dropped,
    sharedAt: x.sharedAt,
    otherVersion: x.ver && x.ver !== versionMinutes(catalog.data().version) ? versionOf(x.ver) : null,
    store: x.store ? x.store.slice(0, 40) : null,
    num: /^\d{1,5}$/.test(x.num) ? x.num : '',
  };
}
