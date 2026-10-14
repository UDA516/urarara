// 判別（座ってから）。前任者情報（G数・BIG・REG）と自分の情報（総G・契機別のボーナス・小役）から
// 設定の確からしさを「自分だけ」と「前任者込み」に分けて出す。計算は juggler.js。
// 入れるたびに端末へ保存する（途中で閉じても続きから）
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { kvGet, kvSet, kvDel, recGet, recPut, recAll } from '../db.js';
import { esc, fmtInt, fmtDen, fmtPct, fmtDate, fmtTime, toast, openSheet, confirmDialog, copyText, rememberFolds } from '../ui.js';
import { openNumpad, editChain } from '../numpad.js';
import { matches } from '../search.js';
import { navigate } from '../nav.js';
import { makeShare, readShare } from '../share.js';

/** 前任者・自分の欄の名前。BIG・REG の場所に数えるものと G数の呼び名は機種ファイルの [names]
 *  （AT機は「ST」「CZ」「通常G」など。2026-10-13）。key は記録の項目名（startG・prevBig・prevReg・totalG のまま）。
 *  [names] の all がある機種（AT機の総G。2026-10-14）は、総G の打ち始め・現在（startAllG・totalAllG）も入れる */
export function fieldLabels(m) {
  const N = J.names(m);
  return {
    startG: N.games ? `${N.games}（打ち始め）` : 'G数（打ち始めG）',
    prevBig: N.big, prevReg: N.reg,
    totalG: N.games ? `現在の${N.games}` : '現在の総G',
    myG: N.games ? `自分の${N.games}` : '自分の消化G',
    ...(N.all ? { startAllG: `${N.all}（打ち始め）`, totalAllG: `現在の${N.all}`, myAllG: `自分の${N.all}` } : {}),
  };
}

/** 「次へ」で送る順。前任者の3つを入れてから総Gへ。総G もある機種は、メニューで並んで見える通常G と総G を続けて */
const fieldsOf = m => {
  const L = fieldLabels(m);
  const all = !!L.startAllG;
  return [
    { key: 'startG', title: `前任者の${L.startG}` },
    ...(all ? [{ key: 'startAllG', title: `前任者の${L.startAllG}` }] : []),
    { key: 'prevBig', title: `前任者の${L.prevBig}` },
    { key: 'prevReg', title: `前任者の${L.prevReg}` },
    { key: 'totalG', title: L.totalG },
    ...(all ? [{ key: 'totalAllG', title: L.totalAllG }] : []),
  ];
};

/** 現在の欄と、その打ち始めの欄（現在は打ち始めより小さくしない） */
const START_OF = { totalG: 'startG', totalAllG: 'startAllG' };

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

// 始める枠を出しているあいだ。機種の行を二度押しすると枠が2つ開き、残った枠で押すと、
// 今始めた判別が 0回のまま終了して記録に入ってしまうため、2つ目は開かない
let starting = false;

/** 判別を始める。prefill は逆算の画面から引き継ぐ前任者情報（startG・prevBig・prevReg）か、
 *  共有された値（G数の欄・counts・sharedAt と、枠の title・before・店舗と台番号）。始めたら true */
export async function startSession(m, prefill = {}) {
  if (starting) return false;
  starting = true;
  try {
    return await beginSession(m, prefill);
  } finally {
    starting = false;
  }
}

async function beginSession(m, prefill) {
  const place = await askPlace({
    title: prefill.title || `${m.name} で始める`, store: prefill.store || undefined, num: prefill.num || '',
    before: (prefill.before || '') + cautionCard(m),
  });
  if (!place) return false;
  const cur = await currentSession();
  if (cur) await finishSession(cur);   // 別の台へ移った。前のものは終わったものとして記録へ
  const now = Date.now();
  const startG = prefill.startG || 0;
  const all = prefill.startAllG != null || prefill.totalAllG != null;   // AT機の総G（共有された値だけ）
  const s = {
    id: newId(), status: 'playing', machineId: m.id, machineName: m.name, dataVersion: catalog.data().version,
    store: place.store, num: place.num, startedAt: now, updatedAt: now, exportedAt: null,
    startG, totalG: Math.max(prefill.totalG || 0, startG), prevBig: prefill.prevBig || 0, prevReg: prefill.prevReg || 0,
    ...(all ? { startAllG: prefill.startAllG || 0, totalAllG: Math.max(prefill.totalAllG || 0, prefill.startAllG || 0) } : {}),
    counts: { ...prefill.counts }, memo: '',
    ...(prefill.sharedAt ? { sharedAt: prefill.sharedAt } : {}),
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

// ---------------------------------------------------------------- 共有（短い文字列 SM2.…。share.js）

/** 途中の判別の値を共有の文字列にして、コピーする・送る */
function shareSheet(s) {
  const st = { withPlace: false };
  const sheet = openSheet(`<div class="sheet-title">判別の値を共有</div>
    <p class="note">機種と、前任者・自分の G数と回数を短い文字列にします。相手は台メモの判別の「共有された値で始める」で入れます（メモは入れません）</p>
    <div class="chips"><button type="button" class="chip" data-with-place>店舗・台番号も入れる（${esc(placeText(s))}）</button></div>
    <p class="lock-err" data-err hidden></p>
    <div class="dlg-btns">
      <button type="button" class="btn btn-accent btn-block" data-copy>コピーする</button>
      ${navigator.share ? '<button type="button" class="btn btn-block" data-send>送る（LINE など）</button>' : ''}
    </div>`);
  const err = sheet.el.querySelector('[data-err]');
  sheet.el.addEventListener('click', async e => {
    const chip = e.target.closest('[data-with-place]');
    if (chip) { st.withPlace = !st.withPlace; chip.classList.toggle('on', st.withPlace); return; }
    const send = e.target.closest('[data-send]');
    if (!send && !e.target.closest('[data-copy]')) return;
    err.hidden = true;
    let text;
    try {
      text = await makeShare(s, st);
    } catch (x) {
      err.hidden = false;
      err.textContent = x.message || String(x);
      return;
    }
    if (send) {
      try {
        await navigator.share({ text });
      } catch (x) {
        if (x.name !== 'AbortError') { err.hidden = false; err.textContent = '送れませんでした。「コピーする」で貼り付けてください'; }
        return;
      }
      sheet.close(true);
    } else {
      if (!(await copyText(text))) return;
      sheet.close(true);
      toast('コピーしました。相手は判別の「共有された値で始める」から入れます');
    }
  });
}

/** 共有の文字列を受け取り、その値で新しく判別を始める（機種を選ぶ画面から） */
function importSheet() {
  const canRead = !!navigator.clipboard?.readText;
  const sheet = openSheet(`<div class="sheet-title">共有された値で始める</div>
    <p class="note">相手が「共有する」で作った文字列（SM2. で始まる）を読み込み、その値で新しく判別を始めます</p>
    ${canRead ? '<button type="button" class="btn btn-block" data-clip>コピーした文字列を読む</button>' : ''}
    <div class="sheet-label">${canRead ? 'または貼り付け' : '貼り付け'}</div>
    <textarea class="io" rows="4" placeholder="SM2. で始まる文字列"></textarea>
    <p class="lock-err" data-err hidden></p>
    <div class="dlg-btns"><button type="button" class="btn btn-accent btn-block" data-go>読み込む</button></div>`);
  const err = sheet.el.querySelector('[data-err]');
  const run = async get => {
    err.hidden = true;
    let shared;
    try {
      shared = await readShare(await get());
    } catch (x) {
      err.hidden = false;
      err.textContent = x.message || String(x);
      return;
    }
    sheet.close(true);
    startShared(shared);
  };
  sheet.el.querySelector('[data-clip]')?.addEventListener('click', () => run(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      throw new Error('コピーした文字列を読めませんでした。下の欄に貼り付けてください');
    }
  }));
  sheet.el.querySelector('[data-go]').addEventListener('click', () => run(() => sheet.el.querySelector('textarea').value));
}

/** 読み込んだ値を見せて、店舗と台番号を聞いてから始める。途中の判別は、ほかの台で始めるときと同じく終了して記録へ */
async function startShared(x) {
  const { m, fields: f } = x;
  const L = fieldLabels(m);
  const cur = await currentSession();
  const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  const when = x.sharedAt ? `（${fmtDate(x.sharedAt)} ${fmtTime(x.sharedAt)}）` : '';
  const before = `<div class="card">
      <div class="card-title">共有された値${when}</div>
      ${row(`前任者の${L.startG}`, fmtInt(f.startG))}
      ${row(`前任者の${L.prevBig} / ${L.prevReg}`, `${fmtInt(f.prevBig)} / ${fmtInt(f.prevReg)}`)}
      ${row(L.myG, fmtInt(J.myGames(f)))}
      ${L.myAllG ? row(L.myAllG, fmtInt(J.myAllGames(f))) : ''}
      ${row('回数の入った項目', `${Object.keys(x.counts).length}`)}
      ${x.otherVersion ? `<p class="note">共有した側とデータの版が違います（相手は ${esc(catalog.versionLabel(x.otherVersion))}）。今の表にある項目だけを入れます</p>` : ''}
      ${x.dropped ? `<p class="note">今の表に無い項目が${x.dropped}つあったので、入れません</p>` : ''}
    </div>
    ${cur ? `<p class="note">途中の判別（${esc(cur.machineName)}）は終了して記録に入ります</p>` : ''}`;
  startSession(m, { ...f, counts: x.counts, sharedAt: x.sharedAt, store: x.store, num: x.num, title: `${m.name} を共有された値で始める`, before });
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
    <button type="button" class="row" data-share-in style="margin-bottom:10px"><span class="row-main">共有された値で始める</span><span class="row-sub">もらった文字列を読み込む（機種も入っているので選ばなくてよい）</span></button>
    <input class="search" type="search" placeholder="機種名・読み・略称" data-q>
    <div class="list" data-list></div>
    <button type="button" class="btn btn-ghost btn-block" data-memo>表の無い機種でメモだけ残す</button>`;
  const box = root.querySelector('[data-list]');
  const draw = q => {
    const rows = list.filter(m => matches(m, q));
    box.innerHTML = rows.map(m => `<button type="button" class="row" data-id="${esc(m.id)}"><span class="row-main">${esc(m.name)}</span>${recent.includes(m.id) ? '<span class="row-sub">最近使った</span>' : ''}</button>`).join('')
      || `<p class="empty">${list.length ? '当てはまる機種がありません' : '判別できる機種がまだありません'}</p>`;
  };
  draw('');
  root.querySelector('[data-q]').addEventListener('input', e => draw(e.target.value));
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-id]');
    if (b) startSession(catalog.machine(b.dataset.id));
  });
  root.querySelector('[data-memo]').addEventListener('click', memoOnly);
  root.querySelector('[data-share-in]').addEventListener('click', importSheet);
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
  const FIELDS = fieldsOf(m);
  const L = fieldLabels(m);
  const N = J.names(m);
  const hi = J.highIndex(m);
  const order = [...m.settings.keys()].reverse();   // 設定6 を上に（渡されたカウンターと同じ）
  const field = (key, label) => `<button type="button" class="field" data-edit="${key}"><span class="k">${label}</span><b data-v="${key}"></b></button>`;
  // A タイプの G数の欄（ボーナスゲーム中のG数など。その組の小役の分母）は、カウンターでなくテンキーで入れる欄。
  // 後から内訳が分かる組: 合算と見られる種別はカウンター（合算は種別が全部分かると種別の和になり、±を隠す。update）。
  // 単独では見られない種別（hidden）は欄を出さず、まとめた行（rest）は数える欄ではなく 合算 − 分かった種別 を出す行。
  // 小役・合算は、数字が入るまで「—」（数えていない。計算に入れない）。
  // G数の欄でも、ゾーンに届いた回数・レア役の回数のようなもの（counter）は ± で数える（AT機。2026-10-13）
  const counter = it => (it.group === 'games' && !it.counter
    ? `<button type="button" class="field c-games" data-edit-count="${it.id}"><span class="k">${esc(it.short)}</span><b data-count="${it.id}"></b></button>`
    : it.hidden ? ''
    : it.group === 'rest'
    ? `<div class="counter c-sum">
      <span class="c-name">${esc(it.short)}</span><span></span>
      <span class="c-val" data-count="${it.id}"></span><span></span>
      <span class="c-rate" data-rate="${it.id}"></span>
    </div>`
    : `<div class="counter" data-counter="${it.id}">
      <span class="c-name">${esc(it.short ?? it.label)}</span>
      <button type="button" class="c-btn minus" data-dec="${it.id}" aria-label="${esc(it.label)}を1減らす">−</button>
      <button type="button" class="c-val" data-edit-count="${it.id}" data-count="${it.id}"></button>
      <button type="button" class="c-btn plus" data-inc="${it.id}" aria-label="${esc(it.label)}を1増やす">＋</button>
      <span class="c-rate" data-rate="${it.id}"></span>
    </div>`);
  // 組ごとに見出しを付ける。ジャグラーはボーナス（契機）と小役の2つ、A タイプは機種ファイルの組（sec）。
  // A タイプで契機の内訳が無いボーナス（組に BIG・REG が1つだけ）は、まとめて「ボーナス」の組に（AT機は「ST・CZ」のように）。
  // 回数を計算に入れない組（ref）は「（内訳）」（中身は契機でなく種類のことが多いため）
  const sections = [];
  for (const it of items) {
    const title = it.sec ? (it.group === 'bonus' ? (J.plainBonus(m, it) ? J.mainTitle(m) : `${it.sec}（${it.ref ? '内訳' : '契機'}）`) : it.sec)
      : (it.group === 'bonus' ? '自分のボーナス（契機）' : '自分の小役');
    let sec = sections.find(x => x.title === title);
    if (!sec) sections.push(sec = { title, items: [] });
    sec.items.push(it);
  }
  const hintNote = it => `<p class="note">「${esc(it.short)}」を1回でも数えたら、${it.note ? `${esc(it.note)}として` : ''}`
    + `設定${it.excludes.map(i => esc(m.settings[i])).join('・')}を外して計算します</p>`;
  // その設定では出ないボーナス（A タイプの flags 0。高設定でしか出ない契機）
  const settingsText = idx => `設定${idx.map(i => m.settings[i]).join('・')}`;
  const neverNote = it => `<p class="note">「${esc(it.short)}」は${esc(settingsText(J.never(m, it)))}では出ないので、1回でも数えたらその設定を外して計算します</p>`;
  const PER = { big: N.big, reg: N.reg };   // 数えるだけの項目の割合の分母（per）
  // 回数を計算に入れない組（ref。AT機の CZ は ST と重なる）。内訳が2つ以上なら、その割合だけ入れる
  const refNote = sec => {
    const parts = sec.items.filter(it => it.ref);
    if (!parts.length) return '';
    const name = esc(parts[0].sec);
    return `<p class="note">${name}の回数は、ほかの項目と重なるので計算に入れません（前任者の分も。近い設定だけ出します）。`
      + `${parts.length > 1 ? `${parts.map(it => `「${esc(it.short)}」`).join('・')}の割合は計算に入れます` : ''}</p>`;
  };
  // ± で数える分母の欄（counter）。分母を数え始めたら、その組の項目も数えているので、「—」の項目を 0回にする（countFrom）
  const rolesOf = id => items.filter(it => it.group === 'role' && it.per === id);
  const counterIds = new Set(items.filter(it => it.group === 'games' && it.counter).map(it => it.id));
  const countFrom = id => {
    if (!counterIds.has(id) || !(s.counts[id] > 0)) return;
    for (const it of rolesOf(id)) if (!Number.isFinite(s.counts[it.id])) s.counts[it.id] = 0;
  };
  const countNote = it => `<p class="note">右の％は「${esc(it.short)}」に対する割合です。「${esc(it.short)}」を＋で数えると、`
    + `${rolesOf(it.id).map(x => `「${esc(x.short)}」`).join('・')}も 0回から数え始めます（「—」でなくなる）</p>`;
  // 通常時と AT中で分けて数える小役（2026-10-14。AT中も見分けられる共通ベルなど）。AT中の分母は 自分の総G − 自分の通常G
  const atNote = it => {
    const base = items.find(x => x.id === it.of);
    const b = esc(base?.short ?? ''), a = esc(it.short);
    return `<p class="note">「${b}」は${esc(L.myG)}、「${a}」は${esc(L.myAllG ?? '')} − ${esc(L.myG)}（今 <b data-v="atG"></b>G。`
      + `${esc(L.totalAllG ?? '')}も入れ直す）で割ります。「${a}」が「—」のあいだは「${b}」だけで判別します。`
      + '要素ごと・設定差の表は、数えているほうを合わせた値です</p>';
  };
  // 後から内訳が分かる組の読み方（ユーザーの指示 2026-10-08。台のデータ表示は合算を最初から、種別は条件を満たすと見せる）
  const splitNote = sum => {
    const vis = items.filter(it => it.split === sum.id && it.group === 'role' && !it.hidden).map(it => `「${esc(it.short)}」`).join('・');
    const rest = items.find(it => it.group === 'rest' && it.split === sum.id);
    return `<p class="note">${esc(sum.short)}はいつも数えます。${vis}は見られるようになったら、打ち始めからの回数を入れます`
      + `（それまでは「—」＝分からない。0回とは別）。${rest
        ? `${vis}が分かると「${esc(rest.short)}」（${esc(sum.short)} − ${vis}）を出します`
        : `全部入れると${esc(sum.short)}はその和になります`}</p>`;
  };
  // 小役の「—」（ユーザーと決めたこと 2026-10-08）
  const dashNote = items.some(J.optional)
    ? '<p class="note">小役は、押していない欄は「—」（数えていない）で、計算に入れません。数え始めたら 0回も「引かなかった」として入れます。'
      + 'テンキーで C を押して決定すると「—」に戻ります。ボーナスは 0回 ＝ 引かなかった です</p>'
    : '';
  // 縦に長いので、見出しを押してたためる（ユーザーの指示 2026-10-08。A タイプで始め、ジャグラーも同じに）。
  // 開け閉めは機種ごとに端末に覚える。ボーナスの組は、たたんでも回数が分かるように見出しに合計を出す
  const fold = (key, head, body) => `<details class="fold" data-fold="${esc(key)}" open>${head}${body}</details>`;
  const sectionHtml = (sec, k) => {
    const per = sec.items.find(it => PER[it.per])?.per;
    const body = sec.items.map(counter).join('')
      + (per ? `<p class="note">右の％は、自分の ${PER[per]} の回数に対する割合です</p>` : '')
      + refNote(sec)
      + sec.items.filter(it => it.group === 'games' && it.counter).map(countNote).join('')
      + sec.items.filter(it => it.of).map(atNote).join('')
      + sec.items.filter(it => it.group === 'bonus' && J.never(m, it).length).map(neverNote).join('')
      + sec.items.filter(it => it.group === 'hint').map(hintNote).join('')
      + sec.items.filter(it => it.group === 'sum').map(splitNote).join('');
    const sum = sec.items.some(it => it.group === 'bonus') ? `<span class="fold-sum" data-fold-sum="${k}"></span>` : '';
    return fold(`cnt:${sec.title}`, `<summary class="group-title">${esc(sec.title)}${sum}</summary>`, body);
  };
  // 要素ごと・設定差の表のカード。中が組に分かれていれば（A タイプ）組ごとに、1つの表なら（ジャグラー。
  // 並びは元の HTML のまま）カードの見出しでまるごとたたむ
  const card = (key, title, body, grouped) => `<section class="card">${grouped
    ? `<div class="card-title">${title}</div>${body}`
    : fold(key, `<summary class="card-title">${title}</summary>`, body)}</section>`;
  // 要素ごとの表。行に組（sec）があれば組ごとの表にする。前任者込みの列は、その列のある組だけ
  const elTable = (rows, both) => `<table class="tbl"><thead><tr><th>要素</th><th>自分</th>${both ? '<th>前任者込み</th>' : ''}</tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.label)}</td><td data-el="mine:${r.c}"${r.pct ? ' data-pct-el' : ''}></td>${both ? `<td ${r.both ? `data-el="all:${r.c}"` : ''}>${r.both ? '' : '—'}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
  const elGroups = [];
  for (const r of J.elementRows(m)) {
    let g = elGroups.find(x => x.title === (r.sec || ''));
    if (!g) elGroups.push(g = { title: r.sec || '', rows: [] });
    g.rows.push(r);
  }
  const elementHtml = elGroups.map(g => (g.title
    ? fold(`el:${g.title}`, `<summary class="fold-title">${esc(g.title)}</summary>`, elTable(g.rows, g.rows.some(r => r.both)))
    : elTable(g.rows, true))).join('');
  const notes = J.cautions(m);   // 始めるときに出した注意。途中から開いたときのために、たたんで残す
  // 設定差の表で前任者と合わせた値で塗る列の名前（[names] があればその名前。AT機は合算・BR比率が無い）
  const withPrevText = [m.names?.big || 'BB', m.names?.reg || 'RB', ...(J.hasCombo(m) ? ['合算', 'BR比率'] : [])].join('・');

  root.innerHTML = `
    <button type="button" class="place" data-place></button>
    <button type="button" class="summary" data-top aria-label="結果の先頭へ">
      <span><span class="k">近似の設定 · 自分</span><b data-sum="mine">—</b><span class="sum-p" data-sum-p="mine"></span></span>
      <span><span class="k">近似の設定 · 前任者込み</span><b data-sum="all">—</b><span class="sum-p" data-sum-p="all"></span></span>
    </button>
    <section class="card">
      <div class="card-title">設定の確からしさ</div>
      <div class="bars-head"><span></span><span>自分</span><span>前任者込み</span></div>
      ${order.map(i => `<div class="bars-row ${i >= hi ? 'is-high' : ''}">
        <span class="bars-label">設定${esc(m.settings[i])}</span>
        <span class="bar"><i data-bar="mine:${i}"></i><em data-pct="mine:${i}"></em></span>
        <span class="bar"><i data-bar="all:${i}"></i><em data-pct="all:${i}"></em></span>
      </div>`).join('')}
      <p class="note excl" data-excl hidden></p>
      <p class="note">どの設定も同じ割合で入っていると置いた計算です（実際より高設定寄りに出ます）。小役は自分の消化Gのぶんだけを使います。</p>
      ${notes.length ? `<details class="caution-fold"><summary>この機種のデータの注意（${notes.length}件）</summary>
        <ul>${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </section>
    ${card('el:all', '要素ごと（近い設定）', elementHtml, elGroups.some(g => g.title))}
    <section class="card">
      <div class="card-title">前任者（打ち始め時）</div>
      ${L.startAllG
        ? `<div class="fields2">${field('startG', esc(L.startG))}${field('startAllG', esc(L.startAllG))}${field('prevBig', esc(L.prevBig))}${field('prevReg', esc(L.prevReg))}</div>`
        : `<div class="fields3">${field('startG', esc(L.startG))}${field('prevBig', esc(L.prevBig))}${field('prevReg', esc(L.prevReg))}</div>`}
    </section>
    <section class="card">
      <div class="card-title">自分</div>
      <div class="fields2">${field('totalG', esc(L.totalG))}<div class="field static"><span class="k">${esc(L.myG)}</span><b data-v="myG"></b></div>
        ${L.totalAllG ? `${field('totalAllG', esc(L.totalAllG))}<div class="field static"><span class="k">${esc(L.myAllG)}</span><b data-v="myAllG"></b></div>` : ''}</div>
      ${sections.map(sectionHtml).join('')}
      ${dashNote}
    </section>
    ${card('spec:all', '設定差の表', `${J.specTableHtml(m)}
      <p class="note"><span class="mk mk-near">塗り</span>近い設定。${esc(withPrevText)}は前任者と自分を合わせた値、ほかの列は自分の値（${esc(L.myG)}と自分の回数${
        items.some(it => it.of) ? '。AT中も数える列は、AT中のG数と回数も足す' : ''}）で</p>`,
      J.specGroups(m).some(g => g.title))}
    <div class="actions">
      <button type="button" class="btn btn-block" data-memo></button>
      <button type="button" class="btn btn-accent btn-block" data-end>終了して記録へ</button>
      <button type="button" class="btn btn-ghost btn-block" data-new>新しく始める</button>
      <button type="button" class="btn btn-ghost btn-block" data-share-out>値を共有する</button>
    </div>`;

  rememberFolds(root, `judge:${m.id}`);

  const $ = sel => root.querySelector(sel);
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  function update() {
    const myG = J.myGames(s);
    const mineOn = myG > 0;
    const allOn = mineOn || (s.startG || 0) > 0;
    const pm = mineOn ? J.posterior(m, s, false) : null;
    const pa = allOn ? J.posterior(m, s, true) : null;
    // 上の要約は、いちばん確からしい設定とその割合（ユーザーの指示 2026-10-10。前は「4以上」の割合）
    for (const [kind, probs] of [['mine', pm], ['all', pa]]) {
      const top = probs && J.topSetting(m, probs);
      setText(`[data-sum="${kind}"]`, top ? `設定${top.text}` : '—');
      setText(`[data-sum-p="${kind}"]`, top ? `${top.idx.length > 1 ? '各' : ''}${fmtPct(top.p)}` : '');
    }
    for (const [kind, probs] of [['mine', pm], ['all', pa]]) {
      m.settings.forEach((_, i) => {
        $(`[data-bar="${kind}:${i}"]`).style.width = probs ? `${(probs[i] * 100).toFixed(1)}%` : '0';
        setText(`[data-pct="${kind}:${i}"]`, probs ? fmtPct(probs[i]) : '—');
      });
    }

    // 外した理由: 示唆と、その設定では出ないボーナスを数えたこと
    const ex = J.excluded(m, s);
    const hints = ex.by.filter(it => it.group === 'hint').map(it => it.label);
    const nevers = ex.by.filter(it => it.group !== 'hint').map(it => `${it.label}（${settingsText(J.never(m, it))}では出ない）`);
    $('[data-excl]').hidden = !ex.by.length;
    setText('[data-excl]', ex.by.length
      ? `${[hints.length ? `示唆（${hints.join('・')}）` : '', ...nevers].filter(Boolean).join('・')}で、`
        + `${settingsText([...ex.idx].sort((a, b) => a - b))}を外しています` : '');

    for (const f of FIELDS) setText(`[data-v="${f.key}"]`, fmtInt(s[f.key]));
    setText('[data-v="myG"]', fmtInt(myG));
    setText('[data-v="myAllG"]', fmtInt(J.myAllGames(s)));
    root.querySelectorAll('[data-v="atG"]').forEach(el => { el.textContent = fmtInt(J.myAtGames(s)); });
    const meas = J.measures(m, s);
    // 自分の確率 1/x。分母は自分の消化G（A タイプは項目の G数の欄のこともある）。
    // A タイプの示唆・数えるだけの項目は、per が "big"・"reg" なら自分の BIG・REG に対する割合。合算・まとめた行は measures のもの
    const rateText = (it, k) => {
      if (PER[it.per]) { const own = meas.st.own[it.per]; return own > 0 ? fmtPct(k / own) : '—'; }
      if (it.group === 'sum' || it.group === 'rest') return fmtDen(meas.mine[it.id]);
      if (it.group === 'games') return '';
      if (it.group !== 'bonus' && it.group !== 'role') return '—';
      const g = J.gamesOf(it, s);   // AT中の欄（of）は 自分の総G − 自分の通常G
      // ± で数える分母の欄（到達の回数など）に対する項目は %（0回も 0%）
      if (it.per && counterIds.has(it.per)) return g > 0 && k != null ? fmtPct(k / g) : '—';
      return g > 0 && k > 0 ? fmtDen(g / k) : '—';
    };
    for (const it of items) {
      const k = J.countOf(m, it, s.counts);
      setText(`[data-count="${it.id}"]`, it.group === 'games' ? fmtInt(k) : k == null ? '—' : String(k));
      setText(`[data-rate="${it.id}"]`, rateText(it, k));
    }
    // 後から内訳が分かる組で、見られる種別が全部分かれば合算は種別の和（±を隠し、押しても直せない）
    for (const sp of J.splits(m)) {
      root.querySelector(`[data-counter="${sp.sum.id}"]`)?.classList.toggle('fixed', !J.splitState(sp, s.counts).open);
    }
    sections.forEach((sec, k) => setText(`[data-fold-sum="${k}"]`,
      `計${sec.items.filter(it => it.group === 'bonus').reduce((a, it) => a + (s.counts[it.id] || 0), 0)}回`));

    root.querySelectorAll('[data-el]').forEach(td => {
      const [kind, c] = td.dataset.el.split(':');
      const v = meas[kind][c];
      const near = J.nearest(m, c, v);
      // 割合（%）で書いた項目は % で（v は 1/N の N）
      td.innerHTML = v ? `${td.hasAttribute('data-pct-el') ? fmtPct(1 / v) : fmtDen(v)}${near ? `<small>設定${esc(near.text)}</small>` : ''}` : '—';
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
    if (START_OF[key]) {
      const old = s[key] || 0;
      if (empty || v < old) {
        // 打ち間違いで消化Gが減らないように（渡されたカウンターと同じ確認）。AT機の総G も同じ
        const useNew = await confirmDialog(`入力された値（${fmtInt(v)}）は、現在の値（${fmtInt(old)}）よりも小さいか未入力です。どちらを採用しますか？`, [
          { label: `新しい値（${fmtInt(v)}）を採用する`, value: true, kind: 'danger' },
          { label: `元の値（${fmtInt(old)}）を維持する`, value: false },
        ]);
        if (!useNew) return;
      }
      s[key] = v;
    } else {
      s[key] = v;
      // 総G は打ち始めG から始まる（AT機の総G も、その打ち始めから）
      const now = Object.keys(START_OF).find(k => START_OF[k] === key);
      if (now && (s[now] || 0) < v) s[now] = v;
    }
    save();
    update();
  }

  root.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-inc]')) || (b = t.closest('[data-dec]'))) {
      // 「—」から＋で1（数え始め）。「—」は−で変えない
      const id = b.dataset.inc || b.dataset.dec;
      const cur = Number.isFinite(s.counts[id]) ? s.counts[id] : null;
      if (b.dataset.dec && cur == null) return;
      s.counts[id] = Math.max(0, (cur ?? 0) + (b.dataset.inc ? 1 : -1));
      countFrom(id);
      save();
      update();
    } else if ((b = t.closest('[data-edit-count]'))) {
      // 小役・合算はテンキーで 0 も入れられ（数えて0回）、C で消して決定すると「—」（数えていない）に戻る
      if (b.closest('.counter.fixed')) return;   // 種別の和になった合算
      const id = b.dataset.editCount;
      const opt = J.optional(items.find(it => it.id === id) || {});
      const cur = Number.isFinite(s.counts[id]) ? s.counts[id] : null;
      const r = await openNumpad({ title: J.itemLabel(m, id), value: opt ? cur : cur ?? 0, emptyText: opt ? '—' : null });
      if (!r) return;
      if (opt && r.empty) delete s.counts[id];
      else s.counts[id] = Math.max(0, r.value);
      countFrom(id);
      save();
      update();
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
    } else if (t.closest('[data-share-out]')) {
      shareSheet(s);
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
