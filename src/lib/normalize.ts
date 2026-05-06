import type { DataPoint } from '../types.js';

/**
 * 把原始数值序列标准化到 0-100 区间
 * 用历史数据的 min-max 标准化
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 50);
  return values.map(v => ((v - min) / range) * 100);
}

/**
 * 用基准期的均值和标准差做 z-score 标准化，再映射到 0-100
 * 比 min-max 更适合长期序列，因为不会被极端值锁死区间
 */
export function zScoreNormalize(
  values: number[],
  baselineStartIdx: number,
  baselineEndIdx: number
): number[] {
  const baseline = values.slice(baselineStartIdx, baselineEndIdx);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance =
    baseline.reduce((sum, v) => sum + (v - mean) ** 2, 0) / baseline.length;
  const std = Math.sqrt(variance) || 1;

  return values.map(v => {
    const z = (v - mean) / std;
    // 把 z-score 映射到 0-100：z=0 → 50, z=±5 → 0/100
    // 用 5 而不是 3，避免新数据远超基准期时被天花板削平、丢失差异
    const scaled = 50 + (z * 50) / 5;
    return Math.max(0, Math.min(100, scaled));
  });
}

/**
 * 按周聚合每日数据
 * dailyData: { date: 'YYYY-MM-DD', value: number }[]
 * 返回每周一对应的均值
 */
export function aggregateToWeekly(
  dailyData: { date: string; value: number }[]
): { date: string; value: number }[] {
  const weekMap = new Map<string, number[]>();

  for (const { date, value } of dailyData) {
    const d = new Date(date);
    const day = d.getUTCDay(); // 0=周日, 1=周一
    // 找到本周一
    const monday = new Date(d);
    const diff = day === 0 ? -6 : 1 - day;
    monday.setUTCDate(d.getUTCDate() + diff);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
    weekMap.get(weekKey)!.push(value);
  }

  const result: { date: string; value: number }[] = [];
  const sorted = [...weekMap.keys()].sort();
  for (const week of sorted) {
    const values = weekMap.get(week)!;
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    result.push({ date: week, value: avg });
  }
  return result;
}

/**
 * 计算环比变化（绝对值和百分比）
 */
export function calcChange(
  history: DataPoint[],
  weeksAgo: number
): { abs: number; pct: number } {
  if (history.length < weeksAgo + 1) return { abs: 0, pct: 0 };
  const current = history[history.length - 1].value;
  const past = history[history.length - 1 - weeksAgo].value;
  const abs = current - past;
  const pct = past === 0 ? 0 : (abs / past) * 100;
  return { abs, pct };
}

/**
 * 取最近 N 周的统计量
 */
export function rollingStats(history: DataPoint[], windowWeeks: number) {
  const recent = history.slice(-windowWeeks).map(p => p.value);
  if (recent.length === 0) return { high: 0, low: 0, avg: 0 };
  const high = Math.max(...recent);
  const low = Math.min(...recent);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return { high, low, avg };
}

/**
 * 警报判定：当前值在 52周 80 分位以上 或 一周变化超过 ±10%
 */
export function shouldAlert(history: DataPoint[]): boolean {
  if (history.length < 52) return false;
  const last52 = history.slice(-52).map(p => p.value);
  const sorted = [...last52].sort((a, b) => a - b);
  const p80 = sorted[Math.floor(sorted.length * 0.8)];
  const current = history[history.length - 1].value;

  if (current >= p80) return true;

  const change = calcChange(history, 1);
  if (Math.abs(change.pct) >= 10) return true;

  return false;
}

/**
 * 保留两位小数
 */
export function round(n: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}
