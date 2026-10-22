/** 包入口:默认导出 `WorldDefinition`,加载器按 `cortico.kind === 'world'` 认它。 */
import { DEEPSEEK_USAGE } from './definition.ts';

export default DEEPSEEK_USAGE;
export { DEEPSEEK_USAGE };
export type { DeepseekUsageConfigSection } from './config.ts';
