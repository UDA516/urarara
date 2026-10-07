// 判別（座ってから）。前任者情報（G数・BIG・REG）と自分の情報（総G・契機別のボーナス・小役）から
// 設定の確からしさを「自分だけ」と「前任者込み」に分けて出す。計算は juggler.js。
// 入れるたびに端末へ保存する（途中で閉じても続きから）
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { kvGet, kvSet, kvDel, recGet, recPut, recAll } from '../db.js';
import { esc, fmtInt, fmtDen, fmtPct, fmtTime, toast, openSheet, confirmDialog } from '../ui.js';
import { openNumpad, editChain } from '../numpad.js';
import { matches } from '../search.js';
import { navigate } from '../nav.js';

// 「次へ」で送る順。前任者の3つを入れてから総Gへ
const FIELDS = [
  { key: 'startG', title: '前任者のG数（打ち始めG）' },
  { key: 'prevBig', title: '前任者のBIG' },
  { key: 'prevReg', title: '前任者のREG' },
  { key: 'totalG', title: '現在の総G' },
];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const placeText = r => `${r.store || '店舗なし'} · ${r.num ? r.num + '番' : '台番号なし'}`;

/** 途中の判別（無ければ null） */
export async function currentSession() {
  const id = await kvGet('current');
  if (!id) return null;
  const s = await recGet(id);
  return s && s.status === 'playing' ? s : null;
}

/** 判別を終えて記録にする。その時点の結果を残す（あとで表を直しても当時の数字が分かるように） */
export async function finishSession(s) {
  const m = catalog.machine(s.machineId);
  if (m && J.isJudgeable(m)) s.result = J.snapshot(m, s);
  s.status = 'done';
  s.endedAt = Date.now();
  s.updatedAt = s.endedAt;
  await recPut(s);
  if ((await kvGet('current')) === s.id) await kvDel('current');
}

async function pushRecent(id) {
  const list = ((await kvGet('recent')) || []).filter(x => x !== id);
  list.unshift(id);
  await kvSet('recent', list.slice(0, 12));
}

// ---------------------------------------------------------------- 店舗と台番号

// 店舗は自由に入れる。公開するデータには店舗名を入れない（どこで打っているかが分かるため）。
// 候補はこの端末の記録に残っている店舗だけから出す
async function recentStores() {
  const names = (await recAll()).map(r => (r.store || '').trim()).filter(Boolean);
  return [...new Set(names)].slice(0, 8);
}

function placeHtml(recent) {
  return `<div class="sheet-label">店舗</div>
    <input class="search" type="text" maxlength="40" placeholder="店舗名（入れなくてもよい）" autocomplete="off" enterkeyhint="done" data-store>
    ${recent.length ? `<div class="chips">${[...recent, ''].map(x => `<button type="button" class="chip" data-pick-store="${esc(x)}">${esc(x || 'なし')}</button>`).join('')}</div>` : ''}
    <div class="sheet-label">台番号</div>
    <button type="button" class="field" data-num><b data-numv></b></button>`;
}

function wirePlace(el, st, onChange) {
  const input = el.querySelector('[data-store]');
  input.value = st.store || '';
  const paint = () => {
    el.querySelectorAll('[data-pick-store]').forEach(b => b.classList.toggle('on', b.dataset.pickStore === (st.store || '')));
    el.querySelector('[data-numv]').textContent = st.num ? `${st.num}番` : '未入力';
    onChange?.();
  };
  input.addEventListener('input', () => { st.store = input.value.trim() || null; paint(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });   // 「完了」でキーボードを閉じる
  el.addEventListener('click', async e => {
    const sb = e.target.closest('[data-pick-store]');
    if (sb) { st.store = sb.dataset.pickStore || null; input.value = st.store || ''; paint(); return; }
    if (e.target.closest('[data-num]')) {
      const r = await openNumpad({ title: '台番号', value: Number(st.num) || 0, max: 5 });
      if (r) { st.num = r.empty || !r.value ? '' : String(r.value); paint(); }
    }
  });
  paint();
}

/** 機種のデータの注意（そろっていない・合っていないところ）。無ければ空 */
export function cautionCard(m) {
  const list = J.cautions(m);
  return list.length ? `<div class="card warn-card caution"><div class="card-title">この機種のデータの注意</div>
    <ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
}

/** 店舗（自由入力）と台番号（テンキー）を聞く。どちらも無くても決定を押せる。やめたら null。
 *  before は店舗の上に出すもの（データの注意） */
export async function askPlace({ title, store, num = '', okLabel = '始める', before = '' }) {
  const st = { store: store === undefined ? ((await kvGet('lastStore')) ?? null) : store, num };
  const recent = await recentStores();
  return new Promise(resolve => {
    const sheet = openSheet(`<div class="sheet-title">${esc(title)}</div>${before}${placeHtml(recent)}
      <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-ok>${esc(okLabel)}</button></div>`,
      { onClose: resolve });
    wirePlace(sheet.el, st);
    sheet.el.querySelector('[data-ok]').addEventListener('click', async () => {
      if (st.store) await kvSet('lastStore', st.store);
      sheet.close({ store: st.store, num: st.num });
    });
  });
}

/** 判別を始める。prefill は逆算の画面から引き継ぐ前任者情報。始めたら true */
export async function startSession(m, prefill = {}) {
  const place = await askPlace({ title: `${m.name} で始める`, before: cautionCard(m) });
  if (!place) return false;
  const cur = await currentSession();
  if (cur) await finishSession(cur);   // 別の台へ移った。前のものは終わったものとして記録へ
  const now = Date.now();
  const startG = prefill.startG || 0;
  const s = {
    id: newId(), status: 'playing', machineId: m.id, machineName: m.name, dataVersion: catalog.data().version,
    store: place.store, num: place.num, startedAt: now, updatedAt: now, exportedAt: null,
    startG, totalG: startG, prevBig: prefill.prevBig || 0, prevReg: prefill.prevReg || 0, counts: {}, memo: '',
  };
  await recPut(s);
  await kvSet('current', s.id);
  await pushRecent(m.id);
  navigate('#/judge');
  return true;
}

export function editMemo(rec, after) {
  const sheet = openSheet(`<div class="sheet-title">メモ</div>
    <textarea class="memo" rows="6" placeholder="挙動・気づいたこと">${esc(rec.memo || '')}</textarea>
    <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-save>保存</button></div>`);
  sheet.el.querySelector('[data-save]').addEventListener('click', async () => {
    rec.memo = sheet.el.querySelector('textarea').value;
    rec.updatedAt = Date.now();
    await recPut(rec);
    sheet.close(true);
    after?.();
  });
}

/** 機種を選ぶ枠（検索つき） */
export function pickMachine(list, onPick, title = '機種を選ぶ') {
  const sheet = openSheet(`<div class="sheet-title">${esc(title)}</div>
    <input class="search" type="search" placeholder="機種名・読み・略称" data-q><div class="list" data-list></div>`);
  const box = sheet.el.querySelector('[data-list]');
  const draw = q => {
    const rows = list.filter(m => matches(m, q));
    box.innerHTML = rows.map(m => `<button type="button" class="row" data-id="${esc(m.id)}"><span class="row-main">${esc(m.name)}</span></button>`).join('') || '<p class="empty">当てはまる機種がありません</p>';
  };
  draw('');
  sheet.el.querySelector('[data-q]').addEventListener('input', e => draw(e.target.value));
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b) { sheet.close(); onPick(b.dataset.id); }
  });
}

/** 表の無い機種（AT機など）に、メモだけの記録を残す */
async function memoOnly() {
  const st = { store: (await kvGet('lastStore')) ?? null, num: '' };
  const names = catalog.machines().map(m => m.name);
  const recent = await recentStores();
  const sheet = openSheet(`<div class="sheet-title">メモだけ残す</div>
    <div class="sheet-label">機種</div>
    <input class="search" list="memo-machines" placeholder="機種名" data-name>
    <datalist id="memo-machines">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${placeHtml(recent)}
    <div class="sheet-label">メモ</div>
    <textarea class="memo" rows="5" placeholder="挙動・気づいたこと" data-memo></textarea>
    <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-save>保存</button></div>`);
  wirePlace(sheet.el, st);
  sheet.el.querySelector('[data-save]').addEventListener('click', async () => {
    const name = sheet.el.querySelector('[data-name]').value.trim();
    const memo = sheet.el.querySelector('[data-memo]').value;
    if (!name && !memo.trim()) { toast('機種名かメモを入れてください'); return; }
    const m = catalog.machines().find(x => x.name === name);
    const now = Date.now();
    const rec = {
      id: newId(), status: 'memo', machineId: m?.id ?? null, machineName: name, dataVersion: catalog.data().version,
      store: st.store, num: st.num, startedAt: now, updatedAt: now, exportedAt: null, memo,
    };
    await recPut(rec);
    if (st.store) await kvSet('lastStore', st.store);
    sheet.close(true);
    toast('記録に残しました');
  });
}

// ---------------------------------------------------------------- 画面

export async function render(root, args, ctx) {
  const cur = await currentSession();
  if (args[0] === 'pick' || !cur) return renderPicker(root, ctx, cur);
  return renderSession(root, cur, ctx);
}

async function renderPicker(root, ctx, cur) {
  ctx.setBar({ title: '判別する機種', back: cur ? '#/judge' : null });
  const recent = (await kvGet('recent')) || [];
  const rank = id => { const i = recent.indexOf(id); return i < 0 ? 1e9 : i; };
  const list = catalog.machines().filter(J.isJudgeable)
    .sort((a, b) => rank(a.id) - rank(b.id) || a.kana.localeCompare(b.kana, 'ja'));
  root.innerHTML = `
    ${cur ? `<a class="row" href="#/judge" style="margin-bottom:10px"><span class="row-main">途中の判別に戻る</span><span class="row-sub">${esc(cur.machineName)} · ${esc(placeText(cur))}</span></a>` : ''}
    <input class="search" type="search" placeholder="機種名・読み・略称" data-q>
    <div class="list" data-list></div>
    <button type="button" class="btn btn-ghost btn-block" data-memo>表の無い機種でメモだけ残す</button>`;
  const box = root.querySelector('[data-list]');
  const draw = q => {
    const rows = list.filter(m => matches(m, q));
    box.innerHTML = rows.map(m => `<button type="button" class="row" data-id="${esc(m.id)}"><span class="row-main">${esc(m.name)}</span>${recent.includes(m.id) ? '<span class="row-sub">最近使った</span>' : ''}</button>`).join('')
      || `<p class="empty">${list.length ? '当てはまる機種がありません' : '判別できる機種（ジャグラーの型）がまだありません'}</p>`;
  };
  draw('');
  root.querySelector('[data-q]').addEventListener('input', e => draw(e.target.value));
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b) startSession(catalog.machine(b.dataset.id));
  });
  root.querySelector('[data-memo]').addEventListener('click', memoOnly);
}

function renderSession(root, s, ctx) {
  const m = catalog.machine(s.machineId);
  ctx.setBar({ title: s.machineName, right: { label: '機種を変える', href: '#/judge/pick' } });
  if (!m || !J.isJudgeable(m)) {
    root.innerHTML = `<div class="card warn-card">この機種（${esc(s.machineName)}）の判別の表が、今のデータにありません。</div>
      <button type="button" class="btn btn-block" data-end>終了して記録へ</button>`;
    root.querySelector('[data-end]').addEventListener('click', async () => { await finishSession(s); navigate('#/records/' + encodeURIComponent(s.id)); });
    return;
  }

  const items = J.myItems(m);
  const hi = J.highIndex(m);
  const hl = J.highLabel(m);
  const order = [...m.settings.keys()].reverse();   // 設定6 を上に（渡されたカウンターと同じ）
  const field = (key, label) => `<button type="button" class="field" data-edit="${key}"><span class="k">${label}</span><b data-v="${key}"></b></button>`;
  const counter = it => `<div class="counter">
      <span class="c-name">${esc(it.label)}</span>
      <button type="button" class="c-btn minus" data-dec="${it.id}" aria-label="${esc(it.label)}を1減らす">−</button>
      <button type="button" class="c-val" data-edit-count="${it.id}" data-count="${it.id}"></button>
      <button type="button" class="c-btn plus" data-inc="${it.id}" aria-label="${esc(it.label)}を1増やす">＋</button>
      <span class="c-rate" data-rate="${it.id}"></span>
    </div>`;
  const bonusItems = items.filter(i => i.group === 'bonus');
  const roleItems = items.filter(i => i.group === 'role');
  const notes = J.cautions(m);   // 始めるときに出した注意。途中から開いたときのために、たたんで残す

  root.innerHTML = `
    <button type="button" class="place" data-place></button>
    <button type="button" class="summary" data-top aria-label="結果の先頭へ">
      <span><span class="k">${esc(hl)}以上 · 自分</span><b data-sum="mine">—</b></span>
      <span><span class="k">${esc(hl)}以上 · 前任者込み</span><b data-sum="all">—</b></span>
    </button>
    <section class="card">
      <div class="card-title">設定の確からしさ</div>
      <div class="bars-head"><span></span><span>自分</span><span>前任者込み</span></div>
      ${order.map(i => `<div class="bars-row ${i >= hi ? 'is-high' : ''}">
        <span class="bars-label">設定${esc(m.settings[i])}</span>
        <span class="bar"><i data-bar="mine:${i}"></i><em data-pct="mine:${i}"></em></span>
        <span class="bar"><i data-bar="all:${i}"></i><em data-pct="all:${i}"></em></span>
      </div>`).join('')}
      <p class="note">どの設定も同じ割合で入っていると置いた計算です（実際より高設定寄りに出ます）。小役は自分の消化Gのぶんだけを使います。</p>
      ${notes.length ? `<details class="caution-fold"><summary>この機種のデータの注意（${notes.length}件）</summary>
        <ul>${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </section>
    <section class="card">
      <div class="card-title">要素ごと（近い設定）</div>
      <table class="tbl"><thead><tr><th>要素</th><th>自分</th><th>前任者込み</th></tr></thead><tbody>
        ${J.elementRows(m).map(r => `<tr><td>${esc(r.label)}</td><td data-el="mine:${r.c}"></td><td ${r.both ? `data-el="all:${r.c}"` : ''}>${r.both ? '' : '—'}</td></tr>`).join('')}
      </tbody></table>
    </section>
    <section class="card">
      <div class="card-title">前任者（打ち始め時）</div>
      <div class="fields3">${field('startG', 'G数（打ち始めG）')}${field('prevBig', 'BIG')}${field('prevReg', 'REG')}</div>
    </section>
    <section class="card">
      <div class="card-title">自分</div>
      <div class="fields2">${field('totalG', '現在の総G')}<div class="field static"><span class="k">自分の消化G</span><b data-v="myG"></b></div></div>
      <div class="group-title">自分のボーナス（契機）</div>
      ${bonusItems.map(counter).join('')}
      ${roleItems.length ? `<div class="group-title">自分の小役</div>${roleItems.map(counter).join('')}` : ''}
    </section>
    <section class="card">
      <div class="card-title">設定差の表</div>
      <div class="spec-wrap">${J.specTableHtml(m)}</div>
      <p class="note"><span class="mk mk-near">塗り</span>近い設定。BB・RB・合算・BR比率は前任者と自分を合わせた値、ほかの列は自分の値（自分の消化Gと自分の回数）で</p>
    </section>
    <div class="actions">
      <button type="button" class="btn btn-block" data-memo></button>
      <button type="button" class="btn btn-accent btn-block" data-end>終了して記録へ</button>
      <button type="button" class="btn btn-ghost btn-block" data-new>新しく始める</button>
    </div>`;

  const $ = sel => root.querySelector(sel);
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  function update() {
    const myG = J.myGames(s);
    const mineOn = myG > 0;
    const allOn = mineOn || (s.startG || 0) > 0;
    const pm = mineOn ? J.posterior(m, s, false) : null;
    const pa = allOn ? J.posterior(m, s, true) : null;
    setText('[data-sum="mine"]', pm ? fmtPct(J.highShare(m, pm)) : '—');
    setText('[data-sum="all"]', pa ? fmtPct(J.highShare(m, pa)) : '—');
    for (const [kind, probs] of [['mine', pm], ['all', pa]]) {
      m.settings.forEach((_, i) => {
        $(`[data-bar="${kind}:${i}"]`).style.width = probs ? `${(probs[i] * 100).toFixed(1)}%` : '0';
        setText(`[data-pct="${kind}:${i}"]`, probs ? fmtPct(probs[i]) : '—');
      });
    }

    for (const f of FIELDS) setText(`[data-v="${f.key}"]`, fmtInt(s[f.key]));
    setText('[data-v="myG"]', fmtInt(myG));
    for (const it of items) {
      const k = s.counts[it.id] || 0;
      setText(`[data-count="${it.id}"]`, String(k));
      setText(`[data-rate="${it.id}"]`, myG > 0 && k > 0 ? fmtDen(myG / k) : '—');
    }

    const meas = J.measures(m, s);
    root.querySelectorAll('[data-el]').forEach(td => {
      const [kind, c] = td.dataset.el.split(':');
      const v = meas[kind][c];
      const near = J.nearest(m, c, v);
      td.innerHTML = v ? `${fmtDen(v)}${near ? `<small>設定${esc(near.text)}</small>` : ''}` : '—';
    });

    root.querySelectorAll('.spec td.mk-near').forEach(td => td.classList.remove('mk-near'));
    for (const [c, idx] of Object.entries(J.specMarks(m, meas))) {
      idx.forEach(i => $(`[data-spec="${c}:${i}"]`)?.classList.add('mk-near'));
    }

    $('[data-place]').textContent = `${placeText(s)} · ${fmtTime(s.startedAt)}から`;
    $('[data-memo]').textContent = s.memo ? 'メモ（あり）' : 'メモを書く';
  }

  const save = () => {
    s.updatedAt = Date.now();
    recPut(s).catch(e => toast('保存できませんでした: ' + (e.message || e), { ms: 6000 }));
  };

  async function setField(key, v, empty) {
    if (key === 'totalG') {
      const old = s.totalG || 0;
      if (empty || v < old) {
        // 打ち間違いで消化Gが減らないように（渡されたカウンターと同じ確認）
        const useNew = await confirmDialog(`入力された値（${fmtInt(v)}）は、現在の値（${fmtInt(old)}）よりも小さいか未入力です。どちらを採用しますか？`, [
          { label: `新しい値（${fmtInt(v)}）を採用する`, value: true, kind: 'danger' },
          { label: `元の値（${fmtInt(old)}）を維持する`, value: false },
        ]);
        if (!useNew) return;
      }
      s.totalG = v;
    } else {
      s[key] = v;
      if (key === 'startG' && (s.totalG || 0) < v) s.totalG = v;   // 総G は打ち始めG から始まる
    }
    save();
    update();
  }

  root.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-inc]')) || (b = t.closest('[data-dec]'))) {
      const id = b.dataset.inc || b.dataset.dec;
      s.counts[id] = Math.max(0, (s.counts[id] || 0) + (b.dataset.inc ? 1 : -1));
      save();
      update();
    } else if ((b = t.closest('[data-edit-count]'))) {
      const id = b.dataset.editCount;
      const r = await openNumpad({ title: J.LABEL[id] || id, value: s.counts[id] || 0 });
      if (r) { s.counts[id] = Math.max(0, r.value); save(); update(); }
    } else if ((b = t.closest('[data-edit]'))) {
      const start = FIELDS.findIndex(f => f.key === b.dataset.edit);
      await editChain(FIELDS.map(f => ({ title: f.title, get: () => s[f.key] || 0, set: (v, empty) => setField(f.key, Math.max(0, v), empty) })), start);
    } else if (t.closest('[data-top]')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (t.closest('[data-place]')) {
      const p = await askPlace({ title: '店舗と台番号', store: s.store, num: s.num, okLabel: '変える' });
      if (p) { s.store = p.store; s.num = p.num; save(); update(); }
    } else if (t.closest('[data-memo]')) {
      editMemo(s, update);
    } else if (t.closest('[data-end]')) {
      await finishSession(s);
      navigate('#/records/' + encodeURIComponent(s.id));
    } else if (t.closest('[data-new]')) {
      const ok = await confirmDialog('今の判別を終了して記録に入れ、新しく始めますか？', [
        { label: '終了して新しく始める', value: true, kind: 'accent' },
        { label: 'やめる', value: false },
      ]);
      if (!ok) return;
      await finishSession(s);
      navigate('#/judge/pick');
    }
  });

  update();
}
