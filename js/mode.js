// モード判別（2026-10-19）。モードごとに「規定G数になりうるG数」（ゾーン）が決まっている機種で、始まり・通ったG数・
// 濃厚の示唆・残りG数の示唆から、残るモードと次に当たりうるG数を出す。機種の言葉は機種ファイルの [mode] に書く（ここには書かない）。
// モードの選ばれやすさ・ゾーンの振り分けが出ていない機種のため、確からしさ（%）は出さない（残る・残らないだけ）。
// 設定の確からしさにも入れない。画面の作りはシナリオ判別（scenario.js）にそろえた。
// G数でなく周期などで数える機種もある（[mode] の unit）。下のコメントの「G数」は unit で数えた数のこと
import { esc, openSheet, confirmDialog } from './ui.js';

/**
 * 画面の言葉を数え方の単位（unit。無ければ "G"）から作る。
 *   at … 数の後ろ（「200G」「2周期目」）、of … 数え方の名前（「G数」「周期」）、kitei … 当たる位置の呼び名（「規定G数」「当選周期」）
 */
function words(mc) {
  const u = mc.unit || 'G';
  return u === 'G' ? { at: 'G', of: 'G数', kitei: '規定G数' } : { at: `${u}目`, of: u, kitei: `当選${u}` };
}

/**
 * 判別の記録に持つ形（s.mode）:
 *   start … 今のモードの始まり（starts の id。null は分からない）
 *   rows  … 区切りごとに見たもの（g＝G数、picks＝そこで見た示唆の id、hit＝そのG数で規定G数の当選）。g は step から step ずつ続く
 *   hints … 今のモードの示唆の id（濃厚のものだけ）
 *   past  … 決まり直す前のもの（start・rows・hints・at＝決まり直した時刻）
 */
export function stateOf(s) {
  s.mode ??= {};
  const st = s.mode;
  for (const k of ['rows', 'hints', 'past']) if (!Array.isArray(st[k])) st[k] = [];
  st.start ??= null;
  return st;
}

const byId = (list, id) => list.find(x => x.id === id);
const top = mc => mc.zones[mc.zones.length - 1];

/** その区切りで選べる示唆（at の無いものはどの区切りでも） */
const signsAt = (mc, g) => mc.signs.filter(x => !x.at || x.at.includes(g));

/**
 * 1つのモード（start・rows・hints）を読む。prev は1つ前のモードの読み（keep の始まりで、そこから下がらないために使う）。
 *   残るモード ＝ 始まりの allow（分からなければ start_only でないもの全部。keep なら前の残りのいちばん低いモードから上。
 *     前の残りに fall のモードがあれば下がることがあるので全部）∩ 示唆の allow ∩ 区切りで見た示唆の allow
 *   モードごとの候補のG数 ＝ 印のあるゾーンのうち、入れた最後の区切りより先（当たった区切りがあればそのG数だけ）を、
 *     残りG数の示唆（入れた区切りのG数 g から、z − g が ranges のどれかの [下, 上] に入る。両端を含む）と not で絞ったもの。
 *     候補が無くなったモードは残らない
 * 返すもの: alive（モードごとに残るか）・zones（モードごとの候補のG数）・now（入れた最後の区切り。無ければ 0）・hit（当たったG数か null）・
 *   next・max（残るモードの候補のG数のいちばん小さい・大きいもの。残らなければ null）
 */
export function analyze(mc, cyc, prev = null) {
  const rows = cyc?.rows || [];
  const start = byId(mc.starts, cyc?.start);
  let ok = start?.allow ? mc.items.map((_, k) => start.allow.includes(k)) : mc.items.map(it => !it.startOnly);
  if (start?.keep && prev?.alive.some(Boolean)) {
    const floor = Math.min(...prev.alive.map((a, k) => (!a ? Infinity : mc.items[k].fall ? 0 : k)));
    ok = ok.map((v, k) => v && k >= floor);
  }
  const allow = list => { ok = ok.map((v, k) => v && list.includes(k)); };
  (cyc?.hints || []).forEach(id => { const h = byId(mc.hints, id); if (h) allow(h.allow); });
  const picks = rows.flatMap(r => (r.picks || []).map(id => ({ g: r.g, x: byId(mc.signs, id) }))).filter(p => p.x);
  picks.forEach(({ x }) => { if (x.allow) allow(x.allow); });
  const hitRow = rows.find(r => r.hit);
  const now = rows.length ? Math.max(...rows.map(r => r.g)) : 0;
  const fits = z => picks.every(({ g, x }) => (x.ranges ? x.ranges.some(([lo, hi]) => z - g >= lo && z - g <= hi)
    : x.not ? !x.not.includes(z) : true));
  const zones = mc.items.map((it, k) => (!ok[k] ? [] : mc.zones.filter((z, j) =>
    it.marks[j] && (hitRow ? z === hitRow.g : z > now) && fits(z))));
  const alive = zones.map(zs => zs.length > 0);
  const live = zones.filter(zs => zs.length);
  return {
    alive, zones, now, hit: hitRow ? hitRow.g : null,
    next: live.length ? Math.min(...live.map(zs => zs[0])) : null,
    max: live.length ? Math.max(...live.map(zs => zs[zs.length - 1])) : null,
  };
}

/** 前のモードから順に読む（keep の始まりは1つ前の読みを使う）。{ past: [読み…], now: 今の読み } */
export function chain(mc, st) {
  let prev = null;
  const past = (st?.past || []).map(c => (prev = analyze(mc, c, prev)));
  return { past, now: analyze(mc, st, prev) };
}

const aliveText = (mc, a) => mc.items.filter((_, k) => a.alive[k]).map(it => it.label).join('・');

/** 判別の画面の上に固定した欄のボタンに出すもの（{ v, sub }）。次に当たりうるG数と、いちばん深いG数 */
export function summary(m, s) {
  const a = chain(m.mode, s.mode).now;
  const { at } = words(m.mode);
  if (a.next == null) return { v: '—', sub: '合わない' };
  if (a.hit != null) return { v: `${a.hit}${at}`, sub: '当選' };
  return { v: `${a.next}${at}`, sub: `最大${a.max}${at}` };
}

/** モード判別の枠（下から出す。判別の画面の上に固定した欄のボタンから）。直すたびに onChange（保存して画面を描き直す） */
export function openPanel(m, s, onChange) {
  const mc = m.mode;
  const sheet = openSheet(`<div class="sheet-title">${esc(mc.label)}の判別</div>${html(m)}
    <button type="button" class="btn btn-ghost btn-block" data-md-close>閉じる</button>`);
  update(sheet.el, m, s);
  sheet.el.addEventListener('click', async e => {
    if (e.target.closest('[data-md-close]')) { sheet.close(); return; }
    if (await click(e.target, m, s)) { onChange(); update(sheet.el, m, s); }
  });
}

/** 枠の中身（残る・残らないは update で入れる） */
function html(m) {
  const mc = m.mode;
  const { of, kitei } = words(mc);
  return `
    <div data-md-head></div>
    <div class="spec-wrap"><table class="sc-tbl md-tbl">
      <thead><tr><th>${esc(mc.label)}</th>${mc.zones.map((z, j) => `<th data-md-col="${j}">${z}</th>`).join('')}</tr></thead>
      <tbody>${mc.items.map((it, k) => `<tr data-md-row="${k}"><td>${esc(it.label)}</td>${mc.zones.map((_, j) =>
        `<td data-md-cell="${k}:${j}"${it.marks[j] === '天井' ? ' class="md-top"' : ''}>${esc(it.marks[j])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <p class="note">上は${of}（ゾーン）、中はその${of}が${kitei}になりうるかの印です。薄い列は通った${of}、枠の列は次のゾーン、線を引いた印はもう無いところ、薄い行は残らない${esc(mc.label)}です</p>
    ${mc.starts.length ? `<div class="sc-sub">始まり（この${esc(mc.label)}が決まったとき）</div>
      <div class="chips">${mc.starts.map(x => `<button type="button" class="chip" data-md-start="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div>` : ''}
    <div class="group-title">区切り（${of}）</div>
    <div class="sc-rows" data-md-rows></div>
    ${mc.hints.length ? `<div class="sc-sub">${esc(mc.hintTitle)}</div>
      <div class="chips">${mc.hints.map(h => `<button type="button" class="chip" data-md-hint="${esc(h.id)}">${esc(h.label)}</button>`).join('')}</div>` : ''}
    <button type="button" class="btn btn-block" data-md-reset>新しい${esc(mc.label)}にする（決まり直したとき）</button>
    <p class="note" data-md-past hidden></p>
    <p class="note">区切りは、その${of}の前兆が終わって当たらなかったら「通過」、${kitei}で当たったら「ここで当選」で入れます（座る前のところは「見ていない区切りをまとめて入れる」）。
      ${mc.countNote ? esc(mc.countNote) : ''}</p>
    <p class="note">${esc(mc.label)}の選ばれやすさ・ゾーンの振り分けが出ていないので、確からしさ（%）は出しません。始まり・濃厚の示唆・通った${of}・残り${of}の示唆で、残る${esc(mc.label)}を絞るだけです。設定の確からしさには入れていません</p>
    ${mc.note ? `<p class="note">${esc(mc.note)}</p>` : ''}`;
}

const pickLabels = (mc, ids) => (ids || []).map(id => byId(mc.signs, id)?.label).filter(Boolean);

/** 区切りの並びの文字（記録の詳細・前のモード） */
function rowsText(mc, rows) {
  const { at } = words(mc);
  return rows.map(r => {
    const ps = pickLabels(mc, r.picks);
    return `${r.g}${at}${r.hit ? '当選' : ''}${ps.length ? `（${ps.join('・')}）` : ''}`;
  }).join('・');
}

/** 次に入れる区切りのG数（当たったあと・いちばん深いG数を過ぎたら null） */
function nextG(mc, st) {
  if (st.rows.some(r => r.hit)) return null;
  const g = (st.rows.length ? st.rows[st.rows.length - 1].g : 0) + mc.step;
  return g <= top(mc) ? g : null;
}

/** 残る・残らないを入れ直す */
function update(root, m, s) {
  const mc = m.mode;
  const st = stateOf(s);
  const { past, now: a } = chain(mc, st);
  const head = root.querySelector('[data-md-head]');
  if (!head) return;
  const L = esc(mc.label);
  const { at: U } = words(mc);
  if (a.next == null) {
    head.innerHTML = `<p class="note excl">入れたものに合う${L}がありません（入れ間違いか、決まり直したあとかもしれません）</p>`;
  } else if (a.hit != null) {
    head.innerHTML = `<div class="sc-head">${a.hit}${U} で当選 · <b>${esc(aliveText(mc, a))}</b></div>
      <p class="note">CZ などに外れたら「新しい${L}にする」で始まりを選ぶと、次の${L}を読むのに使います</p>`;
  } else {
    const j = mc.zones.indexOf(a.next);
    const at = mc.items.map((it, k) => (a.zones[k].includes(a.next) ? `${it.label} ${it.marks[j]}` : null)).filter(Boolean);
    const deep = mc.items.filter((_, k) => a.zones[k].includes(a.max)).map(it => it.label);
    head.innerHTML = `<div class="sc-head">次のゾーン <b>${a.next}${U}</b> · いちばん深くて ${a.max}${U}</div>
      <p class="note">${a.next}${U}: ${esc(at.join('・'))}${a.max > a.next ? `／${a.max}${U}: ${esc(deep.join('・'))}` : ''}</p>
      <p class="note">残る${L}: ${esc(aliveText(mc, a))}${a.now ? `（${a.now}${U} まで入れたところ）` : ''}</p>`;
  }
  mc.items.forEach((it, k) => {
    root.querySelector(`[data-md-row="${k}"]`).classList.toggle('sc-out', !a.alive[k]);
    mc.zones.forEach((z, j) => {
      const td = root.querySelector(`[data-md-cell="${k}:${j}"]`);
      td.classList.toggle('md-x', !!it.marks[j] && a.alive[k] && !a.zones[k].includes(z));
      td.classList.toggle('sc-done', z <= a.now && z !== a.hit);
      td.classList.toggle('sc-now', z === (a.hit ?? a.next));
    });
  });
  mc.zones.forEach((z, j) => {
    const th = root.querySelector(`[data-md-col="${j}"]`);
    th.classList.toggle('sc-done', z <= a.now && z !== a.hit);
    th.classList.toggle('sc-now', z === (a.hit ?? a.next));
  });
  const ng = nextG(mc, st);
  root.querySelector('[data-md-rows]').innerHTML = st.rows.map((r, i) => {
    const ps = pickLabels(mc, r.picks);
    return `<button type="button" class="sc-row" data-md-edit="${i}"><span class="k">${r.g}${U}</span><b>${r.hit ? 'ここで当選' : '通過'}</b>${ps.length ? `<small>${esc(ps.join('・'))}</small>` : ''}</button>`;
  }).join('') + (ng ? `<button type="button" class="sc-row sc-add" data-md-add>＋ ${ng}${U} を入れる</button>
    <button type="button" class="btn btn-ghost btn-block" data-md-skip>見ていない区切りをまとめて入れる</button>` : '');
  root.querySelectorAll('[data-md-start]').forEach(b => b.classList.toggle('on', st.start === b.dataset.mdStart));
  root.querySelectorAll('[data-md-hint]').forEach(b => b.classList.toggle('on', st.hints.includes(b.dataset.mdHint)));
  const pastEl = root.querySelector('[data-md-past]');
  pastEl.hidden = !st.past.length;
  pastEl.textContent = st.past.length
    ? `前の${mc.label}（${st.past.length}つ）: ${st.past.map((c, i) => `${i + 1}つ目 ${c.rows.length ? `${c.rows[c.rows.length - 1].g}${U}まで` : '区切りなし'}（${aliveText(mc, past[i]) || '合わない'}）`).join('・')}`
    : '';
}

/** 区切りで見たものを選ぶ枠。{ picks, hit }・{ del: true }・null（やめた）で解決する。示唆はまとまり（group）ごとに1つ */
function pickRow(mc, g, row) {
  return new Promise(resolve => {
    const list = signsAt(mc, g);
    const picks = new Set(row?.picks || []);
    const groups = [...new Set(list.map(x => x.group))];
    const sheet = openSheet(`<div class="sheet-title">${g}${words(mc).at}</div>
      ${groups.map(gr => `<div class="sc-sub">${esc(gr)}</div>
        <div class="chips">${list.filter(x => x.group === gr).map(x => `<button type="button" class="chip${picks.has(x.id) ? ' on' : ''}" data-p="${esc(x.id)}">${esc(x.label)}</button>`).join('')}</div>`).join('')}
      <div class="sc-pick">
        <button type="button" class="btn${row && !row.hit ? ' btn-accent' : ''}" data-pass>通過（当たらず）</button>
        ${mc.zones.includes(g) ? `<button type="button" class="btn${row?.hit ? ' btn-accent' : ''}" data-hit>ここで当選</button>` : ''}
      </div>
      ${row ? '<button type="button" class="btn btn-ghost btn-block" data-del>この区切りから先を消す</button>' : ''}
      <button type="button" class="btn btn-ghost btn-block" data-cancel>やめる</button>`, { onClose: resolve });
    sheet.el.addEventListener('click', e => {
      const t = e.target;
      let b;
      if ((b = t.closest('[data-p]'))) {
        const id = b.dataset.p;
        const gr = byId(mc.signs, id).group;
        if (picks.has(id)) picks.delete(id);
        else { list.filter(x => x.group === gr).forEach(x => picks.delete(x.id)); picks.add(id); }
        sheet.el.querySelectorAll('[data-p]').forEach(c => c.classList.toggle('on', picks.has(c.dataset.p)));
      } else if (t.closest('[data-pass]')) sheet.close({ picks: [...picks], hit: false });
      else if (t.closest('[data-hit]')) sheet.close({ picks: [...picks], hit: true });
      else if (t.closest('[data-del]')) sheet.close({ del: true });
      else if (t.closest('[data-cancel]')) sheet.close(null);
    });
  });
}

/** 選ぶだけの枠（ボタンの並び）。押したものの value、やめたら null */
function pickOne(title, note, buttons) {
  return new Promise(resolve => {
    const sheet = openSheet(`<div class="sheet-title">${esc(title)}</div>${note ? `<p class="note">${esc(note)}</p>` : ''}
      <div class="sc-pick">${buttons.map((b, i) => `<button type="button" class="btn" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      <button type="button" class="btn btn-ghost btn-block" data-cancel>やめる</button>`, { onClose: resolve });
    sheet.el.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (b) sheet.close(buttons[+b.dataset.i].value);
      else if (e.target.closest('[data-cancel]')) sheet.close(null);
    });
  });
}

/** 枠の中を押したとき。直したら true（保存して描き直す） */
async function click(t, m, s) {
  const mc = m.mode;
  const st = stateOf(s);
  const { at: U, of } = words(mc);
  let b;
  if (t.closest('[data-md-add]')) {
    const g = nextG(mc, st);
    if (!g) return false;
    const r = await pickRow(mc, g);
    if (!r || r.del) return false;
    st.rows.push({ g, picks: r.picks, hit: r.hit });
    return true;
  }
  if (t.closest('[data-md-skip]')) {
    const from = nextG(mc, st);
    if (!from) return false;
    const gs = [];
    for (let g = from; g <= top(mc); g += mc.step) gs.push(g);
    const to = await pickOne(`どの${of}まで見ていないか`, `選んだ${of}まで、どの区切りも「通過」（示唆なし）で入れます`,
      gs.map(g => ({ label: `${g}${U} まで`, value: g })));
    if (!to) return false;
    for (let g = from; g <= to; g += mc.step) st.rows.push({ g, picks: [], hit: false });
    return true;
  }
  if ((b = t.closest('[data-md-edit]'))) {
    const i = +b.dataset.mdEdit;
    const row = st.rows[i];
    if (!row) return false;
    const r = await pickRow(mc, row.g, row);
    if (!r) return false;
    const after = st.rows.length - i - 1;
    if (r.del || (r.hit && after)) {
      const ok = await confirmDialog(r.del
        ? `${row.g}${U} から先の区切り（${after + 1}つ）を消しますか？`
        : `${row.g}${U} で当選にすると、あとの区切り（${after}つ）は消えます。よろしいですか？`, [
        { label: r.del ? '消す' : '当選にする', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
      if (!ok) return false;
      st.rows.splice(r.del ? i : i + 1);
      if (r.del) return true;
    }
    row.picks = r.picks;
    row.hit = r.hit;
    return true;
  }
  if ((b = t.closest('[data-md-start]'))) {
    st.start = st.start === b.dataset.mdStart ? null : b.dataset.mdStart;
    return true;
  }
  if ((b = t.closest('[data-md-hint]'))) {
    const id = b.dataset.mdHint;
    st.hints = st.hints.includes(id) ? st.hints.filter(x => x !== id) : [...st.hints, id];
    return true;
  }
  if (t.closest('[data-md-reset]')) {
    const v = await pickOne(`新しい${mc.label}の始まり`, `今の${mc.label}は「前の${mc.label}」に残します`,
      [...mc.starts.map(x => ({ label: x.label, value: x.id })), { label: '分からない', value: '-' }]);
    if (!v) return false;
    if (st.start || st.rows.length || st.hints.length) st.past.push({ start: st.start, rows: st.rows, hints: st.hints, at: Date.now() });
    st.start = v === '-' ? null : v;
    st.rows = [];
    st.hints = [];
    return true;
  }
  return false;
}

/** 記録の詳細の「入れた数字」に足す行（[ラベル, 値] の並び） */
export function recordRows(m, r) {
  const mc = m?.mode;
  const st = r.mode;
  if (!mc || !st || !(st.start || st.rows?.length || st.hints?.length || st.past?.length)) return [];
  const ch = chain(mc, st);
  const line = (c, a) => {
    const parts = [byId(mc.starts, c.start)?.label, rowsText(mc, c.rows || []),
      ...(c.hints || []).map(id => byId(mc.hints, id)?.label)].filter(Boolean);
    return `${parts.join('・') || 'なし'} → ${aliveText(mc, a) || '合わない'}`;
  };
  return [
    [`${mc.label}（今）`, line(st, ch.now)],
    ...(st.past || []).map((c, i) => [`前の${mc.label} ${i + 1}`, line(c, ch.past[i])]),
  ];
}
