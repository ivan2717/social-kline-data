// 单个数据点：一周一个值
export interface DataPoint {
  date: string;        // ISO 周一日期，格式 'YYYY-MM-DD'
  value: number;       // 标准化后的指数值，0-100
  raw?: number;        // 原始值（标准化前），可选，方便调试
}

// 指标分解项（详情页用）
export interface Component {
  name: string;        // 例如 "搜索热度"
  weight: number;      // 0-1，权重
  value: number;       // 当前值，0-100
  source: string;      // 数据来源标识，例如 "Google Trends"
}

// 单个指标完整输出
export interface IndicatorData {
  code: string;                    // 指标代码，例如 "AIFEAR"
  name: string;                    // 中文名，例如 "AI失业焦虑"
  description: string;             // 一句话说明
  unit: string;                    // 单位说明，例如 "0-100标准化"
  current: number;                 // 当前值
  change_1w: number;               // 周环比变化（绝对值）
  change_1w_pct: number;           // 周环比百分比
  change_1y_pct: number;           // 同比百分比
  high_52w: number;                // 52周最高
  low_52w: number;                 // 52周最低
  avg_52w: number;                 // 52周均值
  alert: boolean;                  // 是否触发警报（高位或异动）
  history: DataPoint[];            // 历史数据点（默认10年周度）
  components?: Component[];        // 指标分解（可选）
  updated_at: string;              // ISO 时间戳
  methodology: string;             // 方法论说明
}

// 首页汇总
export interface SummaryData {
  updated_at: string;
  indicators: Array<{
    code: string;
    name: string;
    current: number;
    change_1w: number;
    change_1w_pct: number;
    alert: boolean;
    sparkline: number[];           // 最近 12 周数据点，画迷你走势图用
  }>;
  composite_pressure: number;      // 综合社会压力（所有指标加权平均）
  alert_count: number;             // 警报数量
}
