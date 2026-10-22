// 機種の一覧と詳細（メモ・スペック表・天井・狙い目）。詳細から判別・ぶどう逆算へ移れる
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { matches } from '../search.js';
import { esc, md } from '../ui.js';
import { showThumbs, bindViewer } from '../images.js';
import { navigate } from '../nav.js';
import { startSession, cautionCard } from './judge.js';

const TYPE_LABEL = { juggler: 'ジャグラー', atype: 'Aタイプ', at: 'AT機', memo: 'メモ' };
let query = '';
let typeFilter = '';

export function render(root, args, ctx) {
  if (args[0]) return detail(root, args[0], args[1], ctx);
  ctx.setBar({ title: '機種' });
  const all = [...catalog.machines()].sort((a, b) => a.kana.localeCompare(b.kana, 'ja'));
  const types = [...new Set(all.map(m => m.type))];
  root.innerHTML = `
    <input class="search" type="search" placeholder="機種名・読み・略称" value="${esc(query)}" data-q>
    ${types.length > 1 ? `<div class="chips" data-types>${['', ...types].map(t =>
      `<button type="button" class="chip ${t === typeFilter ? 'on' : ''}" data-type="${esc(t)}">${t ? esc(TYPE_LABEL[t] || t) : 'すべて'}</button>`).join('')}</div>` : ''}
    <div class="list" data-list></div>`;
  const box = root.querySelector('[data-list]');
  const draw = () => {
    const rows = all.filter(m => (!typeFilter || m.type === typeFilter) && matches(m, query));
    box.innerHTML = rows.map(m => `<a class="row" href="#/machines/${encodeURIComponent(m.id)}">
        <span class="row-main">${esc(m.name)}</span>
        <span class="row-sub">${esc(TYPE_LABEL[m.type] || m.type)} · ${J.isJudgeable(m) ? '判別あり' : 'メモのみ'}</span></a>`).join('')
      || `<p class="empty">${all.length ? '当てはまる機種がありません' : 'まだ機種がありません（PC の src\\machines に足して書き出す）'}</p>`;
  };
  draw();
  root.querySelector('[data-q]').addEventListener('input', e => { query = e.target.value; draw(); });
  root.querySelector('[data-types]')?.addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b) return;
    typeFilter = b.dataset.type;
    root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
}

// メモのうち「## 天井・狙い目…」の節は、メモから外して「天井・狙い目」の切り替えに出す
const HUNT_TITLE = /^天井・狙い目/;

const secHtml = (title, body) =>
  `<section class="memo-sec">${title ? `<h3>${esc(title)}</h3>` : ''}<div class="memo-body">${md(body)}</div></section>`;

/** 節の本文を「### 小見出し」で分けて描く（小見出しの前の文は見出し無し） */
function subSecHtml(body) {
  const subs = [{ title: '', lines: [] }];
  for (const line of body.split('\n')) {
    const h = line.match(/^###\s+(.+?)\s*$/);
    if (h) subs.push({ title: h[1], lines: [] });
    else subs[subs.length - 1].lines.push(line);
  }
  return subs.filter(s => s.lines.join('').trim()).map(s => secHtml(s.title, s.lines.join('\n').trim())).join('');
}

/** 天井・狙い目の帯（機種ファイルの [hunt]）。天井ごとに、レートごとの「打たない・プラス・1000円以上」を G数の帯で出す。
 *  帯の長さはいちばん長い天井にそろえる（短縮された天井は短く見える） */
function huntHtml(h) {
  const max = Math.max(...h.bars.map(b => b.ceiling));
  const pct = (g, of) => `${(g / of * 100).toFixed(2)}%`;
  const ticks = c => [...new Set([0, 300, 600].filter(g => g <= c - 150).concat(c))];
  const bar = b => `<div class="hunt-bar">
      <div class="hunt-head"><b>${esc(b.label)}</b><span>天井 ${b.ceiling}G</span></div>
      <div class="hunt-row hunt-axis"><span></span><div class="hunt-scale" style="width:${pct(b.ceiling, max)}">${ticks(b.ceiling).map(g =>
        `<i style="left:${pct(g, b.ceiling)}" class="${g === b.ceiling ? 'end' : ''}">${g}</i>`).join('')}</div></div>
      ${b.rows.map(r => {
        const good = r.good ?? b.ceiling;
        // ▲ の数字が重ならないよう、同じ値なら1つにまとめ、近い（帯の長さに対し13%未満）ときは good の ▲ を2段目に下げる
        const same = r.good != null && r.good === r.plus;
        const low = r.good != null && !same && (r.good - r.plus) / max < 0.13;
        const marks = same ? `<i class="g" style="left:${pct(r.plus, b.ceiling)}">▲${r.plus}</i>`
          : `<i style="left:${pct(r.plus, b.ceiling)}">▲${r.plus}</i>${r.good != null ? `<i class="g${low ? ' low' : ''}" style="left:${pct(r.good, b.ceiling)}">▲${r.good}</i>` : ''}`;
        return `<div class="hunt-row"><span class="hunt-lab">${esc(r.label)}</span><div class="hunt-scale" style="width:${pct(b.ceiling, max)}">
          <div class="hunt-track"><i class="no" style="width:${pct(r.plus, b.ceiling)}"></i><i class="plus" style="width:${pct(good - r.plus, b.ceiling)}"></i><i class="good" style="width:${pct(b.ceiling - good, b.ceiling)}"></i></div>
          <div class="hunt-marks${low ? ' two' : ''}">${marks}</div>
        </div></div>`;
      }).join('')}
      ${b.reason ? `<p class="hunt-why">根拠: ${esc(b.reason)}</p>` : ''}
    </div>`;
  return `<section class="card hunt">
    ${h.bars.map(bar).join('')}
    <div class="hunt-legend"><span><i class="no"></i>打たない</span><span><i class="plus"></i>プラス</span><span><i class="good"></i>1000円以上</span></div>
    ${h.note ? `<p class="hunt-note">${esc(h.note)}</p>` : ''}
  </section>`;
}

function detail(root, id, tab, ctx) {
  const m = catalog.machine(id);
  ctx.setBar({ title: m ? m.name : '機種', back: '#/machines' });
  if (!m) { root.innerHTML = '<p class="empty">この機種は今のデータにありません</p>'; return; }
  const judge = J.isJudgeable(m);
  const sections = m.sections || [];
  const hunt = sections.find(s => HUNT_TITLE.test(s.title));
  const tabs = [['', 'メモ'], ...(judge ? [['spec', 'スペック表']] : []), ...(hunt || m.hunt ? [['hunt', '天井・狙い目']] : [])];
  const cur = tabs.some(t => t[0] === tab) ? tab : '';
  const showSpec = cur === 'spec';
  const base = `#/machines/${encodeURIComponent(m.id)}`;
  const info = [TYPE_LABEL[m.type] || m.type, m.maker, m.aliases?.length ? '別名 ' + m.aliases.join('・') : ''].filter(Boolean).join(' · ');
  const payout = showSpec ? J.payoutHtml(m) : '';
  const memoSecs = sections.filter(s => s !== hunt);
  const memo = memoSecs.length
    ? memoSecs.map(s => secHtml(s.title, s.body)).join('')
    : '<p class="empty">メモはまだありません（PC の機種ファイルの下側に書きます）</p>';
  const body = showSpec ? `<section class="card">${J.specTableHtml(m)}${J.ratioNote(m)}</section>${J.breakdownHtml(m)}`
    : cur === 'hunt' ? (m.hunt ? huntHtml(m.hunt) : '') + (hunt ? subSecHtml(hunt.body) : '') : memo;
  root.innerHTML = `
    <p class="sub">${esc(info)}</p>
    ${cautionCard(m)}
    ${tabs.length > 1 ? `<div class="seg ${tabs.length > 2 ? 'three' : ''}">${tabs.map(([k, label]) =>
      `<a href="${k ? `${base}/${k}` : base}" class="${k === cur ? 'on' : ''}">${label}</a>`).join('')}</div>` : ''}
    ${body}
    ${payout ? `<section class="card"><div class="card-title">機械割</div>${payout}</section>` : ''}
    ${judge ? `<div class="actions dock ${J.canBackcalc(m) ? 'two' : ''}">
      ${J.canBackcalc(m) ? '<button type="button" class="btn" data-bc>ぶどう逆算</button>' : ''}
      <button type="button" class="btn btn-accent" data-start>判別を始める</button></div>` : ''}`;
  // メモの画像は小さく並べ、押すと全画面で見る
  showThumbs(root);
  bindViewer(root);
  root.querySelector('[data-start]')?.addEventListener('click', () => startSession(m));
  root.querySelector('[data-bc]')?.addEventListener('click', () => navigate('#/backcalc/' + encodeURIComponent(m.id)));
}
