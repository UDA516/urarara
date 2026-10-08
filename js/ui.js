// 画面の小さな道具: 文字の書き方・お知らせ・下から出す枠・確認・たためる組の開け閉め・メモの表示

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
    overlay.remove();
    if (!document.querySelector('.overlay.open')) document.body.classList.remove('no-scroll');
    onClose?.(value);
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
  return { el: overlay.querySelector('.sheet'), close };
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

/** 機種メモの本文。段落・「-」「・」の箇条書き・**太字** だけを読む（中身は先に esc する） */
export function md(text) {
  const out = [];
  let mode = null;
  let buf = [];
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const flush = () => {
    if (buf.length) out.push(mode === 'ul' ? `<ul>${buf.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : `<p>${buf.map(inline).join('<br>')}</p>`);
    buf = [];
    mode = null;
  };
  for (const line of String(text || '').split('\n')) {
    const li = line.match(/^\s*(?:[-*]\s+|・\s*)(.*)$/);
    if (li) { if (mode !== 'ul') flush(); mode = 'ul'; buf.push(li[1]); }
    else if (!line.trim()) flush();
    else { if (mode !== 'p') flush(); mode = 'p'; buf.push(line); }
  }
  flush();
  return out.join('');
}
