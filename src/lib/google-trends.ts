/**
 * Google Trends 封装
 * 用 google-trends-api 这个非官方库
 * 它有反爬限制，所以代码里做了重试和容错
 */

// @ts-ignore - google-trends-api 没有类型定义
import googleTrends from 'google-trends-api';

interface TrendsResult {
  default: {
    timelineData: Array<{
      time: string;            // Unix 时间戳（秒）
      formattedTime: string;
      formattedAxisTime: string;
      value: number[];
      hasData: boolean[];
      formattedValue: string[];
    }>;
  };
}

/**
 * 获取一个或多个关键词的搜索热度时间序列
 * @param keywords 关键词数组（最多 5 个，Google Trends 限制）
 * @param startTime 开始日期
 * @param endTime 结束日期（默认当前）
 * @param geo 地区代码（'' = 全球，'US' = 美国，'CN' = 中国）
 */
export async function fetchInterestOverTime(
  keywords: string[],
  startTime: Date,
  endTime: Date = new Date(),
  geo: string = ''
): Promise<{ date: string; values: number[] }[]> {
  // Google Trends rate-limits aggressively and serves an HTML "sorry" page
  // when triggered. Backoffs longer than ~30s start to clear the limit on
  // shared IPs (e.g. GitHub Actions runners), so retry generously.
  const maxAttempts = 5;
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const raw = await googleTrends.interestOverTime({
        keyword: keywords,
        startTime,
        endTime,
        geo,
      });

      const parsed = JSON.parse(raw) as TrendsResult;
      return parsed.default.timelineData.map(d => ({
        date: new Date(parseInt(d.time) * 1000).toISOString().slice(0, 10),
        values: d.value,
      }));
    } catch (err) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.error(`Google Trends failed after ${maxAttempts} attempts:`, err);
        throw err;
      }
      // Exponential backoff: 5s, 10s, 20s, 40s.
      const delay = 5000 * 2 ** (attempts - 1);
      console.warn(`[Trends] failed, backing off ${delay}ms (attempt ${attempts}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  return [];
}
