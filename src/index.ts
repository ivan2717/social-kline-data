/**
 * 主入口：依次跑三个指标，生成单文件 + 汇总文件
 */

import { buildAIAnxietyIndex } from './indicators/ai-anxiety.js';
import { buildGlobalConflictIndex } from './indicators/global-conflict.js';
import { buildUSChinaIndex } from './indicators/us-china.js';
import { round } from './lib/normalize.js';
import type { IndicatorData, SummaryData } from './types.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

// Returns true when an indicator's run produced no usable signal.
// Used to decide whether to overwrite the previous data file: if every
// upstream source failed we'd rather keep last week's numbers than
// publish all-null/zero placeholders.
function isEmpty(data: IndicatorData): boolean {
  if (data.history.length === 0) return true;
  const allComponentsNull = (data.components ?? []).every(
    c => c.value === null || !Number.isFinite(c.value as number)
  );
  return allComponentsNull;
}

async function runIndicator(
  name: string,
  builder: () => Promise<IndicatorData>,
  filename: string
): Promise<IndicatorData | null> {
  const outPath = join(DATA_DIR, filename);
  try {
    const data = await builder();
    if (isEmpty(data)) {
      // All sources failed. Preserve the previous file if one exists so
      // the frontend keeps showing the last good snapshot.
      if (existsSync(outPath)) {
        const previous = JSON.parse(readFileSync(outPath, 'utf-8')) as IndicatorData;
        console.warn(`! ${name}: all sources failed, keeping previous data (${previous.updated_at})`);
        return previous;
      }
      writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.warn(`! ${name}: all sources failed and no previous data; wrote empty placeholder`);
      return data;
    }
    writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`✓ ${name}: ${data.current} (alert=${data.alert})`);
    return data;
  } catch (err) {
    console.error(`✗ ${name} 失败:`, err);
    if (existsSync(outPath)) {
      try {
        const previous = JSON.parse(readFileSync(outPath, 'utf-8')) as IndicatorData;
        console.warn(`  → keeping previous data (${previous.updated_at})`);
        return previous;
      } catch {
        // fall through to null
      }
    }
    return null;
  }
}

async function main() {
  console.log('===== 开始更新所有指标 =====');
  console.log(`数据目录: ${DATA_DIR}`);
  console.log('');

  // Run indicators sequentially. They share the GDELT API and concurrent
  // calls trip its undocumented rate cap (HTTP 429). The serial gdelt-fetch
  // queue in lib/gdelt.ts also protects us, but keeping indicator-level
  // ordering makes the workflow logs easier to follow.
  const results: (IndicatorData | null)[] = [];
  results.push(await runIndicator('AI失业焦虑', buildAIAnxietyIndex, 'ai-anxiety.json'));
  results.push(await runIndicator('全球冲突', buildGlobalConflictIndex, 'global-conflict.json'));
  results.push(await runIndicator('中美关系', buildUSChinaIndex, 'us-china.json'));

  const valid = results.filter((r): r is IndicatorData => r !== null);

  if (valid.length === 0) {
    console.error('所有指标都失败了');
    process.exit(1);
  }

  // 生成首页 summary
  const summary: SummaryData = {
    updated_at: new Date().toISOString(),
    indicators: valid.map(d => ({
      code: d.code,
      name: d.name,
      current: d.current,
      change_1w: d.change_1w,
      change_1w_pct: d.change_1w_pct,
      alert: d.alert,
      sparkline: d.history.slice(-12).map(p => p.value),
    })),
    composite_pressure: round(
      valid.reduce((sum, d) => sum + d.current, 0) / valid.length
    ),
    alert_count: valid.filter(d => d.alert).length,
  };

  writeFileSync(
    join(DATA_DIR, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('');
  console.log('===== 完成 =====');
  console.log(`综合压力: ${summary.composite_pressure}`);
  console.log(`警报数量: ${summary.alert_count}/${valid.length}`);
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
