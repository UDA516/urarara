// 画面の移動。同じ場所へ移るとき（hashchange が起きない）も描き直す
let reroute = () => {};
export function setReroute(fn) { reroute = fn; }
export function navigate(hash) {
  if (location.hash === hash) reroute();
  else location.hash = hash;
}
