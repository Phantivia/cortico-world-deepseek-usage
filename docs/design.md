# cortico-world-deepseek-usage 设计

## 范围

只接 DeepSeek:`GET https://api.deepseek.com/user/balance`,推理的同一把 key,`Authorization: Bearer`。
字段按官方文档(2026-10-21 读):`is_available`;`balance_infos[]` 每种币种一项，`currency` 为 CNY 或 USD,
`total_balance`、`granted_balance`、`topped_up_balance` 是字符串。其他服务商的调研留在 [research.md](research.md),
这个包不接。

## World

| 项 | 值 |
|---|---|
| World id | `deepseek-usage` |
| 工具 | `deepseek_usage_check`、`deepseek_usage_add_account`、`deepseek_usage_edit_account`、`deepseek_usage_set_schedule` |
| 事件 | `deepseek-usage.report`(定时播报)、`deepseek-usage.low`(跌破警告线) |

- 读数原样报出，带查询时刻与币种;World 不判断够不够用。警告线比第一种币种的余额，跌破才推事件，回到线上方再跌破才再推。
- 同一账户 `cacheSec`(缺省 60 秒)内重复查询用上次结果。
- key 存部署 `.env`(`DEEPSEEK_USAGE_<账户 id>_KEY`),只经 `ctx.secret` 读，页面和回执只显示前 6 后 4 位。
- 账户元数据在 `worlds.deepseek-usage.accounts`(id、备注、警告线),由面板和工具经 `ctx.persist` 整表写回，不进配置 schema。
  第一个账户 id 是 `main`,之后 `account-2`……
- 最近一次读数、警告状态、各播报时刻上次发出的日期存 `<dataDir>/deepseek-usage-state.json`。

### 自配置工具

bot 可以自己加账户、改备注和警告线、删账户、改定时播报。加账户时先查一次，查不通不保存。工具回执不回显 key。

### 定时

- 定时播报：按本地时刻列表(`HH:MM`)把全部账户的余额推成一条 `deepseek-usage.report`,可选叫醒 bot 或随下一批事件送达。
  时刻过去 10 分钟内仍会发;bot 没开错过的不补发。
- 警告检查：有账户设了警告线时，每 `alerts.checkMinutes` 查一次;bot 调工具、面板刷新、定时播报查到的读数也算。

## 界面(World 页的页签)

1. **快速配置**:账户卡片(备注、状态、余额大字、赠金/充值/够不够调用、警告线就地填、刷新、改名、更换 Key、删除);
   添加账户：粘贴 key → 停顿后自动测试、当场出余额 →「保存」,附 DeepSeek 开放平台的 key 页链接。
2. **定时与提醒**:播报时刻的增删、叫醒与否、下一次播报时间;警告线对照表、检查间隔、叫醒与否;播报正文预览与「现在发一条」。
3. **配置**:WebUI 按 schema 渲染全部可调项。

## 图标

`assets/icon.svg` 是原创的余额表盘(白色表盘、橙色警告线刻度、蓝色渐变底),不用 DeepSeek 的商标图形;`icon.png` 由它导出。
