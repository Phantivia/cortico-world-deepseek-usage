import type { ToolDef } from 'cortico/core/types.ts';

/** 工具声明(不含 handler);`describe.tools` 与 `tools()` 都从这里取。 */
export const DEEPSEEK_USAGE_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'deepseek_usage_check',
    description: 'Balance of the registered DeepSeek accounts, read from DeepSeek (a reading younger than the cache time is reused; the result gives its time). Omit account to read all.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { account: { type: 'string', description: 'Account id or label.' } },
    },
  },
  {
    name: 'deepseek_usage_add_account',
    description: 'Register a DeepSeek account with its API key. The key is read once first and the account is saved only if that works. The key is stored in the deployment .env and never shown again.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: { type: 'string' },
        label: { type: 'string', maxLength: 40, description: 'Name for the account. Default "DeepSeek".' },
        warn_below: { type: 'number', description: 'Warning line in the account\'s currency; an event arrives when the balance drops below it.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'deepseek_usage_edit_account',
    description: 'Rename an account, set or clear its warning line, or remove it together with its stored key.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        account: { type: 'string', description: 'Account id or label.' },
        label: { type: 'string', maxLength: 40 },
        warn_below: { type: 'number', description: 'New warning line in the account\'s currency.' },
        clear_warning: { type: 'boolean' },
        remove: { type: 'boolean' },
      },
      required: ['account'],
    },
  },
  {
    name: 'deepseek_usage_set_schedule',
    description: 'Set when a report of all accounts arrives as an event, and whether it wakes you. An empty times list turns the report off.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        times: { type: 'array', maxItems: 12, items: { type: 'string', pattern: '^\\d{1,2}:\\d{2}$' }, description: 'Local times, HH:MM.' },
        wake: { type: 'boolean', description: 'true wakes you at each report; false delivers it with the next batch of events.' },
      },
    },
  },
];
