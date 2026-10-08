// ジャグラーの型。機種ファイルの表（設定ごとの 1/N）から、数える項目・設定の確からしさ・近い設定・
// 設定差の表・前任者のぶどう逆算を出す。画面は持たない。
//
// 確からしさの組み立ては、渡されたカウンター（HTML）と同じ（項目ごとの二項分布の対数尤度を
// 足し、どの設定も同じ割合と置いて割合にする）:
//   自分だけ     … 自分の項目（契機別のボーナス・小役）を自分の消化Gで
//   前任者込み   … 上に、前任者の BIG・REG を前任者のG数（打ち始めG）で足す。小役は自分の消化Gのぶんだけ
// 前任者のぶどう逆算はここに入れない（座る前の目安。backcalc）
//
// A タイプ（ジャグラー以外。type = "atype"）も同じ計算で判別する。数える項目は機種ファイルに書いたもの（m.items）で、
// 型で違うところ（要素の行・設定差の表の組・機械割）は atype.js。項目ごとに分母の G数を持てる（per）のと、
// 示唆（1回でも数えたら設定を外す）があるのは A タイプだけ
import { esc } from './ui.js';
import * as A from './atype.js';

export const LABEL = {
  big: 'BIG', reg: 'REG', t_big: '単独BIG', t_reg: '単独REG', c_big: 'チェリーBIG', c_reg: 'チェリーREG',
  p_big: 'ピエロBIG', p_reg: 'ピエロREG', o_big: 'その他BIG', o_reg: 'その他REG', grape: 'ぶどう', cherry: 'チェリー',
};

const has = (m, c) => Array.isArray(m.table?.[c]);

const isA = m => m?.type === 'atype';

export function isJudgeable(m) {
  return !!m && (m.type === 'juggler' || isA(m)) && has(m, 'big') && has(m, 'reg');
}

/** ぶどう逆算はジャグラーだけ（A タイプはボーナスの純増のぶれが大きく、逆算しない。ユーザーの指示 2026-10-08） */
export const canBackcalc = m => isJudgeable(m) && m.type === 'juggler';

/** 判別の計算に入る項目か（A タイプの G数の欄・示唆・数えるだけの項目は入らない。ジャグラーの項目は全部入る） */
const isProb = A.isProb;

/** 列に設定差があるか */
const varies = (m, c) => has(m, c) && m.table[c].some(v => Math.abs(v - m.table[c][0]) > 1e-9);

/** 判別で数えるチェリーの列。表に非重複チェリー（t_cherry）があればそれ（重複のボーナスは別に数えるため）。
 *  cherry（合算）は逆算の払い出しに使う */
const cherryCol = m => (has(m, 't_cherry') ? 't_cherry' : 'cherry');

/** 数えるチェリーに設定差があるか。無い機種はチェリーを数えない（チェリー重複のボーナスだけ数える） */
export const cherryVaries = m => varies(m, cherryCol(m));

/** 自分が数える項目。表に内訳の列があれば契機別、無ければ BIG・REG。小役は表にあるものだけ。
 *  A タイプは機種ファイルに書いた項目（short は組の中での短い名前、sec は組の名前） */
export function myItems(m) {
  if (isA(m)) return A.items(m);
  const items = [];
  const bonus = (id, kind) => items.push({ id, label: LABEL[id], group: 'bonus', kind });
  if (has(m, 't_big') && has(m, 't_reg')) {
    bonus('t_big', 'big');
    bonus('t_reg', 'reg');
    if (has(m, 'c_big')) bonus('c_big', 'big');
    if (has(m, 'c_reg')) bonus('c_reg', 'reg');
    if (has(m, 'p_big')) bonus('p_big', 'big');
    if (has(m, 'p_reg')) bonus('p_reg', 'reg');
    // その他（中段チェリーなど、単独でもチェリー・ピエロ重複でもないもの）。設定差が無くても、
    // 数えないと単独に混ざって単独が良く見えるので数える
    if (has(m, 'o_big')) bonus('o_big', 'big');
    if (has(m, 'o_reg')) bonus('o_reg', 'reg');
  } else {
    bonus('big', 'big');
    bonus('reg', 'reg');
  }
  if (has(m, 'grape')) items.push({ id: 'grape', label: LABEL.grape, group: 'role' });
  if (cherryVaries(m)) items.push({ id: 'cherry', label: LABEL.cherry, group: 'role' });
  return items;
}

/** 項目の名前（テンキーの見出し・記録に出す。A タイプは組の名前の付いたもの） */
export const itemLabel = (m, id) => myItems(m).find(it => it.id === id)?.label ?? LABEL[id] ?? id;

/** 判別を始める前に出す注意。表から分かること（内訳が無い など）に、機種ファイルの cautions
 *  （データがそろっていない・合っていないところ）を足す。ジャグラーの型でない機種は cautions だけ */
export function cautions(m) {
  const list = [];
  if (isJudgeable(m) && !isA(m)) {
    if (!(has(m, 't_big') && has(m, 't_reg'))) list.push('単独・チェリー重複の内訳がまだ無いので、ボーナスは BIG・REG だけで数えます');
    if (!has(m, 'grape')) list.push('ぶどうの表が無いので、ぶどうは数えません');
  }
  return [...list, ...(m?.cautions || [])];
}

export function highIndex(m) {
  const i = m.settings.indexOf(m.highFrom);
  return i >= 0 ? i : Math.max(0, m.settings.length - 3);
}
export const highLabel = m => m.settings[highIndex(m)];

export const myGames = s => Math.max(0, (s.totalG || 0) - (s.startG || 0));

/** 自分・前任者込みの回数とG数 */
export function stats(m, s) {
  const own = { big: 0, reg: 0 };
  for (const it of myItems(m)) if (it.kind) own[it.kind] += s.counts?.[it.id] || 0;
  return {
    myG: myGames(s),
    totalG: Math.max(s.totalG || 0, s.startG || 0),
    own,
    all: { big: (s.prevBig || 0) + own.big, reg: (s.prevReg || 0) + own.reg },
  };
}

function binomLL(k, n, p) {
  if (!(n > 0)) return 0;
  k = Math.min(Math.max(k || 0, 0), n);
  return k * Math.log(p) + (n - k) * Math.log1p(-p);
}

function normalize(lls) {
  const max = Math.max(...lls);
  const w = lls.map(v => Math.exp(v - max));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / sum);
}

/** 項目の分母の G数。ふつうは自分の消化G、per のある項目（A タイプ）はその G数の欄 */
const gamesOf = (it, s) => (it.per ? s.counts?.[it.per] || 0 : myGames(s));

/** 示唆で外す設定（添字の Set）と、外した理由の項目。全部の設定が外れるときは外さない */
export function excluded(m, s) {
  const idx = new Set();
  const by = [];
  for (const it of myItems(m)) {
    if (it.group !== 'hint' || !(s.counts?.[it.id] > 0)) continue;
    it.excludes.forEach(i => idx.add(i));
    by.push(it);
  }
  return idx.size < m.settings.length ? { idx, by } : { idx: new Set(), by: [] };
}

/** 設定ごとの確からしさ（合計1）。withPrev で前任者の BIG・REG も入れる */
export function posterior(m, s, withPrev) {
  const items = myItems(m).filter(isProb);
  const out = excluded(m, s).idx;
  return normalize(m.settings.map((_, i) => {
    if (out.has(i)) return -Infinity;
    let ll = 0;
    for (const it of items) {
      const g = gamesOf(it, s);
      if (g > 0) ll += binomLL(s.counts?.[it.id], g, 1 / colValues(m, it.id)[i]);
    }
    if (withPrev && s.startG > 0) {
      ll += binomLL(s.prevBig, s.startG, 1 / m.table.big[i]) + binomLL(s.prevReg, s.startG, 1 / m.table.reg[i]);
    }
    return ll;
  }));
}

export const highShare = (m, probs) => probs.slice(highIndex(m)).reduce((a, b) => a + b, 0);

/** 記録に残す、その時点の結果 */
export function snapshot(m, s) {
  const mineOn = myGames(s) > 0;
  const allOn = mineOn || (s.startG || 0) > 0;
  const mine = mineOn ? posterior(m, s, false) : null;
  const all = allOn ? posterior(m, s, true) : null;
  return {
    settings: [...m.settings],
    highLabel: highLabel(m),
    mine, all,
    highMine: mine ? highShare(m, mine) : null,
    highAll: all ? highShare(m, all) : null,
  };
}

// ---------------------------------------------------------------- 近い設定と設定差の表

/** 列の値（合算と BR比率は表に無ければ BIG・REG から出す。チェリーは判別で数えるほう） */
export function colValues(m, c) {
  if (c === 'combo') return has(m, 'combo') ? m.table.combo : m.table.big.map((b, i) => 1 / (1 / b + 1 / m.table.reg[i]));
  if (c === 'br') return m.table.big.map((b, i) => m.table.reg[i] / b);   // BIG回数 ÷ REG回数 の期待値
  if (c === 'cherry') return m.table[cherryCol(m)];
  return m.table[c];
}

// 表の外れを「6以上」「1以下」と出す列（渡されたカウンターと同じ4つ・同じ幅）
const OUT_OF_RANGE = new Set(['combo', 'big', 'reg', 't_reg']);

/** 実測の値にいちばん近い設定（同じ近さは全部）。{ idx: [...], text } か null */
export function nearest(m, c, value) {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const arr = colValues(m, c);
  if (!arr) return null;
  const n = arr.length;
  if (OUT_OF_RANGE.has(c)) {
    if (value < arr[n - 1] - 10) return { idx: [n - 1], text: `${m.settings[n - 1]}以上` };
    if (value > arr[0] + 30) return { idx: [0], text: `${m.settings[0]}以下` };
  }
  const min = Math.min(...arr.map(v => Math.abs(value - v)));
  const idx = arr.map((_, i) => i).filter(i => Math.abs(Math.abs(value - arr[i]) - min) < 1e-3);
  return { idx, text: idx.map(i => m.settings[i]).join('・') };
}

/** 表の範囲より良い・悪いときの添え書き（逆算のぶどうなど） */
export function rangeNote(m, c, value) {
  const arr = colValues(m, c);
  if (!arr || !(value > 0)) return '';
  const lo = Math.min(...arr), hi = Math.max(...arr);
  if (value < lo) return `表の設定${m.settings[arr.indexOf(lo)]}より良い`;
  if (value > hi) return `表の設定${m.settings[arr.indexOf(hi)]}より悪い`;
  return '';
}

/** 実測の 1/N（自分・前任者込み）。BR比率だけは BIG回数 ÷ REG回数 */
export function measures(m, s) {
  const st = stats(m, s);
  const den = (g, k) => (g > 0 && k > 0 ? g / k : null);
  const ratio = (b, r) => (b > 0 && r > 0 ? b / r : null);
  const mine = {
    big: den(st.myG, st.own.big), reg: den(st.myG, st.own.reg), combo: den(st.myG, st.own.big + st.own.reg),
    br: ratio(st.own.big, st.own.reg),
  };
  for (const it of myItems(m)) if (isProb(it) && !(it.id in mine)) mine[it.id] = den(gamesOf(it, s), s.counts?.[it.id]);
  const all = {
    big: den(st.totalG, st.all.big), reg: den(st.totalG, st.all.reg), combo: den(st.totalG, st.all.big + st.all.reg),
    br: ratio(st.all.big, st.all.reg),
  };
  return { st, mine, all };
}

/** 要素ごとの表の行（渡されたカウンターの重要度順に、BIG・REG と残りの内訳を足した） */
export function elementRows(m) {
  if (isA(m)) return A.elementRows(m);
  const rows = [];
  const add = (c, label, both = false) => {
    if (c === 'combo' || c === 'big' || c === 'reg' || has(m, c)) rows.push({ c, label, both });
  };
  add('t_reg', '単独REG');
  add('c_reg', 'チェリーREG');
  add('combo', 'ボーナス合算', true);
  add('grape', 'ぶどう');
  if (cherryVaries(m)) add('cherry', 'チェリー');
  add('big', 'BIG', true);
  add('reg', 'REG', true);
  add('t_big', '単独BIG');
  add('c_big', 'チェリーBIG');
  add('p_big', 'ピエロBIG');
  add('p_reg', 'ピエロREG');
  // その他は設定差があるときだけ（無ければどの設定にも同じ近さで、出しても意味が無い）
  if (varies(m, 'o_big')) add('o_big', 'その他BIG');
  if (varies(m, 'o_reg')) add('o_reg', 'その他REG');
  return rows;
}

// 設定差の表の塗りに、前任者と自分を合わせた値を使う列（BIG・REG から出す列）。ほかの列（内訳・小役）は
// 自分の値（自分の消化Gと自分の回数）で塗る。前任者は BIG・REG の合計しか分からないため
const WITH_PREV = new Set(['combo', 'big', 'reg', 'br']);

/** 設定差の表の組（{ title, cols }）。ジャグラーは1つの表、A タイプはボーナス・契機・小役などに分ける */
export function specGroups(m) {
  return isA(m) ? A.specGroups(m) : [{ title: '', cols: jugglerColumns(m) }];
}

/** 設定差の表の列（全部の組を合わせたもの） */
export const specColumns = m => specGroups(m).flatMap(g => g.cols);

/** ジャグラーの設定差の表の列（渡されたカウンターの11列。チェリーは設定差があるときだけ） */
function jugglerColumns(m) {
  const raw = v => String(v);
  const cols = [];
  if (Array.isArray(m.table.payout)) cols.push({ c: 'payout', label: '出玉率', text: raw });
  cols.push({ c: 'br', label: 'BR比率', text: v => `${v.toFixed(1)} : 1` });
  cols.push({ c: 'combo', label: 'ボーナス<br>合算', text: v => v.toFixed(1) });
  cols.push({ c: 'big', label: 'BB確率', text: v => v.toFixed(1) });
  cols.push({ c: 'reg', label: 'RB確率', text: v => v.toFixed(1) });
  for (const [c, label] of [['t_big', '単独<br>BIG'], ['t_reg', '単独<br>REG'], ['c_big', 'ﾁｪﾘｰ<br>+BIG'], ['c_reg', 'ﾁｪﾘｰ<br>+REG']]) {
    if (has(m, c)) cols.push({ c, label, text: raw });
  }
  for (const [c, label] of [['o_big', 'その他<br>BIG'], ['o_reg', 'その他<br>REG']]) {
    if (varies(m, c)) cols.push({ c, label, text: raw });
  }
  if (has(m, 'grape')) cols.push({ c: 'grape', label: 'ﾌﾞﾄﾞｳ', text: v => v.toFixed(2) });
  if (cherryVaries(m)) cols.push({ c: 'cherry', label: 'ﾁｪﾘｰ', text: v => v.toFixed(1) });
  return cols;
}

/** 設定差の表（横に送れる枠ごと）。名前のある組（A タイプ）は、見出しを押すとたためる（data-fold は ui.js の
 *  rememberFolds で開け閉めを覚える鍵）。A タイプの表は列が少ないので幅を詰める */
export function specTableHtml(m) {
  return specGroups(m).map(({ title, cols }) => {
    const head = `<tr><th>設定</th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
    const body = m.settings.map((s, i) => `<tr><td>${esc(s)}</td>${cols.map(c => {
      const v = c.c === 'payout' ? m.table.payout[i] : colValues(m, c.c)[i];
      return `<td data-spec="${c.c}:${i}">${esc(c.text(v))}</td>`;
    }).join('')}</tr>`).join('');
    const table = `<div class="spec-wrap"><table class="spec${isA(m) ? ' fit' : ''}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
    return title
      ? `<details class="fold" data-fold="${esc(`spec:${title}`)}" open><summary class="fold-title">${esc(title)}</summary>${table}</details>`
      : table;
  }).join('');
}

/** 設定差の表で塗る設定（{ 列: [設定の添字…] }）。meas は measures() の結果。0回の列は塗らない */
export function specMarks(m, meas) {
  const marks = {};
  for (const { c, noMark } of specColumns(m)) {
    if (c === 'payout' || noMark) continue;
    const near = nearest(m, c, (WITH_PREV.has(c) ? meas.all : meas.mine)[c]);
    if (near) marks[c] = near.idx;
  }
  return marks;
}

// ---------------------------------------------------------------- 機械割（チェリー狙い・完全攻略）

const roleSum = list => (list || []).reduce((a, o) => a + o.pay / o.prob, 0);

/**
 * 設定ごとの機械割（%）を、表の小役とボーナスの払い出しから出す（1Gあたりの払い出し ÷ 3枚）。
 *   チェリー狙い … リプレイ・ぶどう・チェリー（合算。重複のボーナスのときも払い出す）・BIG・REG（1回の枚数）
 *   完全攻略     … 上に、完全攻略で取る小役（payout_model.skill。ベル・ピエロ）を足す
 * 照合した表の「チェリー狙い」「フル攻略」と 0.1% ほどで合う出し方（2026-10-07）。公表値は数え方が違い、これより低い。
 * 払い出しの値が足りなければ null。skill が無ければ full だけ null
 */
export function payoutRates(m) {
  const pm = m.payoutModel || {};
  if (!(pm.big_net > 0 && pm.reg_net > 0 && pm.replay > 0 && pm.cherry_pay > 0 && has(m, 'grape') && has(m, 'cherry'))) return null;
  const aim = m.settings.map((_, i) => ((pm.replay_pay ?? 3) / pm.replay + (pm.grape_pay ?? 8) / m.table.grape[i]
    + pm.cherry_pay / m.table.cherry[i] + pm.big_net / m.table.big[i] + pm.reg_net / m.table.reg[i]
    + roleSum(pm.others)) / 3 * 100);
  const skill = roleSum(pm.skill) / 3 * 100;
  return { aim, full: pm.skill?.length ? aim.map(v => v + skill) : null };
}

/** 機械割の表（公表値・チェリー狙い・完全攻略）と、出し方の断り。出せるものが無ければ空。A タイプは atype.js */
export function payoutHtml(m) {
  if (isA(m)) return A.payoutHtml(m);
  const r = payoutRates(m);
  const pub = Array.isArray(m.table.payout) ? m.table.payout : null;
  if (!r && !pub) return '';
  const pm = m.payoutModel || {};
  const pct = v => (v == null ? '—' : `${v.toFixed(1)}%`);
  const body = m.settings.map((s, i) => `<tr><td>${esc(s)}</td><td>${pub ? esc(pub[i]) : '—'}</td>`
    + `<td>${pct(r?.aim[i])}</td><td>${pct(r?.full?.[i])}</td></tr>`).join('');
  const notes = [];
  if (r) {
    const pays = [`BIG ${pm.big_net}枚`, `REG ${pm.reg_net}枚`, `ぶどう ${pm.grape_pay ?? 8}枚`,
      `チェリー ${pm.cherry_pay}枚`, `リプレイ ${pm.replay_pay ?? 3}枚`].join('・');
    notes.push(`チェリー狙い・完全攻略は、表の小役とボーナスから出した計算値です（1Gあたりの払い出し ÷ 3枚。${pays}）`);
    notes.push(pm.skill?.length
      ? `完全攻略は ${pm.skill.map(o => `${esc(o.label)}（1/${o.prob}・${o.pay}枚）`).join('・')}も取った場合です`
      : '完全攻略で取る小役（ベル・ピエロ）の確率が無いので、完全攻略は出せません');
    if (!has(m, 't_cherry')) notes.push('チェリーが重複を含む合算か分からないので、計算値は 0.1% ほどずれることがあります');
  } else {
    notes.push('払い出しの値が足りないので、チェリー狙い・完全攻略は出せません');
  }
  notes.push(pub ? '公表値は数え方が違い、計算値より低く出ます' : '公表値はまだ入っていません');
  return `<table class="tbl"><thead><tr><th>設定</th><th>公表値</th><th>チェリー狙い</th><th>完全攻略</th></tr></thead>`
    + `<tbody>${body}</tbody></table>${notes.map(n => `<p class="note">${n}</p>`).join('')}`;
}

// ---------------------------------------------------------------- 前任者のぶどう逆算（座る前の目安）

/** 逆算に要る値のうち、機種ファイルに無いもの */
export function backcalcMissing(m) {
  const pm = m.payoutModel || {};
  const miss = [];
  if (!(pm.big_net > 0)) miss.push('BIG 1回の純増枚数（big_net）');
  if (!(pm.reg_net > 0)) miss.push('REG 1回の純増枚数（reg_net）');
  if (!(pm.replay > 0)) miss.push('リプレイの確率（replay）');
  if (!has(m, 'grape')) miss.push('ぶどうの表（table.grape）');
  return miss;
}

/** BIG・REG だけから見た設定の確からしさ */
export const bonusPosterior = (m, games, big, reg) => posterior(m, { startG: games, totalG: games, prevBig: big, prevReg: reg, counts: {} }, true);

/**
 * 差枚 = BIG×純増 + REG×純増 + G×（ぶどう×8 + ほかの小役の払い出し − 3）を、ぶどうの回数について解く。
 * ほかの小役（チェリーなど）は設定で確率が違うので、BIG・REG から見た設定の確からしさで重み付けした値を置く。
 * 総G は通常時のゲーム数（データカウンターの表示）として扱う。readErr は差枚の読み違いの幅（±枚）
 */
export function backcalc(m, { games, big, reg, diff }, readErr = 100) {
  const pm = m.payoutModel || {};
  const post = bonusPosterior(m, games, big, reg);
  const otherPay = m.settings.map((_, i) => {
    let v = (pm.replay_pay ?? 3) / pm.replay;
    // チェリーは合算（cherry）。重複のボーナスのときもチェリーは払い出すので、非重複（t_cherry）ではなくこちら
    if (has(m, 'cherry') && pm.cherry_pay) v += pm.cherry_pay * (pm.cherry_take ?? 1) / m.table.cherry[i];
    for (const o of pm.others || []) v += o.pay / o.prob;
    return v;
  });
  const other = post.reduce((a, p, i) => a + p * otherPay[i], 0);
  const grapePay = pm.grape_pay ?? 8;
  const grapes = (diff - big * pm.big_net - reg * pm.reg_net + 3 * games - games * other) / grapePay;
  const spread = readErr / grapePay;
  const rateOf = k => (k > 0 ? games / k : null);
  const rate = rateOf(grapes);
  const better = rateOf(grapes + spread);   // 本当の差枚が読みより多かった場合（分母が小さい＝良い側）
  const worse = rateOf(grapes - spread);    // 少なかった場合
  return {
    post, grapes, rate, better, worse,
    near: nearest(m, 'grape', rate), nearBetter: nearest(m, 'grape', better), nearWorse: nearest(m, 'grape', worse),
    note: rate ? rangeNote(m, 'grape', rate) : '',
  };
}
