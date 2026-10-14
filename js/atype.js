// A タイプ（ジャグラー以外）。数える項目（契機別のボーナス・小役・示唆など）は機種ファイルの [[count]] に書き、
// build.py が items（数える項目の並び）と table（設定ごとの 1/N。big・reg・combo は内訳から出したもの）にする。
// 判別の計算は juggler.js と同じもの（項目ごとの二項分布の対数尤度）を使い、ここは型で違うところだけを持つ:
// 要素の行・設定差の表の組・後から内訳が分かる組（合算と種別）・機械割（ボーナス1回の平均の投入と払い出しから出す）。逆算はしない
// AT機（type = "at"。2026-10-13〜）もここで扱う。BIG・REG の場所に数えるもの（ST・CZ など）の名前は機種ファイルの [names]。
// 足しても意味が無いので、合算・BR比率は出さない
import { esc } from './ui.js';

/** BIG・REG の場所に数えるものの名前と、G数の呼び名（機種ファイルの [names]。無ければ BIG・REG、games は null）。
 *  all は通常G のほかに入れる総G の呼び名（AT中も数える項目の分母。無ければ null） */
export const names = m => ({ big: m?.names?.big || 'BIG', reg: m?.names?.reg || 'REG', games: m?.names?.games || null, all: m?.names?.all || null });

/** 合算・BR比率を出す型か（AT機は出さない） */
export const hasCombo = m => m?.type !== 'at';

/** 合算・BIG・REG をまとめた組の名前（要素ごと・設定差の表の先頭の組。判別の画面の契機の内訳が無いボーナスの組） */
export const mainTitle = m => (hasCombo(m) ? 'ボーナス' : `${names(m).big}・${names(m).reg}`);

/** items の group:
 *   bonus（契機別のボーナス。kind で BIG・REG に足す）・role（小役。per があればその G数の欄で、of（AT中の欄）なら
 *   自分の総G − 自分の通常G で数える）は確率を持ち、計算に入る。
 *   games（G数の欄）・hint（示唆。1回でも数えたら excludes の設定を外す）・tally（数えるだけ）は入らない。
 *   sum（合算）・rest（見えない種別をまとめた行）は、後から内訳が分かる組のもの。その組の小役（split を持つ。
 *   hidden は単独では見られない種別）と合わせて計算する（splitLL） */
export const isProb = it => it.group === 'bonus' || it.group === 'role';

/** 「—」（数えていない）を持てる項目。小役と合算は、数字が入るまで計算に入れない（入れば 0回も「引かなかった」として入れる）。
 *  数えていない小役を 0回と読むと結果が大きくずれるため（ユーザーと決めたこと 2026-10-08。1,000G でプラムを数えずに
 *  0回と読むと 5以上 0.7%、数えない扱いなら 49.1%）。ボーナスは必ず気づくので 0回 ＝ 引かなかった のまま */
export const optional = it => it.group === 'role' || it.group === 'sum';

/** 表に確率の列がある項目（要素ごと・設定差の表に出せる）。合算・まとめた行も列を持つ */
const hasCol = it => isProb(it) || it.group === 'sum' || it.group === 'rest';

export const items = m => m.items || [];

const varies = (m, c) => Array.isArray(m.table?.[c]) && m.table[c].some(v => (v == null) !== (m.table[c][0] == null) || Math.abs(v - m.table[c][0]) > 1e-9);

/** 通常時と AT中で分けて数える小役（2026-10-14。AT中も見分けられる共通ベルなど）。元の項目は at に AT中の欄の id を、AT中の欄は of に
 *  元の id を持つ。分母は 通常時 ＝ 自分の通常G、AT中 ＝ 自分の総G − 自分の通常G。要素ごと・設定差の表には合わせて1つ
 *  （元の項目の列に「通常時＋AT中」として）出し、AT中の欄は出さない */
const colLabel = (m, it) => (it.at ? `${it.short}＋${items(m).find(x => x.id === it.at)?.short ?? ''}` : it.short);

/** 項目の組の名前（要素ごとの表・設定差の表）。ボーナスは「白7BBの契機」のように。回数を計算に入れない組（ref）は
 *  「CZの内訳」のように（中身は契機でなく種類のことが多く、計算に入るのも内訳の割合だけのため） */
const groupTitle = it => (it.group === 'bonus' ? `${it.sec}の${it.ref ? '内訳' : '契機'}` : it.sec);

// ---------------------------------------------------------------- 回数を計算に入れないボーナスの組（ref）
// AT機の CZ は、ST の多くが CZ を通るので、CZ と ST を別々に計算に入れると同じことを二重に数える（2026-10-13）。
// なので回数（確率）は計算に入れず、前任者のその回数も入れない（近い設定だけ出す）。項目が2つ以上なら、
// 内訳の割合（CZ のうちの幼少期CZ など）だけを入れる。回数で割った割合は、ST とは重ならない

/** kind（big・reg）の組が、回数を計算に入れない組か（前任者のその回数も入れない） */
export const refKind = (m, kind) => {
  const list = items(m).filter(it => it.group === 'bonus' && it.kind === kind);
  return list.length > 0 && list.every(it => it.ref);
};

/** 回数を計算に入れない組のうち、項目が2つ以上のもの（内訳の割合を計算に入れる）。{ sec, parts } の並び */
export function refGroups(m) {
  const out = [];
  for (const it of items(m).filter(x => x.group === 'bonus' && x.ref)) {
    let g = out.find(x => x.sec === it.sec);
    if (!g) out.push(g = { sec: it.sec, parts: [] });
    g.parts.push(it);
  }
  return out.filter(g => g.parts.length > 1);
}

/** 内訳の割合の対数尤度（設定 i）: Σ 項目の回数 · log（その項目の p ÷ 組の p の和）。組の回数がいくつでも、割合だけを見る */
export function refLL(m, g, counts, i) {
  // その設定では出ない項目（null）は p を 0 に（数えていればその設定は excluded で外れる）
  const p = g.parts.map(it => (m.table[it.id][i] == null ? 0 : 1 / m.table[it.id][i]));
  const all = p.reduce((a, b) => a + b, 0);
  return g.parts.reduce((ll, it, j) => {
    const k = counts?.[it.id] || 0;
    return k > 0 && p[j] > 0 ? ll + k * Math.log(p[j] / all) : ll;
  }, 0);
}

/** その設定では出ない項目の、設定の添字（表の値が null。ボーナスの flags に 0 を書いたところ。2026-10-13。
 *  高設定でしか出ない契機があるため）。判別では 1回でも数えたらその設定を外す（juggler.js の excluded）。ジャグラーの表には無い */
export const never = (m, it) => (m.table?.[it.id] || []).flatMap((v, i) => (v == null ? [i] : []));

/** 契機の内訳が無いボーナス（ボーナスの組に項目が1つだけ）。その項目は BIG・REG そのものなので、要素ごと・設定差の表の
 *  契機の行・列には出さない（ボーナスの BIG・REG と同じものが二重に出るため）。判別の画面では「ボーナス」の組にまとめる */
export const plainBonus = (m, it) => it.group === 'bonus'
  && items(m).filter(x => x.group === 'bonus' && x.sec === it.sec).length === 1;

// ---------------------------------------------------------------- 後から内訳が分かる組
// ユーザーの指示 2026-10-08（台のデータ表示の見え方）: 合算は最初から見られ、種別は条件を満たすと見られる。
// 見られるようになった数字は打ち始めからの全部。なので合算はいつも数え、種別は見られるようになったら打ち始めからの
// 回数を入れる（それまでは「分からない」＝数字が入っていない。0回とは別。合算も数え始めるまでは「—」）。単独では見られない種別（hidden）は、
// 見られる種別が全部分かったら rest（合算 − 分かった種別）にまとめて出す

/** 後から内訳が分かる組（{ sum: 合算の項目, parts: 種別の小役, rest: 見えない種別をまとめた項目 か null }）の並び */
export function splits(m) {
  const list = items(m);
  return list.filter(it => it.group === 'sum').map(sum => ({
    sum,
    parts: list.filter(it => it.group === 'role' && it.split === sum.id),
    rest: list.find(it => it.group === 'rest' && it.split === sum.id) || null,
  }));
}

/** 項目の入っている組（合算・種別・まとめた行のどれでも） */
export const splitOf = (m, id) => splits(m).find(sp => sp.sum.id === id || sp.rest?.id === id || sp.parts.some(it => it.id === id));

/** 種別の回数。数字が入っていなければ null（まだ見られない） */
export const partCount = (counts, id) => (Number.isFinite(counts?.[id]) ? counts[id] : null);

/**
 * 組の読み方。n は種別ごとの回数（分からない種別・hidden は null）、known はその和。
 * open は分からない種別が残るか（hidden があれば いつも）。残らなければ合算は種別の和、残れば入れた合算（種別の和より小さくはしない）。
 * 合算も「—」（数えていない）なら sum は null。rest は 合算 − 分かった種別（分からない種別のどれか。合算が分からなければ null）。
 * visKnown は見られる種別が全部分かったか（まとめた行を出せるか）
 */
export function splitState(sp, counts) {
  const n = sp.parts.map(it => (it.hidden ? null : partCount(counts, it.id)));
  const known = n.reduce((a, k) => a + (k ?? 0), 0);
  const open = n.some(k => k == null);
  const given = partCount(counts, sp.sum.id);
  const sum = !open ? known : given == null ? null : Math.max(given, known);
  return { n, known, open, sum, rest: sum == null ? null : sum - known, visKnown: sp.parts.every((it, j) => it.hidden || n[j] != null) };
}

/** 項目の回数。合算は上の sum、まとめた行は見られる種別が全部分かったときの残り、種別は分かっているときだけ、
 *  ほかの小役は数字が入っているときだけ（「—」は null）。ボーナスなどは数えた回数（無ければ 0） */
export function countOf(m, it, counts) {
  const sp = m && (it.group === 'sum' || it.group === 'rest' || it.split) ? splitOf(m, it.id) : null;
  if (!sp) return optional(it) ? partCount(counts, it.id) : counts?.[it.id] || 0;
  const st = splitState(sp, counts);
  if (it.group === 'sum') return st.sum;
  if (it.group === 'rest') return st.visKnown ? st.rest : null;
  return it.hidden ? null : partCount(counts, it.id);
}

/**
 * 組の対数尤度（設定 i、分母は games）。分かった種別・残り（分からない種別のどれか）・どれでもないゲームの多項分布:
 *   合算が分かる   … Σ 分かった種別 n·log p ＋ 残り·log（分からない種別の p の和）＋（G − 合算）·log（1 − 全部の p の和）
 *   合算が「—」    … Σ 分かった種別 n·log p ＋（G − その和）·log（1 − 分かった種別の p の和）
 * 種別が何も分からなければ合算の二項分布、全部分かれば種別ごとの多項分布になる。0回と分かった種別も p を残りから外す。
 * 合算も種別も「—」なら何も足さない
 */
export function splitLL(m, sp, counts, games, i) {
  const st = splitState(sp, counts);
  const p = sp.parts.map(it => 1 / m.table[it.id][i]);
  const pAll = p.reduce((a, b) => a + b, 0);
  let ll = 0, pk = 0;
  st.n.forEach((k, j) => { if (k != null) { if (k > 0) ll += k * Math.log(p[j]); pk += p[j]; } });
  if (st.sum == null) return ll + Math.max(0, games - st.known) * Math.log1p(-pk);
  if (st.rest > 0 && pAll - pk > 1e-12) ll += st.rest * Math.log(pAll - pk);
  return ll + Math.max(0, games - st.sum) * Math.log1p(-pAll);
}

/** 要素ごとの表の行。合算・BIG・REG と、設定差のある項目（無いものはどの設定にも同じ近さで、出しても意味が無い）。
 *  sec は組の名前（組ごとにたためる表にする）、label は組の中での名前 */
export function elementRows(m) {
  const N = names(m), main = mainTitle(m);
  return [
    ...(hasCombo(m) ? [{ c: 'combo', label: 'ボーナス合算', both: true, sec: main }] : []),
    { c: 'big', label: N.big, both: true, sec: main },
    { c: 'reg', label: N.reg, both: true, sec: main },
    ...items(m).filter(it => hasCol(it) && !it.hidden && !it.of && !plainBonus(m, it) && varies(m, it.id))
      .map(it => ({ c: it.id, label: colLabel(m, it), both: false, sec: groupTitle(it), ...(it.pct ? { pct: true } : {}) })),
  ];
}

/** 1/N の N。内訳の確率は分母が大きいので、1000 からは整数で。その設定では出ないもの（null）は「—」 */
const fmtN = v => (v == null ? '—' : v < 10 ? v.toFixed(2) : v < 1000 ? v.toFixed(1) : v.toFixed(0));
/** 割合（%）で書いた項目（pct。400G到達時の当選率のように資料が % のもの）は % で */
const fmtP = v => (v == null ? '—' : `${(100 / v).toFixed(1)}%`);

/** 設定差の表を、ボーナス・契機（ボーナスの種類ごと）・小役などの組に分ける。label は HTML（中身は esc 済み）。
 *  設定差の無い列は表には出すが、近い設定の塗りはしない（noMark） */
export function specGroups(m) {
  const head = [];
  if (Array.isArray(m.table.payout)) head.push({ c: 'payout', label: '出玉率', text: String });
  if (hasCombo(m)) {
    head.push(
      { c: 'br', label: 'BR比率', text: v => `${v.toFixed(2)} : 1` },
      { c: 'combo', label: 'ボーナス<br>合算', text: v => v.toFixed(1) },
    );
  }
  // 名前を付け替えた機種（[names]）は「ST<br>確率」のように
  const lab = (k, def) => (m.names?.[k] ? `${esc(m.names[k])}<br>確率` : def);
  head.push(
    { c: 'big', label: lab('big', 'BB確率'), text: v => v.toFixed(1) },
    { c: 'reg', label: lab('reg', 'RB確率'), text: v => v.toFixed(1) },
  );
  const groups = [{ title: mainTitle(m), cols: head }];
  for (const it of items(m).filter(it => hasCol(it) && !it.of && !plainBonus(m, it))) {
    const title = groupTitle(it);
    let g = groups.find(x => x.title === title);
    if (!g) groups.push(g = { title, cols: [] });
    g.cols.push({ c: it.id, label: esc(colLabel(m, it)), text: it.pct ? fmtP : fmtN, noMark: !varies(m, it.id) });
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
  // AT機は小役とボーナスから機械割を出す作りが無いので、公表値だけ（計算の列は全部「—」になるため）
  if (!r && !hasCombo(m)) {
    return `<table class="tbl"><thead><tr><th>設定</th><th>公表値</th></tr></thead><tbody>${
      m.settings.map((s, i) => `<tr><td>${esc(s)}</td><td>${esc(pub[i])}</td></tr>`).join('')}</tbody></table>`;
  }
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
