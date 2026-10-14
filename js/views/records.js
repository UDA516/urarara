// 記録。判別とメモを日付ごとに並べ、書き出す（ファイル・CSV・文字列）。
// 記録は書き出すまでこの端末の中にしかないので、まだ書き出していない件数を上に出す。
// 一覧の行は左へ滑らせると メモ・店舗と台番号・消す が出る（詳細を開かずに直せるように）
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { kvGet, kvSet, kvDel, recAll, recGet, recPut, recDel } from '../db.js';
import { esc, fmtInt, fmtPct, fmtDate, fmtTime, dayKey, toast, openSheet, confirmDialog, copyText, swipeRows } from '../ui.js';
import { navigate } from '../nav.js';
import { askPlace, editMemo, finishSession, currentSession, placeText, fieldLabels } from './judge.js';

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
  // 滑らせたボタンで直したあとは、ここだけ描き直す（navigate だと先頭まで戻ってしまうため）
  const draw = async () => {
    const recs = await recAll();
    const pending = recs.filter(isPending).length;
    let html = pending ? `<div class="card warn-card">まだ書き出していない記録 ${pending}件</div>` : '';
    if (!recs.length) html += '<p class="empty">まだ記録がありません。判別を終えるとここに入ります。</p>';
    let day = '';
    for (const r of recs) {
      const k = dayKey(r.startedAt);
      if (k !== day) { day = k; html += `<div class="day-head">${fmtDate(r.startedAt)}</div>`; }
      const badge = r.status === 'playing' ? '<span class="badge badge-play">判別中</span>' : r.status === 'memo' ? '<span class="badge">メモ</span>' : '';
      html += `<div class="swipe" data-id="${esc(r.id)}">
        <div class="swipe-acts">
          <button type="button" class="swipe-act" data-act="memo">メモ</button>
          <button type="button" class="swipe-act swipe-act-2" data-act="place">店舗・台</button>
          <button type="button" class="swipe-act swipe-act-danger" data-act="del">消す</button>
        </div>
        <a class="row swipe-face" href="#/records/${encodeURIComponent(r.id)}" draggable="false">
          <span class="row-main">${esc(placeText(r))}${badge}</span>
          <span class="row-sub">${esc(r.machineName || '機種なし')} · ${esc(summaryOf(r))}</span></a></div>`;
    }
    if (recs.length) html += '<p class="note">行を左へ滑らせると、メモ・店舗と台番号・消す が出ます。</p>';
    root.innerHTML = `<div class="list">${html}</div>`;
  };
  await draw();
  swipeRows(root, async (act, id) => {
    const r = await recGet(id);
    if (!r) { draw(); return; }
    if (act === 'memo') editMemo(r, draw);
    else if (act === 'place') { if (await editPlace(r)) draw(); }
    else if (act === 'del' && await removeRecord(r)) { toast('記録を消しました'); draw(); }
  });
}

/** 店舗と台番号を直す。直したら true */
async function editPlace(r) {
  const p = await askPlace({ title: '店舗と台番号', store: r.store, num: r.num, okLabel: '直す' });
  if (!p) return false;
  r.store = p.store;
  r.num = p.num;
  r.updatedAt = Date.now();
  await recPut(r);
  return true;
}

/** 記録を消す（確かめてから）。一覧からも消せるので、どの記録かを添えて聞く。消したら true */
async function removeRecord(r) {
  const what = `${fmtDate(r.startedAt)} ${r.machineName || '機種なし'}（${placeText(r)}）`;
  const ok = await confirmDialog(`${r.status === 'playing' ? '判別中の記録です。' : ''}${what} を消しますか？ 書き出していなければ元に戻せません。`, [
    { label: '消す', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
  if (!ok) return false;
  await recDel(r.id);
  if ((await kvGet('current')) === r.id) await kvDel('current');
  return true;
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
  const items = m && J.isJudgeable(m) ? [...J.myItems(m)] : [];
  // 今の機種ファイルに無い項目（項目を分け直す前の記録など）も、数えた回数が消えて見えないように出す
  const have = new Set(items.map(it => it.id));
  for (const id of Object.keys(r.counts || {})) {
    if (!have.has(id) && r.counts[id]) items.push({ id, label: J.LABEL[id] || (m ? `${id}（今の表に無い項目）` : id) });
  }
  const myG = Math.max(0, (r.totalG || 0) - (r.startG || 0));
  const row = (label, v) => `<div class="kv"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;
  const L = fieldLabels(m);   // AT機は「ST / CZ」「通常G」など（機種ファイルの [names]）
  // 総G（AT機。[names] の all）。今の表に無くても、入れてあれば出す
  const allRows = L.startAllG || r.startAllG || r.totalAllG
    ? `${row(`前任者の${L.startAllG || '総G（打ち始め）'}`, fmtInt(r.startAllG))}${row(L.totalAllG || '現在の総G', fmtInt(r.totalAllG))}`
      + row(L.myAllG || '自分の総G', fmtInt(J.myAllGames(r)))
    : '';
  return `<section class="card">
    <div class="card-title">入れた数字</div>
    ${row(`前任者の${L.startG}`, fmtInt(r.startG))}
    ${row(`前任者の${L.prevBig} / ${L.prevReg}`, `${fmtInt(r.prevBig)} / ${fmtInt(r.prevReg)}`)}
    ${row(L.totalG, fmtInt(r.totalG))}
    ${row(L.myG, fmtInt(myG))}
    ${allRows}
    ${items.filter(it => !it.hidden).map(it => { const k = J.countOf(m, it, r.counts); return row(it.label, k == null ? '—' : fmtInt(k)); }).join('')}
    <p class="note">データの版 ${esc(catalog.versionLabel(r.dataVersion))}${r.sharedAt
      ? `。共有された値（${fmtDate(r.sharedAt)} ${fmtTime(r.sharedAt)}）から始めた判別です` : ''}</p>
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
      if (await editPlace(r)) again();
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
      if (await removeRecord(r)) navigate('#/records');
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

const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function toCsv(recs) {
  // 列はジャグラーの項目を決まった順で先に、A タイプの項目（機種ファイルに書いた名前）はその後ろに出てきた順で
  const names = { ...J.LABEL };
  for (const r of recs) {
    const m = catalog.machine(r.machineId);
    if (m && J.isJudgeable(m)) for (const it of J.myItems(m)) names[it.id] ??= it.label;
  }
  const order = Object.keys(names);
  const ids = [...new Set(recs.flatMap(r => Object.keys(r.counts || {})))]
    .sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  // AT機は「前任者のG数」「現在の総G」「自分の消化G」が通常G、「AT機の総G」が CZ・ST・ボーナス中も入れた総G（2026-10-14）
  const head = ['日付', '開始', '終了', '店舗', '台番号', '機種', '状態', '前任者のG数', '前任者のBIG', '前任者のREG', '現在の総G', '自分の消化G',
    'AT機の総G(打ち始め)', 'AT機の総G(現在)', 'AT機の自分の総G',
    ...ids.map(k => names[k] || k), '高設定域', '高設定域_自分(%)', '高設定域_前任者込み(%)', 'メモ', 'データの版'];
  const pct = p => (p == null ? '' : (p * 100).toFixed(1));
  const rows = recs.map(r => {
    const snap = snapOf(r);
    return [dayKey(r.startedAt), fmtTime(r.startedAt), r.endedAt ? fmtTime(r.endedAt) : '', r.store || '', r.num || '', r.machineName || '',
      STATUS[r.status] || r.status, r.startG ?? '', r.prevBig ?? '', r.prevReg ?? '', r.totalG ?? '',
      r.status === 'memo' ? '' : Math.max(0, (r.totalG || 0) - (r.startG || 0)),
      r.startAllG ?? '', r.totalAllG ?? '', r.startAllG == null && r.totalAllG == null ? '' : J.myAllGames(r),
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
        <button type="button" class="btn btn-ghost btn-block" data-x="import">復元する（ファイル・文字列）</button>
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

/** 書き出したものから記録の並びを取り出す。「文字列でコピー」の文字列と、「ファイルで保存」の JSON（中身の貼り付けも）の両方 */
function parseBackup(text) {
  const t = String(text).replace(/^﻿/, '').trim();
  if (!t) throw new Error('何も入っていません');
  let obj;
  try {
    obj = JSON.parse(t.startsWith('{') ? t : decodeURIComponent(atob(t)));
  } catch {
    throw new Error('「ファイルで保存」「文字列でコピー」で書き出したものではないようです');
  }
  if (!Array.isArray(obj?.records)) throw new Error('記録が見つかりません');
  return obj.records;
}

/** 記録を端末に戻す。端末のほうが新しい記録はそのまま。戻した件数 */
async function restore(records) {
  let n = 0;
  for (const r of records) {
    if (!r || !r.id || !r.startedAt) continue;
    const have = await recGet(r.id);
    if (have && (have.updatedAt || 0) >= (r.updatedAt || 0)) continue;   // 端末のほうが新しければそのまま
    if (r.status === 'playing') r.status = 'done';
    await recPut(r);
    n++;
  }
  return n;
}

function importSheet() {
  const sheet = openSheet(`<div class="sheet-title">記録の復元</div>
    <label class="btn btn-block">ファイルを選んで復元（JSON）<input type="file" accept=".json,application/json" hidden data-file-input></label>
    <div class="sheet-label">または文字列を貼り付け</div>
    <textarea class="io" rows="6" placeholder="「文字列でコピー」で書き出したものを貼り付け"></textarea>
    <p class="lock-err" data-err hidden></p>
    <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-go>貼り付けたものから復元</button></div>`);
  const err = sheet.el.querySelector('[data-err]');
  const run = async read => {
    err.hidden = true;
    try {
      const n = await restore(parseBackup(await read()));
      sheet.close(true);
      toast(`${n}件を復元しました`);
      navigate('#/records');
    } catch (e) {
      err.hidden = false;
      err.textContent = `読み込めませんでした（${e.message || e}）`;
    }
  };
  // ファイルの欄は label で包んで開く（隠した欄を click() で開くのが効かない端末があるため）
  const input = sheet.el.querySelector('[data-file-input]');
  input.addEventListener('change', () => { const f = input.files?.[0]; input.value = ''; if (f) run(() => f.text()); });
  sheet.el.querySelector('[data-go]').addEventListener('click', () => run(() => sheet.el.querySelector('textarea').value));
}
