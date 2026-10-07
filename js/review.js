// 再出題の予定（純粋関数）。間違えた問題は 1日後・3日後・7日後に再出題し、7日後に正解したら卒業。
// 途中で間違えたら1日後からやり直す。キューの要素：{ questionId, topicId, stage, due, wrongDate }
import { addDays } from './dates.js';

/** 解答を反映した新しいキューを返す（元の配列は変えない） */
export function applyAnswer(queue, { questionId, topicId, correct, date }, intervals) {
  const i = queue.findIndex((x) => x.questionId === questionId);
  const item = i >= 0 ? queue[i] : null;
  const rest = queue.filter((x) => x.questionId !== questionId);
  if (!correct) {
    return [...rest, { questionId, topicId, stage: 0, due: addDays(date, intervals[0]), wrongDate: date }];
  }
  if (!item) return queue; // 初見で正解：予定は作らない
  if (item.due > date) return queue; // 予定日より前に解けても、予定は進めない
  if (item.stage >= intervals.length - 1) return rest; // 最後の再出題（7日後）に正解：卒業
  const stage = item.stage + 1;
  return [...rest, { ...item, stage, due: addDays(date, intervals[stage]) }];
}

/** 今日までに予定日が来ている再出題。古い順 */
export function dueItems(queue, today) {
  return queue.filter((x) => x.due <= today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.questionId < b.questionId ? -1 : 1));
}
