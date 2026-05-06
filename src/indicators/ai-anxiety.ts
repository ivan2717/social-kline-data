/**
 * AI 失业焦虑指数 (AIFEAR)
 *
 * 三个数据流加权：
 * - 搜索热度 40%：Google Trends 抓 "AI 失业" 等关键词
 * - 媒体情感 35%：GDELT 抓 AI+就业话题文章量（量越大焦虑越高）
 * - 媒体负面情感 25%：GDELT 同话题情感分（越负面焦虑越高）
 *
 * 注意：原型设计里第三项是"论坛讨论"（Reddit 等），
 * 但要稳定爬 Reddit 需要 API key 和更复杂的处理，
 * 第一版先用 GDELT 的负面情感作为代理指标，后续再升级。
 */

import { fetchInterestOverTime } from '../lib/google-trends.js';
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

// GDELT 查询：AI + 就业/失业，覆盖中英文媒体
const GDELT_QUERY =
  '("artificial intelligence" OR "AI") AND (jobs OR unemployment OR "replace workers" OR "job loss")';

// Google Trends 关键词：英文为主（中文 trends 数据稀疏）
const TRENDS_KEYWORDS = ['AI replace jobs', 'AI unemployment'];

// 历史回溯：10 年
const YEARS_BACK = 10;

export async function buildAIAnxietyIndex(): Promise<IndicatorData> {
  console.log('[AI Anxiety] 开始采集数据...');

  const startDate = yearsAgo(YEARS_BACK);
  const endDate = new Date();

  // ---- 1. Google Trends：搜索热度 ----
  console.log('[AI Anxiety] 拉取 Google Trends 数据...');
  let trendsWeekly: { date: string; value: number }[] = [];
  try {
    const trendsData = await fetchInterestOverTime(
      TRENDS_KEYWORDS,
      startDate,
      endDate,
      ''
    );
    // 取多个关键词的均值
    const trendsDaily = trendsData.map(d => ({
      date: d.date,
      value: d.values.reduce((a, b) => a + b, 0) / d.values.length,
    }));
    // Trends 已经是周度数据，但日期对齐不一定准，再过一次聚合
    trendsWeekly = aggregateToWeekly(trendsDaily);
  } catch (err) {
    console.error('[AI Anxiety] Google Trends 失败，使用零序列', err);
  }

  // ---- 2. GDELT 文章量：媒体讨论热度 ----
  console.log('[AI Anxiety] 拉取 GDELT 文章量...');
  let volumeWeekly: { date: string; value: number }[] = [];
  try {
    const volumeDaily = await fetchTimelineVolume(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    volumeWeekly = aggregateToWeekly(volumeDaily);
  } catch (err) {
    console.error('[AI Anxiety] GDELT 文章量失败', err);
  }

  // ---- 3. GDELT 情感分：负面情感即焦虑 ----
  console.log('[AI Anxiety] 拉取 GDELT 情感分...');
  let toneWeekly: { date: string; value: number }[] = [];
  try {
    const toneDaily = await fetchTimelineTone(
      GDELT_QUERY,
      toGdeltDate(startDate),
      toGdeltDate(endDate)
    );
    // 情感分是 -100 到 +100，取负值（越负面焦虑越高）
    toneWeekly = aggregateToWeekly(toneDaily).map(d => ({
      date: d.date,
      value: -d.value,
    }));
  } catch (err) {
    console.error('[AI Anxiety] GDELT 情感分失败', err);
  }

  // ---- 4. 对齐三个数据流的日期 ----
  const allDates = new Set<string>();
  trendsWeekly.forEach(d => allDates.add(d.date));
  volumeWeekly.forEach(d => allDates.add(d.date));
  toneWeekly.forEach(d => allDates.add(d.date));
  const sortedDates = [...allDates].sort();

  const trendsMap = new Map(trendsWeekly.map(d => [d.date, d.value]));
  const volumeMap = new Map(volumeWeekly.map(d => [d.date, d.value]));
  const toneMap = new Map(toneWeekly.map(d => [d.date, d.value]));

  // 取三流都有数据的周（缺失时用前向填充）
  let lastTrends = 0;
  let lastVolume = 0;
  let lastTone = 0;
  const aligned = sortedDates.map(date => {
    if (trendsMap.has(date)) lastTrends = trendsMap.get(date)!;
    if (volumeMap.has(date)) lastVolume = volumeMap.get(date)!;
    if (toneMap.has(date)) lastTone = toneMap.get(date)!;
    return {
      date,
      trends: lastTrends,
      volume: lastVolume,
      tone: lastTone,
    };
  });

  // ---- 5. 标准化 ----
  // 用前 60% 数据作为基准期
  const baselineEnd = Math.floor(aligned.length * 0.6);
  const trendsNorm = zScoreNormalize(
    aligned.map(d => d.trends),
    0,
    baselineEnd
  );
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

  // ---- 6. 加权合成 ----
  const WEIGHTS = { trends: 0.4, volume: 0.35, tone: 0.25 };
  const history: DataPoint[] = aligned.map((d, i) => ({
    date: d.date,
    value: round(
      trendsNorm[i] * WEIGHTS.trends +
        volumeNorm[i] * WEIGHTS.volume +
        toneNorm[i] * WEIGHTS.tone
    ),
  }));

  // ---- 7. 计算统计量 ----
  const current = history[history.length - 1]?.value ?? 0;
  const change1w = calcChange(history, 1);
  const change1y = calcChange(history, 52);
  const stats = rollingStats(history, 52);

  // 当前值的指标分解（最后一周各组件的标准化值）
  const lastIdx = history.length - 1;
  const components: Component[] = [
    {
      name: '搜索热度',
      weight: WEIGHTS.trends,
      value: round(trendsNorm[lastIdx]),
      source: 'Google Trends',
    },
    {
      name: '媒体讨论量',
      weight: WEIGHTS.volume,
      value: round(volumeNorm[lastIdx]),
      source: 'GDELT',
    },
    {
      name: '媒体负面情感',
      weight: WEIGHTS.tone,
      value: round(toneNorm[lastIdx]),
      source: 'GDELT Tone',
    },
  ];

  return {
    code: 'AIFEAR',
    name: 'AI失业焦虑',
    description: '公众对AI取代就业的焦虑程度',
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
      '搜索热度40% + 媒体讨论量35% + 媒体负面情感25%。基准期为前60%数据，z-score标准化后映射到0-100。',
  };
}

// 直接运行此文件时执行
if (import.meta.url === `file://${process.argv[1]}`) {
  buildAIAnxietyIndex()
    .then(data => {
      const outPath = join(__dirname, '../../data/ai-anxiety.json');
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`[AI Anxiety] 完成，输出到 ${outPath}`);
      console.log(`[AI Anxiety] 当前值: ${data.current}, 警报: ${data.alert}`);
    })
    .catch(err => {
      console.error('[AI Anxiety] 失败:', err);
      process.exit(1);
    });
}
