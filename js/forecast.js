// 合格見込み点（純粋関数）。問ごとに「配点 × その問に対応する論点の期待正答率の平均」を出して合計する。
// 期待正答率はレベル0〜4ごとに config.expectedRateByLevel（仮置き）。模試を記録したら予測との差を見て係数を見直す。

/** @returns {{ total: number, sections: { q, area, label, points, rate, score, topicIds }[] }} */
export function forecast(topics, mastery, config) {
  const rates = config.expectedRateByLevel;
  const sections = config.examSections.map((s) => {
    const ids = topics.filter((t) => t.examQ.includes(s.q)).map((t) => t.id);
    const rate = ids.length ? ids.reduce((a, id) => a + rates[mastery[id] ? mastery[id].level : 0], 0) / ids.length : 0;
    return { q: s.q, area: s.area, label: s.label, points: s.points, rate, score: s.points * rate, topicIds: ids };
  });
  return { total: sections.reduce((a, s) => a + s.score, 0), sections };
}

/** 模試の得点を検査して合計する。scores は { 1: 18, 2: 12, ... }。範囲外・未入力は null を返す */
export function mockTotal(scores, config) {
  let total = 0;
  for (const s of config.examSections) {
    const v = scores[s.q];
    if (!Number.isFinite(v) || v < 0 || v > s.points) return null;
    total += v;
  }
  return total;
}

/** 模試の実績と、記録時点の予測との差（問ごとと合計） */
export function mockDiff(mock) {
  const bySection = {};
  for (const [q, v] of Object.entries(mock.scores)) {
    const f = mock.forecastBySection && mock.forecastBySection[q];
    bySection[q] = f == null ? null : v - f;
  }
  return { total: mock.forecastTotal == null ? null : mock.total - mock.forecastTotal, bySection };
}
