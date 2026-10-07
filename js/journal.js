// 仕訳の集計（採点と表示で共通）
export function sumByAccount(list) {
  const out = {};
  for (const r of list) {
    if (!r.account || !(r.amount > 0)) continue;
    out[r.account] = (out[r.account] || 0) + r.amount;
  }
  return out;
}
