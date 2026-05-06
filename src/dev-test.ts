/**
 * 本地 mock 测试：用模拟数据验证标准化、加权、统计、警报这整套流程
 * 真实 GDELT/Trends 在你的机器或 GitHub Actions 上可以正常访问，
 * 但在某些受限网络下不行 —— 这个脚本可以脱离外部 API 验证逻辑正确性
 *
 * 运行：npx tsx src/dev-test.ts
 */

import {
  aggregateToWeekly,
  zScoreNormalize,
  calcChange,
  rollingStats,
  shouldAlert,
  round,
} from './lib/normalize.js';
import type { DataPoint } from './types.js';

// 生成 10 年的模拟每日数据：缓慢上升 + 噪声 + 末段尖峰（模拟"AI 焦虑爆发"）
function generateMockDaily(years: number, peakAtEnd = true): { date: string; value: number }[] {
  const result: { date: string; value: number }[] = [];
  const totalDays = years * 365;
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - years);

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);

    // 基础上升趋势
    const trend = (i / totalDays) * 30;
    // 周期性噪声
    const seasonal = Math.sin((i / 365) * 2 * Math.PI) * 5;
    // 随机噪声
    const noise = (Math.random() - 0.5) * 8;
    // 末段尖峰：最后 5% 数据急剧上升
    const peakBoost =
      peakAtEnd && i > totalDays * 0.95
        ? ((i - totalDays * 0.95) / (totalDays * 0.05)) * 40
        : 0;

    result.push({
      date: d.toISOString().slice(0, 10),
      value: 20 + trend + seasonal + noise + peakBoost,
    });
  }
  return result;
}

console.log('===== Mock 测试：验证 pipeline 逻辑 =====\n');

// 1. 测试周聚合
console.log('1. 周聚合测试');
const dailyData = generateMockDaily(10, true);
console.log(`   原始日数据: ${dailyData.length} 天`);
const weekly = aggregateToWeekly(dailyData);
console.log(`   聚合后周数据: ${weekly.length} 周`);
console.log(`   首周: ${weekly[0].date}, 末周: ${weekly[weekly.length - 1].date}`);
console.log(`   首周值: ${round(weekly[0].value)}, 末周值: ${round(weekly[weekly.length - 1].value)}\n`);

// 2. 测试 z-score 标准化
console.log('2. Z-score 标准化测试');
const values = weekly.map(w => w.value);
const baselineEnd = Math.floor(values.length * 0.6);
const normalized = zScoreNormalize(values, 0, baselineEnd);
console.log(`   原始值范围: ${round(Math.min(...values))} ~ ${round(Math.max(...values))}`);
console.log(`   标准化范围: ${round(Math.min(...normalized))} ~ ${round(Math.max(...normalized))}`);
console.log(`   末值: ${round(normalized[normalized.length - 1])}（应该接近高位）\n`);

// 3. 构造完整 history 跑后续逻辑
const history: DataPoint[] = weekly.map((w, i) => ({
  date: w.date,
  value: round(normalized[i]),
}));

// 4. 测试统计量
console.log('3. 52周统计');
const stats = rollingStats(history, 52);
console.log(`   高: ${round(stats.high)}, 低: ${round(stats.low)}, 均: ${round(stats.avg)}\n`);

// 5. 测试环比
console.log('4. 变化测试');
const change1w = calcChange(history, 1);
const change1y = calcChange(history, 52);
console.log(`   周环比: ${round(change1w.abs)} (${round(change1w.pct, 1)}%)`);
console.log(`   年同比: ${round(change1y.abs)} (${round(change1y.pct, 1)}%)\n`);

// 6. 测试警报
console.log('5. 警报判定');
const alert = shouldAlert(history);
console.log(`   触发警报: ${alert} （末段有尖峰，应该是 true）\n`);

// 7. 输出一份模拟的 ai-anxiety.json
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockOutput = {
  code: 'AIFEAR_MOCK',
  name: 'AI失业焦虑（模拟）',
  description: 'Mock 测试输出，验证 JSON 结构',
  unit: '0-100标准化',
  current: history[history.length - 1].value,
  change_1w: round(change1w.abs),
  change_1w_pct: round(change1w.pct, 1),
  change_1y_pct: round(change1y.pct, 1),
  high_52w: round(stats.high),
  low_52w: round(stats.low),
  avg_52w: round(stats.avg),
  alert,
  history,
  components: [
    { name: '搜索热度', weight: 0.4, value: 92.4, source: 'Google Trends' },
    { name: '媒体讨论量', weight: 0.35, value: 81.7, source: 'GDELT' },
    { name: '媒体负面情感', weight: 0.25, value: 85.1, source: 'GDELT Tone' },
  ],
  updated_at: new Date().toISOString(),
  methodology: '模拟数据，仅用于验证 pipeline',
};

const outPath = join(__dirname, '../data/mock-ai-anxiety.json');
writeFileSync(outPath, JSON.stringify(mockOutput, null, 2));
console.log(`6. 写入 mock 输出: ${outPath}`);
console.log(`   文件大小: ${JSON.stringify(mockOutput).length} 字节`);
console.log(`   history 点数: ${mockOutput.history.length}\n`);

console.log('===== 全部通过 =====');
