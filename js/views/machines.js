// 機種の一覧と詳細（メモ・スペック表）。詳細から判別・ぶどう逆算へ移れる
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { matches } from '../search.js';
import { esc, md } from '../ui.js';
import { navigate } from '../nav.js';
import { startSession, cautionCard } from './judge.js';

const TYPE_LABEL = { juggler: 'ジャグラー', memo: 'メモ' };
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

function detail(root, id, tab, ctx) {
  const m = catalog.machine(id);
  ctx.setBar({ title: m ? m.name : '機種', back: '#/machines' });
  if (!m) { root.innerHTML = '<p class="empty">この機種は今のデータにありません</p>'; return; }
  const judge = J.isJudgeable(m);
  const showSpec = judge && tab === 'spec';
  const base = `#/machines/${encodeURIComponent(m.id)}`;
  const info = [TYPE_LABEL[m.type] || m.type, m.maker, m.aliases?.length ? '別名 ' + m.aliases.join('・') : ''].filter(Boolean).join(' · ');
  const memo = m.sections?.length
    ? m.sections.map(s => `<section class="memo-sec">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}<div class="memo-body">${md(s.body)}</div></section>`).join('')
    : '<p class="empty">メモはまだありません（PC の機種ファイルの下側に書きます）</p>';
  root.innerHTML = `
    <p class="sub">${esc(info)}</p>
    ${cautionCard(m)}
    ${judge ? `<div class="seg"><a href="${base}" class="${showSpec ? '' : 'on'}">メモ</a><a href="${base}/spec" class="${showSpec ? 'on' : ''}">スペック表</a></div>` : ''}
    ${showSpec ? `<section class="card"><div class="spec-wrap">${J.specTableHtml(m)}</div></section>` : memo}
    ${judge ? `<div class="actions two">
      <button type="button" class="btn" data-bc>ぶどう逆算</button>
      <button type="button" class="btn btn-accent" data-start>判別を始める</button></div>` : ''}`;
  root.querySelector('[data-start]')?.addEventListener('click', () => startSession(m));
  root.querySelector('[data-bc]')?.addEventListener('click', () => navigate('#/backcalc/' + encodeURIComponent(m.id)));
}
