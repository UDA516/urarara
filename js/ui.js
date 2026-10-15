// 画面の小さな道具: 文字の書き方・お知らせ・下から出す枠・コピー・確認・たためる組の開け閉め・
// 横に滑らせるとボタンが出る行・メモの表示・画像の一覧

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const fmtInt = n => Math.round(Number(n) || 0).toLocaleString('ja-JP');
export function fmtSigned(n) {
  n = Math.round(Number(n) || 0);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ja-JP');
}
/** 確率の分母を「1/○」で。10 未満（ぶどうなど）は小数2桁 */
export function fmtDen(v) {
  if (!(v > 0) || !Number.isFinite(v)) return '—';
  return '1/' + (v < 10 ? v.toFixed(2) : v.toFixed(1));
}
export const fmtPct = p => (p == null ? '—' : (p * 100).toFixed(1) + '%');
export function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`;
}
export function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 上に出るお知らせ。action を渡すとボタンが付く。続けて出したものは下に重なる（上書きしない） */
export function toast(message, { action, onAction, ms = 3500 } = {}) {
  const box = document.getElementById('toast');
  const item = document.createElement('div');
  item.className = 'toast';
  item.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-act">${esc(action)}</button>` : ''}`;
  const remove = () => item.remove();
  if (action) item.querySelector('.toast-act').onclick = () => { remove(); onAction?.(); };
  box.appendChild(item);
  setTimeout(remove, ms);
}

const openSheets = new Set();   // 開いている枠の close

/** 下から出す枠。外側を押すと close(null) で閉じる */
export function openSheet(html, { onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay open';
  overlay.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  let closed = false;
  const close = value => {
    if (closed) return;
    closed = true;
    openSheets.delete(close);
    overlay.remove();
    if (!document.querySelector('.overlay.open')) document.body.classList.remove('no-scroll');
    onClose?.(value);
  };
  openSheets.add(close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
  return { el: overlay.querySelector('.sheet'), close };
}

/** 開いている枠を全部、やめた扱い（close(null)）で閉じる。画面を移ったとき（Android の戻るなど）に、
 *  前の画面の枠が新しい画面の上に残らないように */
export function closeSheets() {
  [...openSheets].forEach(close => close(null));
}

/** クリップボードへ。使えない端末では選択した状態で見せ、「コピーしました」を押したら true */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return new Promise(resolve => {
      const sheet = openSheet(`<div class="sheet-title">この文字列をコピーしてください</div>
        <textarea class="io" rows="7" readonly>${esc(text)}</textarea>
        <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-done>コピーしました</button></div>`, { onClose: v => resolve(!!v) });
      const ta = sheet.el.querySelector('textarea');
      ta.focus();
      ta.select();
      sheet.el.querySelector('[data-done]').addEventListener('click', () => sheet.close(true));
    });
  }
}

/** 確認。押したボタンの value で解決する（外側を押したら null）。window.confirm は使わない */
export function confirmDialog(message, buttons) {
  return new Promise(resolve => {
    const sheet = openSheet(
      `<p class="dlg-msg">${esc(message)}</p><div class="dlg-btns">${buttons.map((b, i) =>
        `<button type="button" class="btn btn-block ${b.kind ? 'btn-' + b.kind : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`,
      { onClose: resolve },
    );
    sheet.el.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) sheet.close(buttons[+b.dataset.i].value);
    });
  });
}

const FOLDS = 'slot-memo.folds';   // たたんだ組（{ scope: [data-fold の値…] }）。端末ごとの好みなので localStorage
const readFolds = () => { try { return JSON.parse(localStorage.getItem(FOLDS)) || {}; } catch { return {}; } };

/** たためる組（<details data-fold="…" open>）の開け閉めを、scope（画面と機種など）ごとに覚えて戻す */
export function rememberFolds(root, scope) {
  const closed = new Set(readFolds()[scope] || []);
  root.querySelectorAll('details[data-fold]').forEach(d => { d.open = !closed.has(d.dataset.fold); });
  // toggle は親へ伝わらないので、捕まえる側で受ける
  root.addEventListener('toggle', e => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.fold) return;
    const all = readFolds();
    const set = new Set(all[scope] || []);
    if (d.open) set.delete(d.dataset.fold); else set.add(d.dataset.fold);
    all[scope] = [...set];
    try { localStorage.setItem(FOLDS, JSON.stringify(all)); } catch { /* 覚えられなくても動く */ }
  }, true);
}

/** 横に滑らせるとボタンが出る行（スマホのよくある操作）。行の形は
 *    <div class="swipe" data-id="…"><div class="swipe-acts"><button class="swipe-act" data-act="…">…</button>…</div>
 *    <a class="swipe-face" draggable="false" …>…</a></div>
 *  左へ滑らせると右のボタンが出る。開くのは1行だけで、ほかを触ると閉じる（そのときの1回は行を開かない）。
 *  縦の動きはスクロールに任せる（.swipe-face は touch-action: pan-y）。ボタンを押すと閉じて onAction(act, id) */
export function swipeRows(root, onAction) {
  let open = null;        // 開いている行
  let drag = null;        // 指を置いているあいだ
  let eatClick = false;   // 滑らせた・閉じるために触ったあとのクリックは、行のリンクを開かない
  const face = sw => sw.querySelector('.swipe-face');
  const width = sw => sw.querySelector('.swipe-acts').offsetWidth;
  const moveTo = (sw, x) => { face(sw).style.transform = x ? `translateX(${x}px)` : ''; };
  const show = sw => {
    if (open && open !== sw) hide(open);
    open = sw;
    sw.classList.add('is-on');
    moveTo(sw, -width(sw));
  };
  const hide = sw => {
    if (open === sw) open = null;
    moveTo(sw, 0);
    // 戻りきってからボタンを隠す（閉じているあいだは、角の丸みから覗かないように隠しておく）
    setTimeout(() => { if (open !== sw && drag?.sw !== sw) sw.classList.remove('is-on'); }, 250);
  };

  root.addEventListener('pointerdown', e => {
    eatClick = false;
    if (!e.isPrimary || e.button !== 0) return;   // 2本目の指・右クリックは見ない
    drag = null;
    if (e.target.closest('.swipe-acts')) return;   // ボタンはそのまま押させる
    const f = e.target.closest('.swipe-face');
    const sw = f?.closest('.swipe');
    const wasOpen = !!sw && open === sw;
    const closing = !!open && !wasOpen;
    if (closing) hide(open);
    if (!sw) return;
    const base = wasOpen ? -width(sw) : 0;
    drag = { sw, id: e.pointerId, x0: e.clientX, y0: e.clientY, max: width(sw), base, x: base, t: e.timeStamp, v: 0, wasOpen, closing, horizontal: false, vertical: false };
  });

  root.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || drag.vertical) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.horizontal) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) { drag.vertical = true; return; }   // 縦はスクロール
      drag.horizontal = true;
      try { face(drag.sw).setPointerCapture(e.pointerId); } catch { /* 捕まえられなくても動く */ }
      drag.sw.classList.add('is-on', 'is-drag');
    }
    let x = drag.base + dx;
    // 端を越えたら重くする
    if (x > 0) x /= 4;
    else if (x < -drag.max) x = -drag.max + (x + drag.max) / 4;
    const dt = e.timeStamp - drag.t;
    if (dt > 0) drag.v = drag.v / 2 + (x - drag.x) / dt / 2;
    drag.x = x;
    drag.t = e.timeStamp;
    moveTo(drag.sw, x);
  });

  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.sw.classList.remove('is-drag');
    if (d.horizontal) {
      eatClick = true;
      // 速く払ったら向きで、ゆっくりなら半分を越えたかで決める（指を止めてから離したときは速さを見ない）
      const v = e.timeStamp - d.t > 100 ? 0 : d.v;
      if (v < -0.4 || (v <= 0.4 && d.x < -d.max / 2)) show(d.sw); else hide(d.sw);
    } else if (d.wasOpen && !d.vertical && e.type === 'pointerup') {
      hide(d.sw);   // 開いている行を触ったら閉じるだけ
      eatClick = true;
    } else if (d.closing) {
      eatClick = true;
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  root.addEventListener('click', e => {
    if (eatClick) {
      eatClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const b = e.target.closest('.swipe-act');
    if (!b) return;
    const sw = b.closest('.swipe');
    hide(sw);
    onAction(b.dataset.act, sw.dataset.id);
  }, true);
}

/** 画像を小さく並べる。list は [{ id, caption }]。中身は images.js の showThumbs が入れ、押すと bindViewer が全画面で開く */
export function imgGridHtml(list) {
  return `<div class="img-grid">${list.map(x => `<button type="button" class="img-thumb" data-img="${esc(x.id)}" data-cap="${esc(x.caption || '')}"
    aria-label="${esc(x.caption ? `${x.caption}を大きく見る` : '画像を大きく見る')}"><span class="img-box"><img alt="" decoding="async"></span>${
    x.caption ? `<span class="img-cap">${esc(x.caption)}</span>` : ''}</button>`).join('')}</div>`;
}

/** 機種メモの本文。段落・「-」「・」の箇条書き・**太字**・画像の行（![説明](@id)。並んだ行は1つの一覧）だけを読む
 *  （中身は先に esc する） */
export function md(text) {
  const out = [];
  let mode = null;
  let buf = [];
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const flush = () => {
    if (buf.length) {
      out.push(mode === 'ul' ? `<ul>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`
        : mode === 'img' ? imgGridHtml(buf) : `<p>${buf.map(inline).join('<br>')}</p>`);
    }
    buf = [];
    mode = null;
  };
  for (const line of String(text || '').split('\n')) {
    const im = line.trim().match(/^!\[([^\]]*)\]\(@([0-9a-f]+)\)$/);
    const li = line.match(/^\s*(?:[-*]\s+|・\s*)(.*)$/);
    if (im) { if (mode !== 'img') flush(); mode = 'img'; buf.push({ id: im[2], caption: im[1] }); }
    else if (li) { if (mode !== 'ul') flush(); mode = 'ul'; buf.push(li[1]); }
    else if (!line.trim()) flush();
    else { if (mode !== 'p') flush(); mode = 'p'; buf.push(line); }
  }
  flush();
  return out.join('');
}
