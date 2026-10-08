// A タイプ（ジャグラー以外）。数える項目（契機別のボーナス・小役・示唆など）は機種ファイルの [[count]] に書き、
// build.py が items（数える項目の並び）と table（設定ごとの 1/N。big・reg・combo は内訳から出したもの）にする。
// 判別の計算は juggler.js と同じもの（項目ごとの二項分布の対数尤度）を使い、ここは型で違うところだけを持つ:
// 要素の行・設定差の表の組・機械割（ボーナス1回の平均の投入と払い出しから出す）。逆算はしない
import { esc } from './ui.js';

/** items の group:
 *   bonus（契機別のボーナス。kind で BIG・REG に足す）・role（小役。per があればその G数の欄で数える）は確率を持ち、計算に入る。
 *   games（G数の欄）・hint（示唆。1回でも数えたら excludes の設定を外す）・tally（数えるだけ）は入らない */
export const isProb = it => it.group === 'bonus' || it.group === 'role';

export const items = m => m.items || [];

const varies = (m, c) => Array.isArray(m.table?.[c]) && m.table[c].some(v => Math.abs(v - m.table[c][0]) > 1e-9);

/** 項目の組の名前（要素ごとの表・設定差の表）。ボーナスは「白7BBの契機」のように */
const groupTitle = it => (it.group === 'bonus' ? `${it.sec}の契機` : it.sec);

/** 要素ごとの表の行。合算・BIG・REG と、設定差のある項目（無いものはどの設定にも同じ近さで、出しても意味が無い）。
 *  sec は組の名前（組ごとにたためる表にする）、label は組の中での名前 */
export function elementRows(m) {
  return [
    { c: 'combo', label: 'ボーナス合算', both: true, sec: 'ボーナス' },
    { c: 'big', label: 'BIG', both: true, sec: 'ボーナス' },
    { c: 'reg', label: 'REG', both: true, sec: 'ボーナス' },
    ...items(m).filter(it => isProb(it) && varies(m, it.id)).map(it => ({ c: it.id, label: it.short, both: false, sec: groupTitle(it) })),
  ];
}

/** 1/N の N。内訳の確率は分母が大きいので、1000 からは整数で */
const fmtN = v => (v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(1) : v.toFixed(0));

/** 設定差の表を、ボーナス・契機（ボーナスの種類ごと）・小役などの組に分ける。label は HTML（中身は esc 済み）。
 *  設定差の無い列は表には出すが、近い設定の塗りはしない（noMark） */
export function specGroups(m) {
  const head = [];
  if (Array.isArray(m.table.payout)) head.push({ c: 'payout', label: '出玉率', text: String });
  head.push(
    { c: 'br', label: 'BR比率', text: v => `${v.toFixed(2)} : 1` },
    { c: 'combo', label: 'ボーナス<br>合算', text: v => v.toFixed(1) },
    { c: 'big', label: 'BB確率', text: v => v.toFixed(1) },
    { c: 'reg', label: 'RB確率', text: v => v.toFixed(1) },
  );
  const groups = [{ title: 'ボーナス', cols: head }];
  for (const it of items(m).filter(isProb)) {
    const title = groupTitle(it);
    let g = groups.find(x => x.title === title);
    if (!g) groups.push(g = { title, cols: [] });
    g.cols.push({ c: it.id, label: esc(it.short), text: fmtN, noMark: !varies(m, it.id) });
  }
  return groups;
}

// ---------------------------------------------------------------- 機械割

/** 数字1つか設定ごとの並びの、i 番目の設定の値 */
const at = (v, i) => (Array.isArray(v) ? v[i] : v);
/** 画面に出す形（並びは「最小〜最大」） */
const span = v => (Array.isArray(v) ? `${Math.min(...v)}〜${Math.max(...v)}` : v);

/**
 * 設定ごとの機械割（%）と通常時のベース。1サイクル（ボーナス1回ぶんの通常時）の 払い出し ÷ 投入:
 *   通常時 … 1Gあたり bet 枚を入れ、リプレイ（replay_pay 枚と数える）と小役（pay）を払い出す
 *   ボーナス … BIG・REG 1回の平均の投入（big_in・reg_in）と払い出し（big_out・reg_out）
 *   RT … BIG のあとの RT（rt_games は1回の平均G数）。ボーナスは RT 中も引けるので、RT のG数はボーナスの確率の分母
 *         （通常時のG数）の中に入る。その割合だけ通常時の投入・払い出しを減らし、RT の投入・払い出しは big_in・big_out に入れておく
 * big_in・big_out・reg_in・reg_out・rt_games は、数字1つか設定ごとの並び。
 * hypothesis（仮説）は、その設定だけボーナスの値を置き換えて出す。値が足りなければ null
 */
export function payoutRates(m) {
  const pm = m.payoutModel || {};
  const ok = v => (Array.isArray(v) ? v.length === m.settings.length && v.every(x => x > 0) : v > 0);
  if (!(pm.replay > 0 && ok(pm.big_in) && ok(pm.big_out) && ok(pm.reg_in) && ok(pm.reg_out))) return null;
  const bet = pm.bet ?? 3;
  const roles = items(m).filter(it => it.group === 'role' && !it.per && it.pay != null);
  const normal = m.settings.map((_, i) => (pm.replay_pay ?? 3) / pm.replay + roles.reduce((a, it) => a + it.pay / m.table[it.id][i], 0));
  const rate = (i, b) => {
    const big = m.table.big[i], reg = m.table.reg[i];
    const n = 1 - (at(b.rt_games, i) || 0) / big;   // 通常時の G数のうち、RT でないゲームの割合
    return (normal[i] * n + at(b.big_out, i) / big + at(b.reg_out, i) / reg) / (bet * n + at(b.big_in, i) / big + at(b.reg_in, i) / reg) * 100;
  };
  return {
    calc: m.settings.map((_, i) => rate(i, pm)),
    hyps: (pm.hypothesis || []).map(h => ({ ...h, values: m.settings.map((s, i) => (h.settings.includes(s) ? rate(i, { ...pm, ...h }) : null)) })),
    base: normal.map(v => (bet > v ? 50 / (bet - v) : null)),
  };
}

/** 機械割の表（公表値・完全攻略の計算値・仮説・ベース）と、出し方の断り。出せるものが無ければ空 */
export function payoutHtml(m) {
  const r = payoutRates(m);
  const pub = Array.isArray(m.table.payout) ? m.table.payout : null;
  if (!r && !pub) return '';
  const pm = m.payoutModel || {};
  const pct = v => (v == null ? '—' : `${v.toFixed(1)}%`);
  const hyps = r?.hyps || [];
  const head = `<tr><th>設定</th><th>公表値</th><th>完全攻略<br>（計算）</th>${hyps.map(() => '<th>仮説</th>').join('')}<th>ベース</th></tr>`;
  const body = m.settings.map((s, i) => `<tr><td>${esc(s)}</td><td>${pub ? esc(pub[i]) : '—'}</td><td>${pct(r?.calc[i])}</td>`
    + `${hyps.map(h => `<td>${pct(h.values[i])}</td>`).join('')}<td>${r?.base[i] ? `${r.base[i].toFixed(1)}G` : '—'}</td></tr>`).join('');
  const notes = [];
  if (r) {
    notes.push(`完全攻略（計算）は、表の小役とボーナスから出した値です（小役を全部取り、ボーナスは成立したゲームで揃える。`
      + `BIG 1回 投入${span(pm.big_in)}・払い出し${span(pm.big_out)}枚${pm.rt_games ? `（あとの RT 平均${span(pm.rt_games)}G を含む）` : ''}、`
      + `REG 1回 投入${span(pm.reg_in)}・払い出し${span(pm.reg_out)}枚）`);
    if (pm.rt_games) notes.push('ボーナスは RT 中も引けるので、RT のG数は通常時のG数の中に数えています');
    for (const h of hyps) {
      const swap = [['big_in', 'BIG 投入'], ['big_out', 'BIG 払い出し'], ['reg_in', 'REG 投入'], ['reg_out', 'REG 払い出し']]
        .filter(([k]) => h[k] != null).map(([k, l]) => `${l}${h[k]}枚`).join('・');
      notes.push(`仮説（${esc(h.label)}）は、設定${h.settings.map(esc).join('・')}を ${swap} で出した値です。${h.note ? `${esc(h.note)}。` : ''}判別の計算には使いません`);
    }
    notes.push('ベースは通常時の50枚あたりの回転数（小役を全部取った場合）');
  } else {
    notes.push('払い出しの値が足りないので、完全攻略の計算値は出せません');
  }
  if (!pub) notes.push('公表値はまだ入っていません');
  return `<table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table>${notes.map(n => `<p class="note">${n}</p>`).join('')}`;
}
