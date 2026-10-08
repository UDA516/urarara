// 設定。改修メモ・データの版と更新・逆算の読み違いの幅・端末の保存の状態・ロック
import * as catalog from '../catalog.js';
import { kvGet, kvSet } from '../db.js';
import { esc, fmtInt, fmtDate, fmtTime, toast, confirmDialog, copyText } from '../ui.js';
import { openNumpad } from '../numpad.js';
import { navigate } from '../nav.js';

const savedText = ms => (ms ? `${fmtDate(ms)} ${fmtTime(ms)} に保存` : '');

export async function render(root, args, ctx) {
  ctx.setBar({ title: '設定' });
  const d = catalog.data();
  const readErr = (await kvGet('readErr')) ?? 100;
  // 改修メモ: ホールで気づいた直したいところを書いておき、あとで PC で直す（ユーザーの指示 2026-10-08）。
  // この端末にだけ残す（記録の書き出しには入れない）。PC へはコピーして送る
  const notes = (await kvGet('devNotes')) || { text: '', updatedAt: null };
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const appVer = document.querySelector('meta[name="app-version"]')?.content || '';
  root.innerHTML = `
    <section class="card">
      <div class="card-title">改修メモ（あとで PC で直すこと）</div>
      <textarea class="memo" rows="6" placeholder="気づいた不具合・直したいところ・足したい機能" data-notes>${esc(notes.text)}</textarea>
      <p class="note" data-notes-saved>${savedText(notes.updatedAt)}</p>
      <div class="actions two" style="margin:10px 0 0">
        <button type="button" class="btn" data-notes-clear>空にする</button>
        <button type="button" class="btn" data-notes-copy>コピーする</button>
      </div>
      <p class="note">書くたびにこの端末に保存します（記録の書き出しには入りません）。PC へはコピーして送ってください。</p>
    </section>
    <section class="card">
      <div class="card-title">データ</div>
      <div class="kv"><span>版</span><b>${esc(catalog.versionLabel())}</b></div>
      <div class="kv"><span>機種</span><b>${d.machines.length}</b></div>
      <button type="button" class="btn btn-block" data-update style="margin-top:10px">更新を確かめる</button>
    </section>
    <section class="card">
      <div class="card-title">ぶどう逆算</div>
      <button type="button" class="field" data-readerr><span class="k">差枚の読み違いの幅（±枚）</span><b>${fmtInt(readErr)}</b></button>
      <p class="note">グラフを目で読む前提で、逆算の結果に幅を付けます。</p>
    </section>
    <section class="card">
      <div class="card-title">この端末の保存</div>
      <div class="kv"><span>消えにくくする設定</span><b>${persisted === true ? '有効' : persisted === false ? '無効' : '分からない'}</b></div>
      ${est ? `<div class="kv"><span>使っている容量</span><b>${fmtInt(est.usage / 1024)} KB</b></div>` : ''}
      ${persisted === false ? '<button type="button" class="btn btn-block" data-persist style="margin-top:10px">消えにくくする</button>' : ''}
      <p class="note">記録は書き出すまでこの端末の中にしかありません。こまめに「記録」から書き出してください。</p>
    </section>
    <section class="card">
      <div class="card-title">ロック</div>
      <button type="button" class="btn btn-danger btn-block" data-lock>ロックする</button>
      <p class="note">次に開くときにパスワードが要ります。記録は消えません。</p>
    </section>
    <p class="note" style="text-align:center">アプリの版 ${esc(appVer)}</p>`;

  const ta = root.querySelector('[data-notes]');
  const saveNotes = async text => {
    notes.text = text;
    notes.updatedAt = Date.now();
    try {
      await kvSet('devNotes', { ...notes });
      root.querySelector('[data-notes-saved]').textContent = savedText(notes.updatedAt);
    } catch (e) {
      toast('改修メモを保存できませんでした: ' + (e.message || e), { ms: 6000 });
    }
  };
  ta.addEventListener('input', () => saveNotes(ta.value));

  root.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-notes-copy]')) {
      if (!ta.value.trim()) { toast('改修メモが空です'); return; }
      const head = `台メモの改修メモ（${savedText(notes.updatedAt) || '未保存'}・アプリの版 ${appVer}・データの版 ${catalog.versionLabel()}）`;
      if (await copyText(`${head}\n${ta.value.trim()}\n`)) toast('コピーしました');
    } else if (t.closest('[data-notes-clear]')) {
      if (!ta.value) return;
      const ok = await confirmDialog('改修メモを空にしますか？ PC へ送っていなければ元に戻せません。', [
        { label: '空にする', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
      if (!ok) return;
      ta.value = '';
      await saveNotes('');
    } else if (t.closest('[data-update]')) {
      await ctx.checkUpdate();
      navigate('#/settings');
    } else if (t.closest('[data-readerr]')) {
      const r = await openNumpad({ title: '差枚の読み違いの幅（±枚）', value: readErr, max: 4 });
      if (r) { await kvSet('readErr', Math.max(0, r.value)); navigate('#/settings'); }
    } else if (t.closest('[data-persist]')) {
      const ok = await navigator.storage.persist().catch(() => false);
      toast(ok ? '消えにくくしました' : 'この端末では設定できませんでした（ホーム画面に追加すると通ることがあります）');
      navigate('#/settings');
    } else if (t.closest('[data-lock]')) {
      const ok = await confirmDialog('ロックしますか？ 次に開くときにパスワードが要ります。', [
        { label: 'ロックする', value: true, kind: 'danger' }, { label: 'やめる', value: false }]);
      if (ok) await ctx.relock();
    }
  });
}
