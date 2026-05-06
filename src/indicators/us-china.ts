/**
 * 中美关系温度 (USCN)
 *
 * 逻辑：抓"中美"同时出现的新闻文章，看情感分。
 * 但和其他指标不同 —— 这里我们想要的是"敌对感"，所以：
 * - 文章量越大说明摩擦越多
 * - 情感分越负说明关系越紧张
 *
 * 输出和原型一致：值越高代表关系越紧张（"温度低、压力高"）
 */

import { fetchTimelineVolume, fetchTimelineTone, toGdeltDate, yearsAgo } from '../lib/gdelt.js';
import {
  aggregateToWeekly,
  zScoreNormalize,
  calcChange,
  rollingStats,
  shouldAlert,
  round,
} from '../lib/normalize.js';
import type { IndicatorData, DataPoint, Component } from '../types.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 同时提到中美的文章；加上常见摩擦关键词强化主题相关性
const GDELT_QUERY =
  '(China AND ("United States" OR Washington OR Biden OR Trump OR Pentagon)) AND (tariff OR sanctions OR Taiwan OR "trade war" OR military OR diplomatic)';

const YEARS_BACK = 10;

export async function buildUSChinaIndex(): Promise<IndicatorData> {
  console.log('[US-China] 开始采集数据...');

  const startDate = yearsAgo(YEARS_BACK);
  const endDate = new Date();

  console.log('[US-China] 拉取文章量...');
  let volumeWeekly: { date: string; value: number }[] = [];
  try {
    const volumeDaily = await fetchTimelineVolume(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    volumeWeekly = aggregateToWeekly(volumeDaily);
  } catch (err) {
    console.error('[US-China] 文章量失败', err);
  }

  console.log('[US-China] 拉取情感分...');
  let toneWeekly: { date: string; value: number }[] = [];
  try {
    const toneDaily = await fetchTimelineTone(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    // 情感越负紧张感越高，取负号
    toneWeekly = aggregateToWeekly(toneDaily).map(d => ({
      date: d.date,
      value: -d.value,
    }));
  } catch (err) {
    console.error('[US-China] 情感分失败', err);
  }

  // 对齐
  const allDates = new Set<string>();
  volumeWeekly.forEach(d => allDates.add(d.date));
  toneWeekly.forEach(d => allDates.add(d.date));
  const sortedDates = [...allDates].sort();

  const volumeMap = new Map(volumeWeekly.map(d => [d.date, d.value]));
  const toneMap = new Map(toneWeekly.map(d => [d.date, d.value]));

  let lastVolume = 0;
  let lastTone = 0;
  const aligned = sortedDates.map(date => {
    if (volumeMap.has(date)) lastVolume = volumeMap.get(date)!;
    if (toneMap.has(date)) lastTone = toneMap.get(date)!;
    return { date, volume: lastVolume, tone: lastTone };
  });

  const baselineEnd = Math.floor(aligned.length * 0.6);
  const volumeNorm = zScoreNormalize(
    aligned.map(d => d.volume),
    0,
    baselineEnd
  );
  const toneNorm = zScoreNormalize(
    aligned.map(d => d.tone),
    0,
    baselineEnd
  );

  // 摩擦报道量50% + 负面情感50%
  const WEIGHTS = { volume: 0.5, tone: 0.5 };
  const history: DataPoint[] = aligned.map((d, i) => ({
    date: d.date,
    value: round(
      volumeNorm[i] * WEIGHTS.volume + toneNorm[i] * WEIGHTS.tone
    ),
  }));

  const current = history[history.length - 1]?.value ?? 0;
  const change1w = calcChange(history, 1);
  const change1y = calcChange(history, 52);
  const stats = rollingStats(history, 52);

  const lastIdx = history.length - 1;
  const components: Component[] = [
    {
      name: '摩擦报道量',
      weight: WEIGHTS.volume,
      value: round(volumeNorm[lastIdx]),
      source: 'GDELT',
    },
    {
      name: '报道负面情感',
      weight: WEIGHTS.tone,
      value: round(toneNorm[lastIdx]),
      source: 'GDELT Tone',
    },
  ];

  return {
    code: 'USCN',
    name: '中美关系紧张度',
    description: '中美摩擦相关报道的密度与负面情感',
    unit: '0-100标准化（值越高代表关系越紧张）',
    current,
    change_1w: round(change1w.abs),
    change_1w_pct: round(change1w.pct, 1),
    change_1y_pct: round(change1y.pct, 1),
    high_52w: round(stats.high),
    low_52w: round(stats.low),
    avg_52w: round(stats.avg),
    alert: shouldAlert(history),
    history,
    components,
    updated_at: new Date().toISOString(),
    methodology:
      '摩擦报道量50% + 报道负面情感50%。GDELT 查询限定中美同时出现且包含贸易/台海/军事等议题。基准期为前60%数据。',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildUSChinaIndex()
    .then(data => {
      const outPath = join(__dirname, '../../data/us-china.json');
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`[US-China] 完成，当前值: ${data.current}, 警报: ${data.alert}`);
    })
    .catch(err => {
      console.error('[US-China] 失败:', err);
      process.exit(1);
    });
}
