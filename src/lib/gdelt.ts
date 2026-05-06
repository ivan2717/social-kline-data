/**
 * GDELT DOC 2.0 API 封装
 * 文档：https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * 我们用两个端点：
 * 1. /api/v2/doc/doc?mode=timelinevol —— 文章数量时间线（用于话题热度）
 * 2. /api/v2/doc/doc?mode=timelinetone —— 文章情感时间线（用于情感分析）
 *
 * GDELT 的查询语法支持 AND/OR、引号、关键词、来源筛选等
 *
 * Concurrency / rate limits:
 * GDELT enforces an undocumented rate cap; bursts of parallel requests
 * frequently return HTTP 429. We serialize all calls through a single
 * promise chain and enforce a minimum spacing between requests, plus
 * retry-with-backoff on 429 / 5xx.
 */

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';

// Minimum spacing between successive GDELT requests, in milliseconds.
// Empirically 1s is too aggressive on GitHub Actions runners; 1.5s holds.
const MIN_SPACING_MS = 1500;

// Retry policy for 429 / 5xx / network errors
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;

// 10-year timeline queries can take 30-60s on GDELT's side; default fetch
// connect timeout (~10s on undici) is too short.
const REQUEST_TIMEOUT_MS = 90_000;

interface TimelineResponse {
  timeline: Array<{
    series: string;
    data: Array<{
      date: string;        // 格式 'YYYYMMDDHHMMSS'
      value: number;
    }>;
  }>;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Single shared queue: every GDELT request awaits the prior one.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

async function gdeltFetch(url: string): Promise<TimelineResponse> {
  // Chain onto the queue so concurrent callers serialize naturally.
  const next = queue.then(async () => {
    const wait = MIN_SPACING_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);

    let attempt = 0;
    while (true) {
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        lastRequestAt = Date.now();
      } catch (err) {
        // Network-level failure (DNS, TLS reset, connect timeout, abort).
        // Long-haul GDELT queries are flaky on consumer networks; back off
        // and retry rather than failing the whole indicator.
        lastRequestAt = Date.now();
        if (attempt >= MAX_RETRIES) throw err;
        const delay = BASE_BACKOFF_MS * 2 ** attempt;
        const code = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error).message;
        console.warn(`[GDELT] network error (${code}), backing off ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        attempt++;
        continue;
      }

      if (res.ok) {
        // GDELT occasionally returns 200 with non-JSON HTML when overloaded;
        // treat parse failure as a retryable error.
        const text = await res.text();
        try {
          return JSON.parse(text) as TimelineResponse;
        } catch {
          if (attempt >= MAX_RETRIES) {
            throw new Error(`GDELT returned non-JSON after ${attempt} retries`);
          }
          const delay = BASE_BACKOFF_MS * 2 ** attempt;
          console.warn(`[GDELT] non-JSON response, backing off ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          attempt++;
          continue;
        }
      }

      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(`GDELT API error: ${res.status}`);
      }

      // Honor Retry-After when present (seconds or HTTP date), else exp backoff.
      const retryAfter = res.headers.get('retry-after');
      let delay = BASE_BACKOFF_MS * 2 ** attempt;
      if (retryAfter) {
        const asInt = parseInt(retryAfter, 10);
        if (!Number.isNaN(asInt)) delay = Math.max(delay, asInt * 1000);
      }
      console.warn(`[GDELT] ${res.status}, backing off ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      attempt++;
    }
  });

  // Keep the queue alive even if this call rejects, so a transient failure
  // doesn't poison every subsequent caller.
  queue = next.catch(() => undefined);
  return next as Promise<TimelineResponse>;
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

  const data = await gdeltFetch(url.toString());

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

  const data = await gdeltFetch(url.toString());

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
