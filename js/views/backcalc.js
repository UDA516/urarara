// ぶどう逆算（座る前に使うだけ）。G数・BIG・REG・差枚（グラフから目で読む）から前任者のぶどうを逆算する。
// 結果は判別には入れない。「この台に座る」で G数・BIG・REG を判別の前任者情報へ引き継ぐ（差枚は引き継がない）
import * as catalog from '../catalog.js';
import * as J from '../juggler.js';
import { kvGet, kvSet } from '../db.js';
import { esc, fmtInt, fmtSigned, fmtDen, fmtPct } from '../ui.js';
import { editChain } from '../numpad.js';
import { startSession, pickMachine } from './judge.js';

const EMPTY = { games: 0, big: 0, reg: 0, diff: 0 };
const FIELDS = [
  { key: 'games', title: 'G数' },
  { key: 'big', title: 'BIG' },
  { key: 'reg', title: 'REG' },
  { key: 'diff', title: '差枚（グラフから）', negative: true },
];

export async function render(root, args, ctx) {
  ctx.setBar({ title: 'ぶどう逆算（座る前）' });
  const list = catalog.machines().filter(J.canBackcalc);   // ジャグラーだけ（A タイプは逆算しない）
  const st = Object.assign({ machineId: null }, EMPTY, await kvGet('backcalc'));
  if (args[0]) st.machineId = args[0];   // 機種の画面の「ぶどう逆算」から
  if (!list.some(m => m.id === st.machineId)) st.machineId = list[0]?.id ?? null;
  const readErr = (await kvGet('readErr')) ?? 100;
  if (!st.machineId) {
    root.innerHTML = '<p class="empty">逆算できる機種（ジャグラーの型）がまだありません</p>';
    return;
  }
  const save = () => kvSet('backcalc', st).catch(() => {});

  const bonusHtml = m => {
    if (!(st.games > 0)) return '';
    const post = J.bonusPosterior(m, st.games, st.big, st.reg);
    const row = (label, c, v) => {
      const near = J.nearest(m, c, v);
      return `<tr><td>${label}</td><td>${fmtDen(v)}${near ? `<small>設定${esc(near.text)}</small>` : ''}</td></tr>`;
    };
    const den = k => (k > 0 ? st.games / k : null);
    return `<section class="card">
      <div class="card-title">BIG・REG から見た目安</div>
      <table class="tbl"><tbody>
        ${row('ボーナス合算', 'combo', den(st.big + st.reg))}
        ${row('BIG', 'big', den(st.big))}
        ${row('REG', 'reg', den(st.reg))}
        <tr><td>${esc(J.highLabel(m))}以上の確からしさ</td><td><b>${fmtPct(J.highShare(m, post))}</b></td></tr>
      </tbody></table>
    </section>`;
  };

  const resultHtml = m => {
    const miss = J.backcalcMissing(m);
    if (miss.length) {
      return `<section class="card warn-card">
          <div class="card-title" style="color:inherit">逆算に要る値が機種ファイルにありません</div>
          <ul>${miss.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="note" style="color:inherit">PC の機種ファイルの [payout_model] に足して書き出すと出ます。BIG・REG から見た目安だけ下に出します。</p>
        </section>${bonusHtml(m)}`;
    }
    if (!(st.games > 0)) return '<p class="empty">G数・BIG・REG・差枚を入れると出ます</p>';
    const r = J.backcalc(m, st, readErr);
    const nearTxt = n => (n ? `設定${esc(n.text)}` : '—');
    const grape = r.rate
      ? `<div class="big-num">${fmtDen(r.rate)} <span class="near" style="font-size:16px">${nearTxt(r.near)}</span></div>
         ${r.note ? `<p class="sub" style="color:var(--warn)">${esc(r.note)}</p>` : ''}
         <p class="sub">差枚 ±${fmtInt(readErr)}枚の読み違いで ${fmtDen(r.better)}〜${fmtDen(r.worse)}（${nearTxt(r.nearBetter)}〜${nearTxt(r.nearWorse)}）</p>
         <p class="sub">逆算したぶどう 約${fmtInt(r.grapes)}回</p>`
      : '<p>計算できませんでした。G数・回数・差枚を確かめてください。</p>';
    return `<section class="card"><div class="card-title">前任者のぶどう（逆算）</div>${grape}</section>
      ${bonusHtml(m)}
      <p class="note">払い出しは機種ファイルの公表値、総Gは通常時のゲーム数として計算しています。チェリーなどは BIG・REG から見た設定の確からしさで重み付けした値を置いています。この逆算は判別の結果には入れません。</p>`;
  };

  const draw = () => {
    const m = catalog.machine(st.machineId);
    const field = (f, wide) => `<button type="button" class="field ${wide ? 'fields-wide' : ''}" data-edit="${f.key}"><span class="k">${f.title}</span><b>${f.negative ? fmtSigned(st[f.key]) : fmtInt(st[f.key])}</b></button>`;
    root.innerHTML = `
      <button type="button" class="row" data-pick><span class="k">機種（押して変える）</span><span class="row-main">${esc(m.name)}</span></button>
      <div class="fields3" style="margin:10px 0 12px">${FIELDS.map(f => field(f, f.key === 'diff')).join('')}</div>
      ${resultHtml(m)}
      <div class="actions dock two">
        <button type="button" class="btn" data-clear>次の台</button>
        <button type="button" class="btn btn-accent" data-sit>この台に座る</button>
      </div>`;
  };

  root.addEventListener('click', async e => {
    const t = e.target;
    let b;
    if ((b = t.closest('[data-edit]'))) {
      const start = FIELDS.findIndex(f => f.key === b.dataset.edit);
      await editChain(FIELDS.map(f => ({
        title: f.title, negative: f.negative, get: () => st[f.key],
        set: v => { st[f.key] = f.negative ? v : Math.max(0, v); save(); draw(); },
      })), start);
    } else if (t.closest('[data-clear]')) {
      Object.assign(st, EMPTY);   // 機種はそのまま（同じ島を続けて見るため）
      save();
      draw();
    } else if (t.closest('[data-sit]')) {
      const m = catalog.machine(st.machineId);
      const started = await startSession(m, { startG: st.games, prevBig: st.big, prevReg: st.reg });
      if (started) { Object.assign(st, EMPTY); save(); }
    } else if (t.closest('[data-pick]')) {
      pickMachine(list, id => { st.machineId = id; save(); draw(); });
    }
  });

  draw();
}
