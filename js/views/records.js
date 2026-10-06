// 記録。判別とメモを日付ごとに並べ、書き出す（ファイル・CSV・文字列）。
// 記録は書き出すまでこの端末の中にしかないので、まだ書き出していない件数を上に出す
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { kvGet, kvSet, kvDel, recAll, recGet, recPut, recDel } from '../db.js';
import { esc, fmtInt, fmtPct, fmtDate, fmtTime, dayKey, toast, openSheet, confirmDialog } from '../ui.js';
import { navigate } from '../nav.js';
import { askPlace, editMemo, finishSession, currentSession, placeText } from './judge.js';

const STATUS = { playing: '判別中', done: '終了', memo: 'メモ' };
const isPending = r => !r.exportedAt || r.updatedAt > r.exportedAt;

/** 判別中は今の数字で、終えたものは終えた時点の結果で（結果を持たない記録は今の表で計算し直す） */
function snapOf(r) {
  if (r.status === 'memo') return null;
  if (r.status !== 'playing' && r.result) return r.result;
  const m = catalog.machine(r.machineId);
  return m && J.isJudgeable(m) ? J.snapshot(m, { counts: {}, ...r }) : null;
}

function summaryOf(r) {
  if (r.status === 'memo') return r.memo ? r.memo.replace(/\s+/g, ' ').slice(0, 40) : 'メモ';
  const snap = snapOf(r);
  const parts = [`${fmtInt(r.totalG)}G`];
  if (snap) parts.push(`${snap.highLabel}以上 自分 ${fmtPct(snap.highMine)} / 込み ${fmtPct(snap.highAll)}`);
  return parts.join(' · ');
}

export async function render(root, args, ctx) {
  if (args[0]) return detail(root, args[0], ctx);
  ctx.setBar({ title: '記録', right: { label: '書き出し', onClick: () => exportSheet().then(() => navigate('#/records')) } });
  const recs = await recAll();
  const pending = recs.filter(isPending).length;
  let html = pending ? `<div class="card warn-card">まだ書き出していない記録 ${pending}件</div>` : '';
  if (!recs.length) html += '<p class="empty">まだ記録がありません。判別を終えるとここに入ります。</p>';
  let day = '';
  for (const r of recs) {
    const k = dayKey(r.startedAt);
    if (k !== day) { day = k; html += `<div class="day-head">${fmtDate(r.startedAt)}</div>`; }
    const badge = r.status === 'playing' ? '<span class="badge badge-play">判別中</span>' : r.status === 'memo' ? '<span class="badge">メモ</span>' : '';
    html += `<a class="row" href="#/records/${encodeURIComponent(r.id)}">
      <span class="row-main">${esc(placeText(r))}${badge}</span>
      <span class="row-sub">${esc(r.machineName || '機種なし')} · ${esc(summaryOf(r))}</span></a>`;
  }
  root.innerHTML = `<div class="list">${html}</div>`;
}

function barsHtml(snap) {
  const order = [...snap.settings.keys()].reverse();
  const hi = snap.settings.indexOf(snap.highLabel);
  const cell = (probs, i) => `<span class="bar"><i style="width:${probs ? (probs[i] * 100).toFixed(1) : 0}%"></i><em>${probs ? fmtPct(probs[i]) : '—'}</em></span>`;
  return `<section class="card">
    <div class="card-title">設定の確からしさ（${esc(snap.highLabel)}以上: 自分 ${fmtPct(snap.highMine)} / 前任者込み ${fmtPct(snap.highAll)}）</div>
    <div class="bars-head"><span></span><span>自分</span><span>前任者込み</span></div>
    ${order.map(i => `<div class="bars-row ${hi >= 0 && i >= hi ? 'is-high' : ''}"><span class="bars-label">設定${esc(snap.settings[i])}</span>${cell(snap.mine, i)}${cell(snap.all, i)}</div>`).join('')}
  </section>`;
}

function inputsHtml(r, m) {
  const items = m && J.isJudgeable(m) ? J.myItems(m) : Object.keys(r.counts || {}).map(id => ({ id, label: J.LABEL[id] || id }));
  const myG = Math.max(0, (r.totalG || 0) - (r.startG || 0));
  const row = (label, v) => `<div class="kv"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;
  return `<section class="card">
    <div class="card-title">入れた数字</div>
    ${row('前任者のG数（打ち始めG）', fmtInt(r.startG))}
    ${row('前任者のBIG / REG', `${fmtInt(r.prevBig)} / ${fmtInt(r.prevReg)}`)}
    ${row('現在の総G', fmtInt(r.totalG))}
    ${row('自分の消化G', fmtInt(myG))}
    ${items.map(it => row(it.label, fmtInt(r.counts?.[it.id] || 0))).join('')}
    <p class="note">データの版 ${esc(catalog.versionLabel(r.dataVersion))}</p>
  </section>`;
}

async function detail(root, id, ctx) {
  const r = await recGet(id);
  ctx.setBar({ title: r ? (r.machineName || 'メモ') : '記録', back: '#/records' });
  if (!r) { root.innerHTML = '<p class="empty">この記録はありません</p>'; return; }
  const m = catalog.machine(r.machineId);
  const snap = snapOf(r);
  root.innerHTML = `
    <p class="sub">${esc(placeText(r))} · ${fmtDate(r.startedAt)} ${fmtTime(r.startedAt)}${r.endedAt ? '〜' + fmtTime(r.endedAt) : ''}<span class="badge ${r.status === 'playing' ? 'badge-play' : ''}">${STATUS[r.status] || ''}</span></p>
    ${snap ? barsHtml(snap) : ''}
    ${r.status !== 'memo' ? inputsHtml(r, m) : ''}
    <section class="card">
      <div class="card-title">メモ</div>
      <div class="memo-body">${r.memo ? esc(r.memo).replace(/\n/g, '<br>') : '<span class="sub">なし</span>'}</div>
      <button type="button" class="btn btn-block" data-memo style="margin-top:10px">メモを書く</button>
    </section>
    <div class="actions">
      ${r.status === 'playing' ? '<a class="btn btn-accent btn-block" href="#/judge">判別に戻る</a>' : ''}
      ${r.status === 'done' ? '<button type="button" class="btn btn-block" data-resume>判別を再開する</button>' : ''}
      <button type="button" class="btn btn-block" data-place>店舗と台番号を直す</button>
      <button type="button" class="btn btn-danger btn-block" data-del>この記録を消す</button>
    </div>`;
  const again = () => navigate('#/records/' + encodeURIComponent(r.id));
  root.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-memo]')) editMemo(r, again);
    else if (t.closest('[data-place]')) {
      const p = await askPlace({ title: '店舗と台番号', store: r.store, num: r.num, okLabel: '直す' });
      if (p) { r.store = p.store; r.num = p.num; r.updatedAt = Date.now(); await recPut(r); again(); }
    } else if (t.closest('[data-resume]')) {
      const cur = await currentSession();
      if (cur && cur.id !== r.id) {
        const ok = await confirmDialog(`途中の判別（${cur.machineName}）を終了して記録に入れ、こちらを再開しますか？`, [
          { label: '再開する', value: true, kind: 'accent' }, { label: 'やめる', value: false }]);
        if (!ok) return;
        await finishSession(cur);
      }
      r.status = 'playing';
      delete r.endedAt;
      r.updatedAt = Date.now();
      await recPut(r);
      await kvSet('current', r.id);
      navigate('#/judge');
    } else if (t.closest('[data-del]')) {
      const ok = await confirmDialog('この記録を消しますか？ 書き出していなければ元に戻せません。', [
        { label: '消す', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
      if (!ok) return;
      await recDel(r.id);
      if ((await kvGet('current')) === r.id) await kvDel('current');
      navigate('#/records');
    }
  });
}

// ---------------------------------------------------------------- 書き出しと復元

const stamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const payload = recs => ({ format: 'slot-memo-records/1', exportedAt: new Date().toISOString(), records: recs });

/** iPhone は共有メニュー（「ファイルに保存」など）、それ以外はダウンロード */
async function saveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

/** クリップボードへ。使えない端末では選択した状態で見せ、「コピーしました」を押したら書き出し済みにする */
async function copyText(text) {
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

const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function toCsv(recs) {
  const order = Object.keys(J.LABEL);
  const ids = [...new Set(recs.flatMap(r => Object.keys(r.counts || {})))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const head = ['日付', '開始', '終了', '店舗', '台番号', '機種', '状態', '前任者のG数', '前任者のBIG', '前任者のREG', '現在の総G', '自分の消化G',
    ...ids.map(k => J.LABEL[k] || k), '高設定域', '高設定域_自分(%)', '高設定域_前任者込み(%)', 'メモ', 'データの版'];
  const pct = p => (p == null ? '' : (p * 100).toFixed(1));
  const rows = recs.map(r => {
    const snap = snapOf(r);
    return [dayKey(r.startedAt), fmtTime(r.startedAt), r.endedAt ? fmtTime(r.endedAt) : '', r.store || '', r.num || '', r.machineName || '',
      STATUS[r.status] || r.status, r.startG ?? '', r.prevBig ?? '', r.prevReg ?? '', r.totalG ?? '',
      r.status === 'memo' ? '' : Math.max(0, (r.totalG || 0) - (r.startG || 0)),
      ...ids.map(k => r.counts?.[k] ?? ''), snap ? `${snap.highLabel}以上` : '', pct(snap?.highMine), pct(snap?.highAll), r.memo || '', r.dataVersion || ''];
  });
  return [head, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

async function markExported(recs) {
  const now = Date.now();
  for (const r of recs) {
    r.exportedAt = now;
    await recPut(r);
  }
}

function exportSheet() {
  return new Promise(async resolve => {
    const recs = await recAll();
    const sheet = openSheet(`<div class="sheet-title">記録の書き出し（${recs.length}件）</div>
      <div class="dlg-btns">
        <button type="button" class="btn btn-block" data-x="json">ファイルで保存（全部入り）</button>
        <button type="button" class="btn btn-block" data-x="csv">表計算ソフト用（CSV）</button>
        <button type="button" class="btn btn-block" data-x="text">文字列でコピー</button>
        <button type="button" class="btn btn-ghost btn-block" data-x="import">文字列から復元</button>
      </div>`, { onClose: resolve });
    sheet.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'import') { sheet.close(); importSheet(); return; }
      if (!recs.length) { toast('書き出す記録がありません'); return; }
      let ok = false;
      if (x === 'json') ok = await saveFile(`slot-memo-records-${stamp()}.json`, JSON.stringify(payload(recs), null, 1), 'application/json');
      else if (x === 'csv') ok = await saveFile(`slot-memo-records-${stamp()}.csv`, '﻿' + toCsv(recs), 'text/csv');
      else if (x === 'text') ok = await copyText(btoa(encodeURIComponent(JSON.stringify(payload(recs)))));
      if (!ok) return;
      await markExported(recs);
      toast(x === 'text' ? 'コピーしました。メモ帳などに貼って残してください' : '書き出しました');
      sheet.close(true);
    });
  });
}

function importSheet() {
  const sheet = openSheet(`<div class="sheet-title">文字列から復元</div>
    <textarea class="io" rows="7" placeholder="「文字列でコピー」で書き出したものを貼り付け"></textarea>
    <p class="lock-err" data-err hidden></p>
    <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-go>復元する</button></div>`);
  sheet.el.querySelector('[data-go]').addEventListener('click', async () => {
    const err = sheet.el.querySelector('[data-err]');
    try {
      const obj = JSON.parse(decodeURIComponent(atob(sheet.el.querySelector('textarea').value.trim())));
      if (!Array.isArray(obj.records)) throw new Error('記録が見つかりません');
      let n = 0;
      for (const r of obj.records) {
        if (!r || !r.id || !r.startedAt) continue;
        const have = await recGet(r.id);
        if (have && (have.updatedAt || 0) >= (r.updatedAt || 0)) continue;   // 端末のほうが新しければそのまま
        if (r.status === 'playing') r.status = 'done';
        await recPut(r);
        n++;
      }
      sheet.close(true);
      toast(`${n}件を復元しました`);
      navigate('#/records');
    } catch (e) {
      err.hidden = false;
      err.textContent = `読み込めませんでした（${e.message || e}）`;
    }
  });
}
