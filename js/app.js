// 起動・ロック・画面の切り替え（#/タブ/…）・更新の確認。
// 画面の状態は location.hash が正。タブを押す・戻る → hashchange → route()
import * as catalog from './catalog.js';
import { esc, toast } from './ui.js';
import { setReroute } from './nav.js';
import * as machinesView from './views/machines.js';
import * as backcalcView from './views/backcalc.js';
import * as judgeView from './views/judge.js';
import * as recordsView from './views/records.js';
import * as settingsView from './views/settings.js';

const TABS = [
  { id: 'machines', label: '機種', view: machinesView },
  { id: 'backcalc', label: '逆算', view: backcalcView },
  { id: 'judge', label: '判別', view: judgeView },
  { id: 'records', label: '記録', view: recordsView },
  { id: 'settings', label: '設定', view: settingsView },
];
const LAST_TAB = 'slot-memo.lastTab';   // 開いたときに最後のタブから始める（端末ごとの好みなので localStorage）
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } };

const bar = document.getElementById('bar');
const main = document.getElementById('view');
const tabs = document.getElementById('tabs');
const lockEl = document.getElementById('lock');

// ---------------------------------------------------------------- ヘッダー

let barRight = null;
function setBar({ title = '', back = null, right = null } = {}) {
  barRight = right;
  const rightHtml = !right ? ''
    : right.href ? `<a class="bar-right" href="${esc(right.href)}">${esc(right.label)}</a>`
      : `<button type="button" class="bar-right">${esc(right.label)}</button>`;
  bar.innerHTML = `${back ? `<a class="bar-back" href="${esc(back)}">戻る</a>` : ''}<h1 class="bar-title">${esc(title)}</h1>${rightHtml}`;
}
bar.addEventListener('click', e => { if (e.target.closest('button.bar-right')) barRight?.onClick?.(); });
// 判別の要約をヘッダーの真下に固定するため、ヘッダーの高さ（ノッチの分を含む）を CSS へ
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);

// ---------------------------------------------------------------- 画面の切り替え

tabs.innerHTML = TABS.map(t => `<a href="#/${t.id}" data-tab="${t.id}">${t.label}</a>`).join('');
tabs.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});

const ctx = { setBar, checkUpdate: () => checkUpdate(true), relock };

async function route() {
  if (!catalog.data()) return;   // ロック中
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const tab = TABS.find(t => t.id === parts[0]);
  if (!tab) { location.replace('#/' + (TABS.some(t => t.id === lsGet(LAST_TAB)) ? lsGet(LAST_TAB) : 'judge')); return; }
  lsSet(LAST_TAB, tab.id);
  tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab.id));
  setBar({ title: tab.label });
  // 画面ごとに器を作り直す（前の画面の非同期の描画が、新しい画面に書き込まないように）
  const root = document.createElement('div');
  main.replaceChildren(root);
  window.scrollTo(0, 0);
  try {
    await tab.view.render(root, parts.slice(1), ctx);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="card warn-card">画面を出せませんでした: ${esc(e.message || e)}</div>`;
  }
}
setReroute(route);
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- ロック

function showLock(message) {
  document.body.classList.add('locked');
  const form = lockEl.querySelector('form');
  const pw = lockEl.querySelector('#lock-pw');
  const err = lockEl.querySelector('#lock-err');
  const btn = form.querySelector('button[type=submit]');
  if (message) lockEl.querySelector('#lock-msg').textContent = message;
  err.hidden = true;
  pw.value = '';
  return new Promise(resolve => {
    form.onsubmit = async e => {
      e.preventDefault();
      if (!pw.value) return;
      btn.disabled = true;
      btn.textContent = '確かめています…';
      err.hidden = true;
      try {
        await catalog.unlock(pw.value);
        pw.value = '';
        document.body.classList.remove('locked');
        resolve();
      } catch (e2) {
        err.hidden = false;
        err.textContent = e2?.name === 'OperationError' ? 'パスワードが違います' : `開けませんでした（${e2?.message || e2}）`;
      } finally {
        btn.disabled = false;
        btn.textContent = '開く';
      }
    };
  });
}

function showFatal(message) {
  document.body.classList.add('locked');
  lockEl.querySelector('form').hidden = true;
  lockEl.querySelector('#lock-fatal').hidden = false;
  lockEl.querySelector('#lock-fatal-msg').textContent = message;
}

async function relock() {
  await catalog.lock();
  await showLock('ロックしました。開くにはパスワードを入れてください');
  route();
}

// ---------------------------------------------------------------- 更新

let lastCheck = 0;
async function checkUpdate(manual) {
  lastCheck = Date.now();
  let r;
  try { r = await catalog.checkUpdate(); } catch (e) { console.warn(e); r = 'error'; }
  if (r === 'updated') {
    const msg = `新しいデータ（${catalog.versionLabel()}）を読み込みました`;
    // 判別の途中で画面を描き直すと手が止まるので、そこでは押したときに反映
    if (location.hash.startsWith('#/judge')) toast(msg, { action: '反映', onAction: route, ms: 8000 });
    else { toast(msg); route(); }
  } else if (r === 'relock') {
    await showLock('PC でパスワードが変わりました。新しいパスワードを入れてください');
    route();
  } else if (manual) {
    toast(r === 'same' ? 'データは最新です' : r === 'offline' ? '電波がないため確かめられませんでした' : '確かめられませんでした');
  }
  return r;
}

let swReg = null;
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg => { swReg = reg; }).catch(e => console.warn('Service Worker', e));
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return;   // 初回の取り付けは知らせない
    shown = true;
    toast('アプリを更新しました', { action: '再読み込み', onAction: () => location.reload(), ms: 10000 });
  });
}

// 開き直したとき（ホーム画面から戻ったときを含む）に、10分おきまでで確かめる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !catalog.data()) return;
  if (Date.now() - lastCheck < 10 * 60 * 1000) return;
  checkUpdate(false);
  swReg?.update().catch(() => {});
});

// ---------------------------------------------------------------- 起動

async function start() {
  registerServiceWorker();
  let status;
  try {
    status = await catalog.boot();
  } catch (e) {
    console.warn(e);
    showFatal('最初の1回は、データを取りに行くために電波が要ります。電波のある所で開き直してください。');
    return;
  }
  if (status === 'locked') await showLock();
  document.body.classList.remove('locked');
  navigator.storage?.persist?.().catch(() => {});
  await route();
  setTimeout(() => checkUpdate(false), 1500);
}

start();
