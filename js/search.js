// 機種の検索。全角・半角、ひらがな・カタカナ、大文字・小文字、空白と「・」の違いを無視する
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･]/g, '');
}

/** 名前・読み・別名のどれかに含まれるか */
export function matches(m, query) {
  const q = norm(query);
  if (!q) return true;
  return [m.name, m.kana, ...(m.aliases || [])].some(t => norm(t).includes(q));
}
