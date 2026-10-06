// 仮想テンキー。スマホのキーボードを出し入れしないためのもの（渡されたカウンターの形）:
//   7〜9 / 4〜6 / 1〜3 / C 0 BS、6桁まで、キャンセル・決定。
// 足したもの: ＋/−（差枚の欄だけ）、「次へ」（続けて次の欄へ）、画面の下から出す
let overlay = null;
let state = null;

function build() {
  overlay = document.createElement('div');
  overlay.className = 'overlay numpad-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="数字の入力">
      <div class="np-title"></div>
      <div class="np-row">
        <button type="button" class="np-sign" data-k="sign">＋/−</button>
        <div class="np-display" aria-live="polite">0</div>
      </div>
      <div class="np-grid">
        ${['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}
        <button type="button" class="np-c" data-k="C">C</button>
        <button type="button" data-k="0">0</button>
        <button type="button" class="np-bs" data-k="BS">BS</button>
      </div>
      <div class="np-actions">
        <button type="button" class="btn" data-k="cancel">キャンセル</button>
        <button type="button" class="btn" data-k="ok">決定</button>
        <button type="button" class="btn btn-accent" data-k="next">次へ →</button>
      </div>
    </div>`;
  overlay.addEventListener('click', onClick);
  document.body.appendChild(overlay);
}

function paint() {
  const v = state.digits || '0';
  overlay.querySelector('.np-display').textContent = (state.neg && state.digits ? '−' : '') + Number(v).toLocaleString('ja-JP');
}

function finish(result) {
  overlay.classList.remove('open');
  const resolve = state.resolve;
  state = null;
  resolve(result);
}

function onClick(e) {
  if (!state) return;
  const b = e.target.closest('[data-k]');
  if (!b) { if (e.target === overlay) finish(null); return; }
  const k = b.dataset.k;
  if (/^\d$/.test(k)) {
    if (state.digits === '0') state.digits = '';
    if (state.digits.length < state.max) state.digits += k;
  } else if (k === 'C') { state.digits = ''; state.neg = false; }
  else if (k === 'BS') state.digits = state.digits.slice(0, -1);
  else if (k === 'sign') state.neg = !state.neg;
  else if (k === 'cancel') return finish(null);
  else if (k === 'ok' || k === 'next') {
    const n = parseInt(state.digits, 10) || 0;
    return finish({ value: state.neg ? -n : n, empty: state.digits === '', next: k === 'next' });
  }
  paint();
}

/**
 * 開いて、決定で { value, empty, next } を、キャンセルで null を返す。
 * empty は何も打たずに決定したとき（総Gの確認に使う）
 */
export function openNumpad({ title, value = 0, negative = false, hasNext = false, max = 6 }) {
  if (!overlay) build();
  return new Promise(resolve => {
    state = { digits: value ? String(Math.abs(value)) : '', neg: value < 0, max, resolve };
    overlay.querySelector('.np-title').textContent = title;
    overlay.querySelector('.np-row').classList.toggle('has-sign', negative);
    overlay.querySelector('.np-sign').hidden = !negative;
    overlay.querySelector('[data-k="next"]').hidden = !hasNext;
    overlay.querySelector('.np-actions').classList.toggle('no-next', !hasNext);
    paint();
    overlay.classList.add('open');
  });
}

/**
 * 欄を順に入れる。fields は { title, get(), set(value, empty), negative } の並び。
 * 「次へ」を押すと次の欄のテンキーが続けて開く
 */
export async function editChain(fields, start = 0) {
  for (let i = start; i < fields.length; i++) {
    const f = fields[i];
    const r = await openNumpad({ title: f.title, value: f.get(), negative: !!f.negative, hasNext: i < fields.length - 1 });
    if (!r) return;
    await f.set(r.value, r.empty);
    if (!r.next) return;
  }
}
