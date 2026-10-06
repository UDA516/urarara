// ジャグラーの型。機種ファイルの表（設定ごとの 1/N）から、数える項目・設定の確からしさ・近い設定・
// 設定差の表・前任者のぶどう逆算を出す。画面は持たない。
//
// 確からしさの組み立ては、渡されたカウンター（HTML）と同じ（項目ごとの二項分布の対数尤度を
// 足し、どの設定も同じ割合と置いて割合にする）:
//   自分だけ     … 自分の項目（契機別のボーナス・小役）を自分の消化Gで
//   前任者込み   … 上に、前任者の BIG・REG を前任者のG数（打ち始めG）で足す。小役は自分の消化Gのぶんだけ
// 前任者のぶどう逆算はここに入れない（座る前の目安。backcalc）
import { esc } from './ui.js';

export const LABEL = {
  big: 'BIG', reg: 'REG', t_big: '単独BIG', t_reg: '単独REG', c_big: 'チェリーBIG', c_reg: 'チェリーREG',
  p_big: 'ピエロBIG', p_reg: 'ピエロREG', grape: 'ぶどう', cherry: 'チェリー',
};

const has = (m, c) => Array.isArray(m.table?.[c]);

export function isJudgeable(m) {
  return !!m && m.type === 'juggler' && has(m, 'big') && has(m, 'reg');
}

/** チェリーに設定差があるか。無い機種はチェリーを数えない（チェリー重複のボーナスだけ数える） */
export function cherryVaries(m) {
  const a = m.table.cherry;
  return Array.isArray(a) && a.some(v => Math.abs(v - a[0]) > 1e-9);
}

/** 自分が数える項目。表に内訳の列があれば契機別、無ければ BIG・REG。小役は表にあるものだけ */
export function myItems(m) {
  const items = [];
  const bonus = (id, kind) => items.push({ id, label: LABEL[id], group: 'bonus', kind });
  if (has(m, 't_big') && has(m, 't_reg')) {
    bonus('t_big', 'big');
    bonus('t_reg', 'reg');
    if (has(m, 'c_big')) bonus('c_big', 'big');
    if (has(m, 'c_reg')) bonus('c_reg', 'reg');
    if (has(m, 'p_big')) bonus('p_big', 'big');
    if (has(m, 'p_reg')) bonus('p_reg', 'reg');
  } else {
    bonus('big', 'big');
    bonus('reg', 'reg');
  }
  if (has(m, 'grape')) items.push({ id: 'grape', label: LABEL.grape, group: 'role' });
  if (cherryVaries(m)) items.push({ id: 'cherry', label: LABEL.cherry, group: 'role' });
  return items;
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

/** 設定ごとの確からしさ（合計1）。withPrev で前任者の BIG・REG も入れる */
export function posterior(m, s, withPrev) {
  const myG = myGames(s);
  const items = myItems(m);
  return normalize(m.settings.map((_, i) => {
    let ll = 0;
    if (myG > 0) for (const it of items) ll += binomLL(s.counts?.[it.id], myG, 1 / m.table[it.id][i]);
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

/** 列の値（合算と BR比率は表に無ければ BIG・REG から出す） */
export function colValues(m, c) {
  if (c === 'combo') return has(m, 'combo') ? m.table.combo : m.table.big.map((b, i) => 1 / (1 / b + 1 / m.table.reg[i]));
  if (c === 'br') return m.table.big.map((b, i) => m.table.reg[i] / b);   // BIG回数 ÷ REG回数 の期待値
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
  for (const it of myItems(m)) if (!(it.id in mine)) mine[it.id] = den(st.myG, s.counts?.[it.id]);
  const all = {
    big: den(st.totalG, st.all.big), reg: den(st.totalG, st.all.reg), combo: den(st.totalG, st.all.big + st.all.reg),
    br: ratio(st.all.big, st.all.reg),
  };
  return { st, mine, all };
}

/** 要素ごとの表の行（渡されたカウンターの重要度順に、BIG・REG と残りの内訳を足した） */
export function elementRows(m) {
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
  return rows;
}

// 前任者込みの値でも印を付ける列（前任者は BIG・REG の合計しか分からない）
export const BOTH_COLS = new Set(['combo', 'big', 'reg', 'br']);

/** 設定差の表の列（渡されたカウンターの11列。チェリーは設定差があるときだけ） */
export function specColumns(m) {
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
  if (has(m, 'grape')) cols.push({ c: 'grape', label: 'ﾌﾞﾄﾞｳ', text: v => v.toFixed(2) });
  if (cherryVaries(m)) cols.push({ c: 'cherry', label: 'ﾁｪﾘｰ', text: v => v.toFixed(1) });
  return cols;
}

export function specTableHtml(m) {
  const cols = specColumns(m);
  const head = `<tr><th>設定</th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
  const body = m.settings.map((s, i) => `<tr><td>${esc(s)}</td>${cols.map(c => {
    const v = c.c === 'payout' ? m.table.payout[i] : colValues(m, c.c)[i];
    return `<td data-spec="${c.c}:${i}">${esc(c.text(v))}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="spec"><thead>${head}</thead><tbody>${body}</tbody></table>`;
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
