# Social Kline Data 社会K线数据采集

社会K线（Social Kline）项目的数据采集脚本，每周从公开数据源拉取并计算三个社会观察指标。

## 当前指标

| 代码 | 名称 | 数据源 |
|------|------|--------|
| `AIFEAR` | AI失业焦虑 | Google Trends + GDELT |
| `GCI` | 全球冲突指数 | GDELT |
| `USCN` | 中美关系紧张度 | GDELT |

## 快速开始

```bash
npm install

# 跑全部三个指标
npm run dev

# 单独跑某一个
npm run ai-anxiety
npm run conflict
npm run us-china
```

输出在 `data/` 目录：
- `ai-anxiety.json` / `global-conflict.json` / `us-china.json` —— 单指标详细数据（含十年历史、指标分解、统计量）
- `summary.json` —— 首页用的汇总数据

前端可以直接通过 GitHub Pages 或 jsDelivr CDN 访问这些 JSON：

```
https://cdn.jsdelivr.net/gh/<your-username>/social-kline-data@main/data/summary.json
```

## 自动更新

`.github/workflows/update.yml` 配置了每周日 UTC 00:00 自动运行，跑完后把更新的 JSON 提交回仓库。无需服务器，全免费。

要启用：
1. 把仓库推到 GitHub
2. Settings → Actions → General → Workflow permissions 选 "Read and write"
3. Actions 页面手动跑一次 `Update Indicators` 验证

## 设计要点

### 标准化方法

所有指标统一为 0-100 区间。用 z-score 标准化，基准期取序列前 60% —— 这样新数据能和历史比较，不会被极端值锁死。

具体公式：

```
z = (value - mean_baseline) / std_baseline
score = clamp(50 + z * 50 / 3, 0, 100)
```

z=0 映射到 50，z=±3 映射到 0/100。

### 警报规则

满足任一条件触发 `alert: true`：
- 当前值在 52 周 80 分位以上（高位运行）
- 一周变化超过 ±10%（异动）

### 周聚合

GDELT 返回每日数据，标准化前先聚合到周（每周一对应周内日均）。Google Trends 一年内默认就是周度，更长时间段会变成月度，代码里也走 `aggregateToWeekly` 兜一遍保证一致。

## 局限与后续

- **Google Trends 不稳定**：非官方库偶尔会被限流，目前做了三次重试，仍可能失败。失败时该流权重归零，整体值仍可计算但精度下降。后续可以考虑换 [SerpApi](https://serpapi.com/google-trends-api) 等付费方案。
- **GDELT DOC 2.0 timespan 限制**：单次请求最长十年，再往前需要分批。当前 `YEARS_BACK = 10`，足够用。
- **中文媒体覆盖**：GDELT 包含中文媒体但偏少，后续可以加微博/即刻/Reddit 自爬数据。
- **方法论是"可信度的产品"**：每改一次权重，所有历史值都会变。改之前在 `data/CHANGELOG.md` 记一笔。

## 目录结构

```
src/
├── indicators/
│   ├── ai-anxiety.ts          # AIFEAR 指标
│   ├── global-conflict.ts     # GCI 指标
│   └── us-china.ts            # USCN 指标
├── lib/
│   ├── gdelt.ts               # GDELT API 封装
│   ├── google-trends.ts       # Google Trends 封装
│   └── normalize.ts           # 标准化与统计
├── types.ts                    # 共享类型
└── index.ts                    # 主入口

.github/workflows/update.yml    # GitHub Actions 定时任务
data/                           # 输出 JSON
```
