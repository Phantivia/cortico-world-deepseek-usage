/** 面板与 World 之间的数据形状;浏览器端只 `import type`。 */
import type { Snapshot } from './readings.ts';

export const QUICK_PANEL = 'quick';
export const SCHEDULE_PANEL = 'schedule';

export interface AccountView {
  id: string;
  label: string;
  /** 打码后的 key;部署 `.env` 里没有时为 null。 */
  masked: string | null;
  warnBelow: number | null;
  /** 最近一次查到的读数;从没查通过为 null。 */
  snapshot: Snapshot | null;
  /** 最近一次查询失败的原因(按面板语言);最近一次查通了为 null。 */
  error: string | null;
  /** 余额此刻在警告线以下。 */
  below: boolean;
}

export interface PanelState {
  accounts: AccountView[];
  schedule: {
    enabled: boolean;
    times: string[];
    wake: boolean;
    /** 下一次播报:`today`/`tomorrow` 加时刻;没开或没有时刻为 null。 */
    next: { day: 'today' | 'tomorrow'; time: string } | null;
  };
  alerts: { checkMinutes: number; wake: boolean };
  timezone: string;
}

export type TestResult = { ok: true; snapshot: Snapshot } | { ok: false; error: string };
