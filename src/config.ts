import type { ConfigGroup } from 'cortico/core/types.ts';
import { pick, type Language } from 'cortico/core/language.ts';

export const DEEPSEEK_USAGE_ID = 'deepseek-usage';

export type PromptLanguage = 'zh' | 'en';

/** 一个登记的 DeepSeek 账户。key 不在这里，存部署 `.env` 的 `secretName(id)`。 */
export interface Account {
  /** `[a-z0-9-]`,在 World 内唯一，也是工具里指账户用的名字。 */
  id: string;
  label: string;
  /** 余额跌到这个数以下时推 `deepseek-usage.low`,单位是余额的币种;null 为不设。 */
  warnBelow: number | null;
}

/** config.json 的 `worlds.deepseek-usage` 段。 */
export interface DeepseekUsageConfigSection {
  enabled: boolean;
  /** 环境提示词、工具回执与事件正文的语言。 */
  promptLanguage: PromptLanguage;
  /** 同一账户这么多秒内再查，用上次的读数。 */
  cacheSec: number;
  /** 由面板与工具整表写回，不在配置页里编辑。 */
  accounts: Account[];
  schedule: {
    /** 按 `times` 把全部账户的余额推成一条 `deepseek-usage.report`。 */
    enabled: boolean;
    /** 本地时刻，逗号分隔(`09:00, 21:00`)。 */
    times: string;
    /** 播报叫醒 bot;关着时随下一批事件送达。 */
    wake: boolean;
  };
  alerts: {
    /** 设了警告线的账户隔这么久查一次。 */
    checkMinutes: number;
    /** 跌破警告线叫醒 bot;关着时随下一批事件送达。 */
    wake: boolean;
  };
}

export const DEEPSEEK_USAGE_DEFAULTS: DeepseekUsageConfigSection = {
  enabled: false,
  promptLanguage: 'zh',
  cacheSec: 60,
  accounts: [],
  schedule: { enabled: false, times: '09:00', wake: false },
  alerts: { checkMinutes: 60, wake: true },
};

/** 账户 key 在部署 `.env` 里的名字。 */
export const secretName = (accountId: string): string => `DEEPSEEK_USAGE_${accountId.toUpperCase().replace(/-/g, '_')}_KEY`;

const K = `worlds.${DEEPSEEK_USAGE_ID}`;
export const PROMPT_LANGUAGE_OPTIONS = `${DEEPSEEK_USAGE_ID}:prompt-language`;

const TEXT = {
  zh: {
    title: 'DeepSeek 余额',
    promptLanguage: { title: '提示词语言', description: '环境提示词、工具回执和事件正文的语言。' },
    cacheSec: { title: '读数缓存', description: '同一账户这段时间内再查，直接用上次的读数。' },
    scheduleEnabled: { title: '定时播报' },
    times: { title: '播报时刻', description: '本地时间 HH:MM,逗号分隔。' },
    scheduleWake: { title: '播报时叫醒 bot', description: '关闭时随下一批事件送达。' },
    checkMinutes: { title: '警告线检查间隔', description: '只查设了警告线的账户。' },
    alertsWake: { title: '跌破警告线时叫醒 bot', description: '关闭时随下一批事件送达。' },
    sec: '秒', min: '分钟',
  },
  en: {
    title: 'DeepSeek Usage',
    promptLanguage: { title: 'Prompt language', description: 'Language of the environment prompt, tool results and events.' },
    cacheSec: { title: 'Reading cache', description: 'Asking again within this time reuses the last reading of the account.' },
    scheduleEnabled: { title: 'Scheduled report' },
    times: { title: 'Report times', description: 'Local HH:MM, comma-separated.' },
    scheduleWake: { title: 'Wake the bot for reports', description: 'Off delivers them with the next batch of events.' },
    checkMinutes: { title: 'Warning line check interval', description: 'Only accounts with a warning line are checked.' },
    alertsWake: { title: 'Wake the bot below a warning line', description: 'Off delivers it with the next batch of events.' },
    sec: 's', min: 'min',
  },
};

export const promptLanguageOptions = (): Array<{ value: string; label: string }> =>
  [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }];

export function configGroups(language: Language): ConfigGroup[] {
  const t = pick(language, TEXT);
  return [{
    id: `world:${DEEPSEEK_USAGE_ID}`,
    owner: `world:${DEEPSEEK_USAGE_ID}`,
    schema: {
      type: 'object',
      title: t.title,
      properties: {
        [`${K}.promptLanguage`]: { type: 'string', ...t.promptLanguage, 'x-options': PROMPT_LANGUAGE_OPTIONS, 'x-hot': true },
        [`${K}.cacheSec`]: { type: 'integer', ...t.cacheSec, minimum: 0, maximum: 3600, 'x-suffix': t.sec, 'x-hot': true },
        [`${K}.schedule.enabled`]: { type: 'boolean', ...t.scheduleEnabled, 'x-hot': true },
        [`${K}.schedule.times`]: { type: 'string', ...t.times, 'x-hot': true },
        [`${K}.schedule.wake`]: { type: 'boolean', ...t.scheduleWake, 'x-hot': true },
        [`${K}.alerts.checkMinutes`]: { type: 'integer', ...t.checkMinutes, minimum: 5, maximum: 1440, 'x-suffix': t.min, 'x-hot': true },
        [`${K}.alerts.wake`]: { type: 'boolean', ...t.alertsWake, 'x-hot': true },
      },
    },
  }];
}
