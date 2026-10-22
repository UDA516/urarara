// シナリオ判別（2026-10-17）。AT の終わりなどで決まり直す「シナリオ」が CZ の何回目をどのレベルにするかを決め、
// レベルごとに突入時に見えるもの（テーブル）を振り分ける機種で、見えたテーブルの並びからシナリオを絞り、
// 次の回のレベル・テーブル・成功期待度の見込みを出す。機種の言葉は機種ファイルの [scenario] に書く（ここには書かない）。
// 選ばれやすさが1つ（rate。どの設定でも同じと置く）の機種は、設定の確からしさには入れない。設定ごとに違う機種（rates。2026-10-22）は、
// 入れたものの設定ごとの確からしさ（Σ シナリオ 選ばれやすさ × 尤度）を設定の確からしさに掛ける（juggler.js の posterior から settingLL）
import { esc, fmtPct, openSheet, confirmDialog } from './ui.js';

/**
 * 判別の記録に持つ形（s.scenario）:
 *   rows  … 今のシナリオで見た回（t はテーブルの id。null は分からない回。h はその回のレベルの示唆の id）
 *   hints … 今のシナリオの示唆の id（「○以上」など。濃厚のものだけ）
 *   next  … まだ来ていない次の回のレベルの示唆の id（回を入れるとその回の h へ移す）
 *   past  … 決まり直す前のもの（rows・hints・at＝決まり直した時刻）
 */
export function stateOf(s) {
  s.scenario ??= {};
  const st = s.scenario;
  for (const k of ['rows', 'hints', 'next', 'past']) if (!Array.isArray(st[k])) st[k] = [];
  return st;
}

const byId = (list, id) => list.find(x => x.id === id);

/** 入れた回の数の上限（いちばん長いシナリオの回数。それより先は無い） */
export const maxRows = sc => Math.max(...sc.items.map(it => it.levels.length));

/** 選ばれやすさが設定ごとに違うシナリオか（機種ファイルの rate を設定ごとの並びで書いたもの。2026-10-22） */
export const bySetting = sc => Array.isArray(sc?.items?.[0]?.rates);

/** 何か入れたか（回・示唆・次の回の示唆）。何も入れていなければ設定の確からしさに何も足さない */
const entered = st => !!(st?.rows?.length || st?.hints?.length || st?.next?.length);

/**
 * シナリオごとの重み（rate はシナリオの並びの選ばれやすさ）。
 *   シナリオ k の重み ＝ 選ばれやすさ × Π（その回のレベルでそのテーブルが選ばれる割合）
 *   テーブルが分からない回は失敗した回と読み、Σ テーブルの割合 ×（1 − 成功期待度）を掛ける（成功濃厚のレベルの回なら 0）。
 *   示唆に合わないシナリオ・その回のレベルが無いシナリオ（それより前に必ず当たる）は 0。
 */
function weights(sc, st, rate) {
  const rows = st?.rows || [];
  const hints = (st?.hints || []).map(id => byId(sc.hints, id)).filter(Boolean);
  const next = (st?.next || []).map(id => byId(sc.nextHints, id)).filter(Boolean);
  const fail = sc.levels.map((_, L) => sc.tables.reduce((a, t) => a + t.p[L] * (1 - t.success), 0));
  return sc.items.map((it, k) => {
    if (hints.some(h => !h.allow.includes(k))) return 0;
    let p = rate[k];
    rows.forEach((r, j) => {
      const L = it.levels[j];
      if (L == null) { p = 0; return; }
      if ((r.h || []).some(id => { const h = byId(sc.nextHints, id); return h && !h.levels.includes(L); })) { p = 0; return; }
      const t = r.t == null ? null : byId(sc.tables, r.t);
      p *= t ? t.p[L] : fail[L];
    });
    const Ln = it.levels[rows.length];
    if (next.length && (Ln == null || next.some(h => !h.levels.includes(Ln)))) p = 0;
    return p;
  });
}

/** 設定ごとのシナリオの重み（[設定][シナリオ]）と、その和（設定ごとの、入れたものの確からしさ）。bySetting の機種だけ */
function perSetting(sc, st) {
  const w = sc.items[0].rates.map((_, i) => weights(sc, st, sc.items.map(it => it.rates[i])));
  return { w, z: w.map(row => row.reduce((a, b) => a + b, 0)) };
}

/**
 * 設定の確からしさに足す対数尤度（設定ごと）。今のシナリオと前のシナリオ（決まり直すごとに選び直すので、本ごとに独立）の
 * 「入れたものの確からしさ」の log を足す。選ばれやすさが1つの機種・何も入れていないときは null（何も足さない）。
 * 入れたものに合うシナリオが無い本（入れ間違い）も足さない
 */
export function settingLL(m, s) {
  const sc = m?.scenario;
  const st = s?.scenario;
  if (!bySetting(sc) || !st) return null;
  let ll = null;
  for (const x of [...(st.past || []), st]) {
    if (!entered(x)) continue;
    const { z } = perSetting(sc, x);
    if (!z.some(v => v > 0)) continue;
    ll ??= z.map(() => 0);
    z.forEach((v, i) => { ll[i] += Math.log(v); });
  }
  return ll;
}

/** 入れたものだけで見た設定の確からしさ（どの設定も同じ割合と置く。合計1）。足すものが無ければ null */
export function settingShare(m, s) {
  const ll = settingLL(m, s);
  if (!ll) return null;
  const max = Math.max(...ll);
  const w = ll.map(v => Math.exp(v - max));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(v => v / sum);
}

/**
 * シナリオの確からしさと次の回の見込み。シナリオ k の重みは weights。
 * 選ばれやすさが設定ごとに違う機種は、設定 i ごとに重みを出して和 z_i で割り、設定の確からしさ ws（合計1）で足し合わせる
 * （P(k) ＝ Σ_i ws_i × 重み_ik ÷ z_i。ws は入れたものも入った設定の確からしさ。無ければ、どの設定も同じ割合と置く）。
 * post は確からしさ（合計1。どれも 0 なら null）、n は次の回の添字（0 から）、level・table は次の回のレベル・テーブルの割合、
 * success は次の回の成功期待度
 */
export function analyze(sc, st, ws) {
  const rows = st?.rows || [];
  let w;
  if (bySetting(sc)) {
    const per = perSetting(sc, st);
    const q = Array.isArray(ws) && ws.length === per.z.length ? ws : per.z;   // q ＝ z なら Σ_i 重み_ik（同じ割合と置いたもの）
    w = sc.items.map((_, k) => per.w.reduce((a, row, i) => (per.z[i] > 0 ? a + q[i] * row[k] / per.z[i] : a), 0));
  } else {
    w = weights(sc, st, sc.items.map(it => it.rate));
  }
  const total = w.reduce((a, b) => a + b, 0);
  const post = total > 0 ? w.map(v => v / total) : null;
  const n = rows.length;
  const level = sc.levels.map((_, L) => (post ? sc.items.reduce((a, it, k) => a + (it.levels[n] === L ? post[k] : 0), 0) : 0));
  const table = sc.tables.map(t => level.reduce((a, q, L) => a + q * t.p[L], 0));
  const success = table.reduce((a, q, i) => a + q * sc.tables[i].success, 0);
  return { post, n, level, table, success };
}

/** いちばん確からしいシナリオ（同じ確からしさは全部）の文字。どれも合わなければ null */
function topText(sc, post) {
  if (!post) return null;
  const max = Math.max(...post);
  const idx = post.map((_, k) => k).filter(k => Math.round(post[k] * 1000) === Math.round(max * 1000));
  return `${idx.map(k => sc.items[k].label).join('・')} ${idx.length > 1 ? '各' : ''}${fmtPct(max)}`;
}

const tableLabel = (sc, id) => (id == null ? '分からない' : byId(sc.tables, id)?.label ?? `${id}（今の表に無い）`);
const hintLabels = (list, ids) => (ids || []).map(id => byId(list, id)?.label).filter(Boolean);

/** 判別の画面の上に固定した欄のボタンに出すもの（{ v, sub }）。次の回の成功期待度と、何回目か。
 *  合うシナリオが無い・この先の回が無いときは v が「—」。ws は設定の確からしさ（analyze） */
export function summary(m, s, ws) {
  const sc = m.scenario;
  const a = analyze(sc, s.scenario, ws);
  if (!a.post) return { v: '—', sub: '合わない' };
  if (a.n >= maxRows(sc)) return { v: '—', sub: 'この先なし' };
  return { v: fmtPct(a.success), sub: `${sc.step}${a.n + 1}回目` };
}

/** 要素ごとの表の行の名前と、その行の目印（項目の id は英小文字から始まるので重ならない）。選ばれやすさが設定ごとに違う機種だけ */
export const EL = '_sc';
export const elementLabel = '入れた回・示唆';

/** 要素ごとの表の行の中身 { v, near }。v は今のシナリオでいちばん確からしいもの（今のものに何も入れていなければ前のものの数）、
 *  near は入れたものだけで見ていちばん確からしい設定（同じ確からしさは全部）。設定に何も足していなければ null */
export function elementText(m, s, ws) {
  const share = settingShare(m, s);
  if (!share) return null;
  const sc = m.scenario;
  const st = s.scenario;
  const v = entered(st) ? topText(sc, analyze(sc, st, ws).post) ?? '合わない' : `前の${sc.label}（${st.past.length}つ）`;
  const max = Math.max(...share);
  const near = share.map((_, i) => i).filter(i => Math.round(share[i] * 1000) === Math.round(max * 1000));
  return { v, near: near.map(i => m.settings[i]).join('・') };
}

/** シナリオ判別の枠（下から出す）。判別の画面の上に固定した欄のボタンから、どこまで送っていても呼び出せる
 *  （2026-10-17 ユーザーの指示。前は画面の途中のカードだった）。直すたびに onChange（保存して画面を描き直す）。
 *  weights は今の設定の確からしさを返す関数（入れ直すたびに変わるので、そのつど呼ぶ） */
export function openPanel(m, s, onChange, weights) {
  const sc = m.scenario;
  const sheet = openSheet(`<div class="sheet-title">${esc(sc.label)}の判別</div>${html(m)}
    <button type="button" class="btn btn-ghost btn-block" data-sc-close>閉じる</button>`);
  update(sheet.el, m, s, weights?.());
  sheet.el.addEventListener('click', async e => {
    if (e.target.closest('[data-sc-close]')) { sheet.close(); return; }
    if (await click(e.target, m, s)) { onChange(); update(sheet.el, m, s, weights?.()); }
  });
}

/** 枠の中身（数字は update で入れる） */
export function html(m) {
  const sc = m.scenario;
  const cols = [...Array(maxRows(sc)).keys()];
  return `
    <div data-sc-next></div>
    <div class="spec-wrap"><table class="sc-tbl">
      <thead><tr><th>${esc(sc.label)}</th><th>確からしさ</th>${cols.map(j => `<th data-sc-col="${j}">${j + 1}</th>`).join('')}</tr></thead>
      <tbody>${sc.items.map((it, k) => `<tr data-sc-row="${k}"><td>${esc(it.label)}</td><td class="sc-p" data-sc-p="${k}"></td>${cols.map(j =>
        `<td data-sc-cell="${j}" class="lv-${it.levels[j] ?? 'x'}">${it.levels[j] == null ? '' : esc(sc.levels[it.levels[j]])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="note">表の 1〜${cols.length} は${esc(sc.step)}の何回目か、中はその回のレベルです。枠の付いた列が次の回、薄い列は入れた回です</p>
    ${bySetting(sc) ? '<p class="note" data-sc-set></p>' : ''}
    <div class="group-title">${esc(sc.step)}（${esc(sc.reset)}のあと）</div>
    <div class="sc-rows" data-sc-rows></div>
    ${sc.nextHints.length ? `<div class="sc-sub" data-sc-next-title></div>
      <div class="chips">${sc.nextHints.map(h => `<button type="button" class="chip" data-sc-next-hint="${esc(h.id)}">${esc(h.label)}</button>`).join('')}</div>` : ''}
    ${sc.hints.length ? `<div class="sc-sub">${esc(sc.hintTitle)}</div>
      <div class="chips">${sc.hints.map(h => `<button type="button" class="chip" data-sc-hint="${esc(h.id)}">${esc(h.label)}</button>`).join('')}</div>` : ''}
    <button type="button" class="btn btn-block" data-sc-reset>新しい${esc(sc.label)}にする（${esc(sc.reset)}）</button>
    <p class="note" data-sc-past hidden></p>
    <p class="note">テーブルが分からない回（座る前の回など）も「分からない」で入れて、回の数を合わせます。分からない回は失敗した回として読みます
      （失敗しやすさはレベルで違うので少し効き、成功濃厚のレベルの回なら、そのシナリオは外れます）</p>
    <p class="note">${bySetting(sc)
      ? `確からしさは、${esc(sc.label)}の選ばれやすさ（${esc(sc.rateNote)}）を、判別の設定の確からしさで重み付けして出しています。
        入れたテーブル・示唆は、設定の確からしさにも入れています（前の${esc(sc.label)}のぶんも）`
      : `確からしさは、${esc(sc.label)}の選ばれやすさ（${esc(sc.rateNote)}）から出しています。設定の確からしさには入れていません`}</p>
    ${sc.note ? `<p class="note">${esc(sc.note)}</p>` : ''}`;
}

/** 数字を入れ直す。ws は設定の確からしさ（analyze） */
export function update(root, m, s, ws) {
  const sc = m.scenario;
  const st = stateOf(s);
  const a = analyze(sc, st, ws);
  // 入れたものだけで見た設定の確からしさ（設定の確からしさに掛けているもの）
  const set = root.querySelector('[data-sc-set]');
  if (set) {
    const share = settingShare(m, s);
    set.textContent = share
      ? `入れたテーブル・示唆だけで見た設定（判別の設定の確からしさに入れています）: ${share.map((p, i) => `設定${m.settings[i]} ${fmtPct(p)}`).join('・')}`
      : '入れたテーブル・示唆は、設定の確からしさにも入れます（まだ何も入れていません）';
  }
  const max = maxRows(sc);
  const box = root.querySelector('[data-sc-next]');
  if (!box) return;
  const more = a.n < max;
  if (!a.post) {
    box.innerHTML = `<p class="note excl">入れたテーブル・示唆に合う${esc(sc.label)}がありません（入れ間違いか、${esc(sc.reset)}で決まり直したあとかもしれません）</p>`;
  } else if (!more) {
    box.innerHTML = `<p class="note">これより先の${esc(sc.step)}はありません（${max}回目までで決まります）</p>`;
  } else {
    box.innerHTML = `<div class="sc-head">次は ${esc(sc.step)} ${a.n + 1}回目 · 成功期待度 <b>${fmtPct(a.success)}</b></div>
      <div class="sc-levels">${sc.levels.map((lv, L) => `<span class="lv-${L}${a.level[L] > 0 ? '' : ' zero'}"><small>${esc(lv)}</small>${fmtPct(a.level[L])}</span>`).join('')}</div>
      <details class="img-fold"><summary>テーブルの見込み</summary><table class="tbl">
        <thead><tr><th>テーブル</th><th>割合</th><th>成功期待度</th></tr></thead>
        <tbody>${sc.tables.map((t, i) => `<tr${a.table[i] > 0 ? '' : ' class="zero"'}><td>${esc(t.label)}</td><td>${fmtPct(a.table[i])}</td><td>${fmtPct(t.success)}</td></tr>`).join('')}</tbody>
      </table></details>`;
  }
  sc.items.forEach((_, k) => {
    const p = a.post?.[k] ?? 0;
    const td = root.querySelector(`[data-sc-p="${k}"]`);
    td.textContent = a.post ? fmtPct(p) : '—';
    td.style.setProperty('--w', `${(p * 100).toFixed(1)}%`);
    root.querySelector(`[data-sc-row="${k}"]`).classList.toggle('sc-out', !(p > 0));
  });
  root.querySelectorAll('.sc-tbl [data-sc-col], .sc-tbl [data-sc-cell]').forEach(el => {
    const j = +(el.dataset.scCol ?? el.dataset.scCell);
    el.classList.toggle('sc-now', j === a.n);
    el.classList.toggle('sc-done', j < a.n);
  });
  root.querySelector('[data-sc-rows]').innerHTML = st.rows.map((r, j) => {
    const hs = hintLabels(sc.nextHints, r.h);
    return `<button type="button" class="sc-row" data-sc-edit="${j}"><span class="k">${j + 1}回目</span><b>${esc(tableLabel(sc, r.t))}</b>${hs.length ? `<small>${esc(hs.join('・'))}</small>` : ''}</button>`;
  }).join('') + (more ? `<button type="button" class="sc-row sc-add" data-sc-add>＋ ${a.n + 1}回目の${esc(sc.step)}を入れる</button>` : '');
  const nt = root.querySelector('[data-sc-next-title]');
  if (nt) nt.textContent = more ? `${sc.nextTitle}（次の ${a.n + 1}回目のレベル）` : sc.nextTitle;
  root.querySelectorAll('[data-sc-next-hint]').forEach(b => {
    b.classList.toggle('on', st.next.includes(b.dataset.scNextHint));
    b.disabled = !more;
  });
  root.querySelectorAll('[data-sc-hint]').forEach(b => b.classList.toggle('on', st.hints.includes(b.dataset.scHint)));
  const past = root.querySelector('[data-sc-past]');
  past.hidden = !st.past.length;
  past.textContent = st.past.length
    ? `前の${sc.label}（${st.past.length}つ）: ${st.past.map((x, i) => { const t = topText(sc, analyze(sc, x, ws).post); return `${i + 1}つ目 ${x.rows.length}回${t ? `（${t}）` : ''}`; }).join('・')}`
    : '';
}

/** テーブルを選ぶ枠。{ t }（null は分からない）・{ del: true }・null（やめた）で解決する。
 *  row を渡すと、その回のレベルの示唆も枠の中で付け外しできる（押すとすぐ row.h に入る） */
function pickTable(sc, title, row) {
  return new Promise(resolve => {
    const hs = row && sc.nextHints.length
      ? `<div class="sc-sub">${esc(sc.nextTitle)}（この回の前に出たもの）</div>
        <div class="chips">${sc.nextHints.map(h => `<button type="button" class="chip${(row.h || []).includes(h.id) ? ' on' : ''}" data-h="${esc(h.id)}">${esc(h.label)}</button>`).join('')}</div>`
      : '';
    const sheet = openSheet(`<div class="sheet-title">${esc(title)}</div>
      ${sc.tableNote ? `<p class="note">${esc(sc.tableNote)}</p>` : ''}
      <div class="sc-pick">${sc.tables.map(t => `<button type="button" class="btn${row?.t === t.id ? ' btn-accent' : ''}" data-t="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
        <button type="button" class="btn${row && row.t == null ? ' btn-accent' : ''}" data-t="">分からない</button></div>
      ${hs}
      ${row ? '<button type="button" class="btn btn-ghost btn-block" data-del>この回を消す</button>' : ''}
      <button type="button" class="btn btn-ghost btn-block" data-cancel>やめる</button>`, { onClose: resolve });
    sheet.el.addEventListener('click', e => {
      const t = e.target;
      let b;
      if ((b = t.closest('[data-t]'))) sheet.close({ t: b.dataset.t || null });
      else if ((b = t.closest('[data-h]'))) {
        const id = b.dataset.h;
        row.h = (row.h || []).includes(id) ? row.h.filter(x => x !== id) : [...(row.h || []), id];
        b.classList.toggle('on', row.h.includes(id));
      } else if (t.closest('[data-del]')) sheet.close({ del: true });
      else if (t.closest('[data-cancel]')) sheet.close(null);
    });
  });
}

/** カードの中を押したとき。直したら true（保存して描き直す） */
export async function click(t, m, s) {
  const sc = m.scenario;
  const st = stateOf(s);
  let b;
  const toggle = (list, id) => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  if (t.closest('[data-sc-add]')) {
    const r = await pickTable(sc, `${st.rows.length + 1}回目の${sc.step}`);
    if (!r || r.del) return false;
    st.rows.push({ t: r.t, h: st.next });
    st.next = [];
    return true;
  }
  if ((b = t.closest('[data-sc-edit]'))) {
    const j = +b.dataset.scEdit;
    const row = st.rows[j];
    if (!row) return false;
    const before = JSON.stringify(row);
    const r = await pickTable(sc, `${j + 1}回目の${sc.step}`, row);
    if (r?.del) {
      const ok = await confirmDialog(`${j + 1}回目（${tableLabel(sc, row.t)}）を消しますか？ あとの回は1つずつ前へ詰めます`, [
        { label: '消す', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
      if (ok) st.rows.splice(j, 1);
      return ok || JSON.stringify(row) !== before;
    }
    if (r) row.t = r.t;
    return JSON.stringify(row) !== before;
  }
  if ((b = t.closest('[data-sc-next-hint]'))) {
    st.next = toggle(st.next, b.dataset.scNextHint);
    return true;
  }
  if ((b = t.closest('[data-sc-hint]'))) {
    st.hints = toggle(st.hints, b.dataset.scHint);
    return true;
  }
  if (t.closest('[data-sc-reset]')) {
    if (!st.rows.length && !st.hints.length && !st.next.length) return false;
    const ok = await confirmDialog(`${sc.reset}で${sc.label}が決まり直したので、新しく数え始めますか？ 今の${st.rows.length}回は「前の${sc.label}」に残します`, [
      { label: '新しく数え始める', value: true, kind: 'accent' }, { label: 'やめる', value: false }]);
    if (!ok) return false;
    st.past.push({ rows: st.rows, hints: st.hints, at: Date.now() });
    st.rows = [];
    st.hints = [];
    st.next = [];
    return true;
  }
  return false;
}

/** 記録の詳細の「入れた数字」に足す行（[ラベル, 値] の並び）。ws は記録の設定の確からしさ（自分。analyze） */
export function recordRows(m, r, ws) {
  const sc = m?.scenario;
  const st = r.scenario;
  if (!sc || !st || !(st.rows?.length || st.past?.length || st.hints?.length)) return [];
  const line = x => (x.rows.length ? x.rows.map((row, j) => `${j + 1}:${tableLabel(sc, row.t)}`).join('・') : 'なし')
    + (x.hints?.length ? `（${hintLabels(sc.hints, x.hints).join('・')}）` : '');
  const top = x => (x.rows.length || x.hints?.length ? topText(sc, analyze(sc, x, ws).post) : null);   // 何も入れていなければ出さない
  return [
    [`${sc.label}（今）`, `${line(st)}${top(st) ? ` → ${top(st)}` : ''}`],
    ...(st.past || []).map((x, i) => [`前の${sc.label} ${i + 1}`, `${line(x)}${top(x) ? ` → ${top(x)}` : ''}`]),
  ];
}
