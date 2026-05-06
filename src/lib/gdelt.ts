/**
 * GDELT DOC 2.0 API 封装
 * 文档：https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * 我们用两个端点：
 * 1. /api/v2/doc/doc?mode=timelinevol —— 文章数量时间线（用于话题热度）
 * 2. /api/v2/doc/doc?mode=timelinetone —— 文章情感时间线（用于情感分析）
 *
 * GDELT 的查询语法支持 AND/OR、引号、关键词、来源筛选等
 */

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

interface TimelineResponse {
  timeline: Array<{
    series: string;
    data: Array<{
      date: string;        // 格式 'YYYYMMDDHHMMSS'
      value: number;
    }>;
  }>;
}

/**
 * 获取话题文章量时间线
 * @param query GDELT 查询字符串
 * @param startDate 起始日期 'YYYYMMDD'
 * @param endDate 终止日期 'YYYYMMDD'
 */
export async function fetchTimelineVolume(
  query: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; value: number }[]> {
  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'timelinevol');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', 'custom');
  url.searchParams.set('startdatetime', `${startDate}000000`);
  url.searchParams.set('enddatetime', `${endDate}235959`);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`GDELT API error: ${res.status}`);
  const data = (await res.json()) as TimelineResponse;

  if (!data.timeline || data.timeline.length === 0) return [];

  return data.timeline[0].data.map(d => ({
    date: gdeltDateToISO(d.date),
    value: d.value,
  }));
}

/**
 * 获取话题情感时间线（GDELT 情感打分，-100 到 +100）
 */
export async function fetchTimelineTone(
  query: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; value: number }[]> {
  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'timelinetone');
  url.searchParams.set('format', 'json');
  url.searchParams.set('timespan', 'custom');
  url.searchParams.set('startdatetime', `${startDate}000000`);
  url.searchParams.set('enddatetime', `${endDate}235959`);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`GDELT API error: ${res.status}`);
  const data = (await res.json()) as TimelineResponse;

  if (!data.timeline || data.timeline.length === 0) return [];

  return data.timeline[0].data.map(d => ({
    date: gdeltDateToISO(d.date),
    value: d.value,
  }));
}

/**
 * GDELT 的 'YYYYMMDDHHMMSS' 转成 'YYYY-MM-DD'
 */
function gdeltDateToISO(s: string): string {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * 把 Date 对象转成 GDELT 格式 'YYYYMMDD'
 */
export function toGdeltDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 计算 N 年前的日期
 */
export function yearsAgo(years: number): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}
