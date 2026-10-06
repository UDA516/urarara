// パスワード → 鍵（PBKDF2-SHA256）と、data.enc の復号（AES-GCM）・展開（gzip）。
// tools\build.py の encrypt と対。鍵は取り出せない形で作る（端末に保存しても中身を読み出せない）
const encoder = new TextEncoder();
const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

export async function deriveKey(password, env) {
  if (env.kdf !== 'PBKDF2-SHA256') throw new Error(`知らない鍵の作り方です（${env.kdf}）`);
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(env.salt), iterations: env.iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/** 違う鍵なら DOMException（name が OperationError）で落ちる */
export async function decryptEnvelope(key, env) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(env.iv) }, key, bytes(env.ct));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
