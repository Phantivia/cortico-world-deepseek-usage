import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { DEEPSEEK_USAGE_DEFAULTS, DEEPSEEK_USAGE_ID, PROMPT_LANGUAGE_OPTIONS, promptLanguageOptions, type DeepseekUsageConfigSection } from './config.ts';
import { DEEPSEEK_USAGE_TOOL_DECLS } from './tools.ts';
import { DeepseekUsageWorld } from './world.ts';

export const DEEPSEEK_USAGE: WorldDefinition<DeepseekUsageConfigSection> = {
  id: DEEPSEEK_USAGE_ID,
  label: 'DeepSeek Usage',
  defaults: () => structuredClone(DEEPSEEK_USAGE_DEFAULTS),
  configOptions(kind) {
    return kind === PROMPT_LANGUAGE_OPTIONS ? promptLanguageOptions() : [];
  },
  create: (ctx) => new DeepseekUsageWorld({
    cfg: ctx.cfg,
    timezone: ctx.timezone,
    dataDir: ctx.dataDir,
    secret: (name) => ctx.secret(name),
    storeSecret: (name, value) => ctx.storeSecret(name, value),
    persist: (patch) => ctx.persist(patch),
  }),
  describe: {
    tools: describeTools(DEEPSEEK_USAGE_TOOL_DECLS, {
      deepseek_usage_check: { zh: '查登记的 DeepSeek 账户余额,带查询时刻。', en: 'Reads the balance of the registered DeepSeek accounts, with the time read.' },
      deepseek_usage_add_account: { zh: '用一把 API key 登记账户;先查一次,查通才保存。', en: 'Registers an account with an API key; saved only if a first read works.' },
      deepseek_usage_edit_account: { zh: '改账户备注、设或去掉警告线、删除账户。', en: 'Renames an account, sets or clears its warning line, or removes it.' },
      deepseek_usage_set_schedule: { zh: '设定时播报的时刻与是否叫醒 bot。', en: 'Sets the scheduled report times and whether they wake the bot.' },
    }),
    events: [
      { type: 'deepseek-usage.report', description: { zh: '定时播报:全部账户此刻的余额;按设置叫醒 bot 或随下一批事件送达。', en: 'Scheduled report of every account\'s balance; wakes the bot or rides with the next batch, as set.' }, trigger: 'flush' },
      { type: 'deepseek-usage.low', description: { zh: '某个账户的余额从警告线上方跌到下方;按设置叫醒 bot 或随下一批事件送达。', en: 'An account\'s balance dropped below its warning line; wakes the bot or rides with the next batch, as set.' }, trigger: 'flush' },
    ],
  },
};
