/**
 * 全球冲突指数 (GCI)
 *
 * 用 GDELT 抓全球冲突相关事件的文章量与情感分。
 * - 文章量 60%：冲突相关报道密度（量大说明冲突活跃）
 * - 情感负向 40%：冲突报道的情感分（越负面冲突烈度越高）
 *
 * GDELT 查询覆盖战争、武装冲突、空袭、恐怖袭击等关键词
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

const GDELT_QUERY =
  '(war OR "armed conflict" OR airstrike OR "military operation" OR "terror attack" OR insurgency OR "armed clash") -movie -film -game';

const YEARS_BACK = 10;

export async function buildGlobalConflictIndex(): Promise<IndicatorData> {
  console.log('[Conflict] 开始采集数据...');

  const startDate = yearsAgo(YEARS_BACK);
  const endDate = new Date();

  // 文章量
  console.log('[Conflict] 拉取文章量...');
  let volumeWeekly: { date: string; value: number }[] = [];
  try {
    const volumeDaily = await fetchTimelineVolume(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    volumeWeekly = aggregateToWeekly(volumeDaily);
  } catch (err) {
    console.error('[Conflict] 文章量失败', err);
  }

  // 情感分（取负，因为冲突越烈情感越负）
  console.log('[Conflict] 拉取情感分...');
  let toneWeekly: { date: string; value: number }[] = [];
  try {
    const toneDaily = await fetchTimelineTone(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    toneWeekly = aggregateToWeekly(toneDaily).map(d => ({
      date: d.date,
      value: -d.value,
    }));
  } catch (err) {
    console.error('[Conflict] 情感分失败', err);
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

  const WEIGHTS = { volume: 0.6, tone: 0.4 };
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
      name: '冲突报道量',
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
    code: 'GCI',
    name: '全球冲突指数',
    description: '全球武装冲突的报道密度与烈度',
    unit: '0-100标准化',
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
      '冲突报道量60% + 报道负面情感40%。基准期为前60%数据，z-score标准化后映射到0-100。',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildGlobalConflictIndex()
    .then(data => {
      const outPath = join(__dirname, '../../data/global-conflict.json');
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`[Conflict] 完成，当前值: ${data.current}, 警报: ${data.alert}`);
    })
    .catch(err => {
      console.error('[Conflict] 失败:', err);
      process.exit(1);
    });
}
