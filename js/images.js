// 画像（機種のメモと、判別の組に添えるもの）。暗号化したまま端末（kv の 'img:<id>'）に持ち、見るときに手元で解く。
// データを開いたあと・更新を確かめたあとに、まだ持っていない画像を裏で取り、今のデータで使わない画像は消す
// （ホールの圏外でも見られるように）。1枚のファイルに小さい版と大きい版が入っている（build.py の pack_images）。
// 画面には小さい版を並べ（ui.js の imgGridHtml）、押すと大きい版を全画面で見る（左右で前後・2回押す／2本指で拡大・
// 端末の戻るで閉じる）
import * as catalog from './catalog.js';
import { decryptBytes } from './crypto.js';
import { kvGet, kvSet, kvDel, kvKeys } from './db.js';

const PREFIX = 'img:';
const known = () => catalog.data()?.images || {};   // id → [幅, 高さ, バイト数]
const cache = new Map();   // id → Promise<{ thumb, full }>（解いた画像の URL。開いているあいだだけ持つ）

async function download(id) {
  const r = await fetch(`img/${id}.bin`);
  if (!r.ok) throw new Error(`画像を取れませんでした（${r.status}）`);
  const buf = await r.arrayBuffer();
  try { await kvSet(PREFIX + id, buf); } catch (e) { console.warn('画像を端末に保存できませんでした', e); }
  return buf;
}

async function open(id) {
  const key = catalog.cryptoKey();
  if (!key) throw new Error('ロック中です');
  const stored = await kvGet(PREFIX + id);
  // 端末に無い・解けない（壊れた）ものは取り直す
  const plain = (stored && await decryptBytes(key, stored).catch(() => null)) || await decryptBytes(key, await download(id));
  const n = new DataView(plain).getUint32(0);   // 小さい版の長さ。そのあとに小さい版・大きい版
  return {
    thumb: URL.createObjectURL(new Blob([new Uint8Array(plain, 4, n)], { type: 'image/webp' })),
    full: URL.createObjectURL(new Blob([new Uint8Array(plain, 4 + n)], { type: 'image/webp' })),
  };
}

/** 解いた画像の URL（{ thumb, full }）。端末に無ければ取りに行く。取れなければ例外 */
export function imageUrls(id) {
  if (!cache.has(id)) {
    const p = open(id);
    cache.set(id, p);
    p.catch(() => cache.delete(id));   // 取れなかったものは、次に見るときにまた試す
  }
  return cache.get(id);
}

/** ロックするときに、解いた画像を手放す */
export function forgetImages() {
  for (const p of cache.values()) p.then(u => { URL.revokeObjectURL(u.thumb); URL.revokeObjectURL(u.full); }, () => {});
  cache.clear();
}

let syncing = null;
/** まだ持っていない画像を取り、今のデータで使わない画像を消す。電波が無ければそこでやめる（次の確認でまた試す） */
export function syncImages() {
  if (!catalog.data()) return Promise.resolve();   // ロック中は今のデータが分からないので、消しもしない
  syncing ||= (async () => {
    const want = known();
    const have = new Set((await kvKeys(PREFIX)).map(k => k.slice(PREFIX.length)));
    for (const id of have) if (!want[id]) await kvDel(PREFIX + id);
    for (const id of Object.keys(want)) {
      if (have.has(id)) continue;
      try { await download(id); } catch (e) { console.warn(e); break; }
    }
  })().catch(e => console.warn('画像の取り込み', e)).finally(() => { syncing = null; });
  return syncing;
}

/** 端末に持っている画像の数とバイト数（設定の画面） */
export async function imageStatus() {
  const all = known();
  const ids = Object.keys(all);
  const have = new Set((await kvKeys(PREFIX)).map(k => k.slice(PREFIX.length)));
  const got = ids.filter(id => have.has(id));
  return { total: ids.length, stored: got.length, bytes: got.reduce((a, id) => a + (all[id][2] || 0), 0) };
}

/** root の中の小さな画像（ui.js の imgGridHtml）に中身を入れる */
export function showThumbs(root) {
  root.querySelectorAll('.img-thumb:not([data-shown])').forEach(btn => {
    btn.dataset.shown = '';
    const img = btn.querySelector('img');
    imageUrls(btn.dataset.img).then(u => { img.src = u.thumb; btn.classList.add('is-ready'); }, () => btn.classList.add('is-err'));
  });
}

/** root の中の小さな画像を押したら、同じ一覧の画像を全画面で開く（root ごとに1回呼ぶ） */
export function bindViewer(root) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('.img-thumb');
    if (!btn || !root.contains(btn)) return;
    const all = [...btn.closest('.img-grid').querySelectorAll('.img-thumb')];
    openViewer(all.map(b => ({ id: b.dataset.img, caption: b.dataset.cap })), all.indexOf(btn));
  });
}

const MAX_ZOOM = 5;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 全画面で見る。list は [{ id, caption }]。アプリの画面は拡大できない（viewport）ので、拡大はここで受け持つ */
export function openViewer(list, start = 0) {
  const many = list.length > 1;
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="vw-head">
      <p class="vw-cap" data-cap></p>
      ${many ? '<span class="vw-pos" data-pos></span>' : ''}
      <button type="button" class="vw-close" data-close aria-label="閉じる">×</button>
    </div>
    <div class="vw-stage" data-stage>
      <img class="vw-img" alt="" draggable="false" hidden>
      <p class="vw-msg" data-msg></p>
      ${many ? `<button type="button" class="vw-nav vw-prev" data-step="-1" aria-label="前の画像">‹</button>
        <button type="button" class="vw-nav vw-next" data-step="1" aria-label="次の画像">›</button>` : ''}
    </div>
    <p class="vw-hint">${many ? '左右に滑らせて前後 · ' : ''}2回押すか2本指で拡大</p>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  const $ = s => el.querySelector(s);
  const stage = $('[data-stage]');
  const img = $('.vw-img');
  const msg = $('[data-msg]');
  let idx = -1;
  let scale = 1, tx = 0, ty = 0;   // 絵の拡大と位置（絵の真ん中＝画面の真ん中から）
  let closed = false;

  const apply = anim => {
    img.style.transition = anim ? 'transform 0.2s ease-out' : 'none';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const center = () => {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  };
  // 拡大した絵を、端が画面の内側へ入るほどには動かさない
  const clamp = () => {
    const c = center();
    const bx = Math.max(0, (img.offsetWidth * scale - c.w) / 2);
    const by = Math.max(0, (img.offsetHeight * scale - c.h) / 2);
    tx = Math.min(bx, Math.max(-bx, tx));
    ty = Math.min(by, Math.max(-by, ty));
  };
  const reset = () => { scale = 1; tx = 0; ty = 0; };
  // 絵を画面に収まる大きさに（元が小さい絵も画面いっぱいまで広げる）。向きを変えたときもやり直す
  const fit = () => {
    if (!img.naturalWidth) return;
    const c = center();
    const f = Math.min(c.w / img.naturalWidth, c.h / img.naturalHeight);
    img.style.width = `${img.naturalWidth * f}px`;
    img.style.height = `${img.naturalHeight * f}px`;
  };
  const onResize = () => { fit(); reset(); apply(false); };

  async function show(n) {
    if (n < 0 || n >= list.length || n === idx) return;
    idx = n;
    reset();
    apply(false);
    $('[data-cap]').textContent = list[n].caption || '';
    if (many) {
      $('[data-pos]').textContent = `${n + 1} / ${list.length}`;
      $('.vw-prev').disabled = n === 0;
      $('.vw-next').disabled = n === list.length - 1;
    }
    img.hidden = true;
    msg.hidden = false;
    msg.textContent = '読み込んでいます…';
    try {
      const u = await imageUrls(list[n].id);
      if (idx !== n || closed) return;
      img.src = u.full;
      await img.decode().catch(() => {});
      if (idx !== n || closed) return;
      fit();
      img.hidden = false;
      msg.hidden = true;
    } catch {
      if (idx === n) msg.textContent = '画像を取れませんでした。電波のある所で開き直すと取ります';
    }
  }

  // 指の動き。pinch: 2本指で拡大・pan: 拡大中に1本指で動かす・swipe: 拡大していないとき左右で前後
  const pts = new Map();
  let g = null;
  let lastTap = null;
  const oneFinger = p => ({ type: scale > 1 ? 'pan' : 'swipe', x0: p.x, y0: p.y, tx0: tx, ty0: ty, moved: false });
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.vw-nav') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* 捕まえられなくても動く */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = pts.values();
      g = { type: 'pinch', d0: Math.max(1, dist(a, b)), s0: scale, m0: mid(a, b), tx0: tx, ty0: ty };
    } else if (pts.size === 1) {
      g = oneFinger({ x: e.clientX, y: e.clientY });
    }
  });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.type === 'pinch') {
      if (pts.size < 2) return;
      const [a, b] = pts.values();
      const m = mid(a, b);
      const c = center();
      // 2本の指の真ん中が、置いたときと同じ絵の場所を指したままになるように
      const qx = (g.m0.x - c.x - g.tx0) / g.s0;
      const qy = (g.m0.y - c.y - g.ty0) / g.s0;
      scale = Math.min(MAX_ZOOM, Math.max(0.8, g.s0 * dist(a, b) / g.d0));
      tx = m.x - c.x - scale * qx;
      ty = m.y - c.y - scale * qy;
      apply(false);
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
    if (g.type === 'pan') { tx = g.tx0 + dx; ty = g.ty0 + dy; clamp(); }
    else if (many) tx = dx;   // 指に付いて横に動き、離したときに前後へ
    apply(false);
  });
  const end = e => {
    if (!pts.delete(e.pointerId) || !g) return;
    if (g.type === 'pinch') {
      if (pts.size === 1) {
        // 1本だけ離したら、残った指で動かす（そのまま前後へは移らない）
        const [p] = pts.values();
        g = { ...oneFinger(p), moved: true, noTurn: true };
        return;
      }
      if (pts.size) return;
      g = null;
      if (scale <= 1.05) reset(); else clamp();
      apply(true);
      return;
    }
    if (pts.size) return;
    const d = g;
    g = null;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.type === 'swipe') {
      const to = idx + (dx < 0 ? 1 : -1);
      if (many && !d.noTurn && e.type === 'pointerup' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && list[to]) {
        show(to);
        return;
      }
      tx = 0;
      ty = 0;
      apply(true);
    }
    if (!d.moved && e.type === 'pointerup') tap(e);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // 2回押したら、押したところを 2.5倍に（拡大中なら元に戻す）
  function tap(e) {
    const prev = lastTap;
    lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (!prev || e.timeStamp - prev.t > 300 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 30) return;
    lastTap = null;
    if (img.hidden) return;
    if (scale > 1) {
      reset();
    } else {
      const c = center();
      scale = 2.5;
      tx = -(scale - 1) * (e.clientX - c.x);
      ty = -(scale - 1) * (e.clientY - c.y);
      clamp();
    }
    apply(true);
  }

  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'ArrowRight') show(idx + 1);
  };
  const onPop = () => close(true);
  function close(popped = false) {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', onResize);
    if (!document.querySelector('.overlay.open')) document.body.classList.remove('no-scroll');
    if (!popped && history.state?.viewer) history.back();
  }
  // 端末の戻る（Android）で閉じる。開くときに履歴を1つ積み（URL は同じなので画面は移らない）、× で閉じたらそれを戻す
  history.pushState({ viewer: true }, '');
  window.addEventListener('popstate', onPop);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);
  $('[data-close]').addEventListener('click', () => close());
  el.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => show(idx + Number(b.dataset.step))));
  show(Math.min(Math.max(0, start), list.length - 1));
  return { close };
}
