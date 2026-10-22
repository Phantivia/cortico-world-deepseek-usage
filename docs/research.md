# 调研：各服务商的余额/用量查询接口

2026-10-21 读官方文档原文，另读了 one-api、new-api、CC Switch、CodexBar、openai/codex、kimi-cli、
MiniMax CLI、volcengine/ark-cli 的源码找端点。**所有端点都没有拿真 key 实测过**,字段名对过官方 schema、
官方示例或参考源码。

「来源」一列:官方 = 官方 API 文档公开;官方仓库 = 服务商自己的开源仓库里写了、API 文档没写;
非公开 = 只在官方客户端源码或第三方工具里出现，路径和字段变过，算账号风险。

## 总表

### A. 推理用的 key 直接能查

| 服务商 | 端点 | 返回 | 单位 | 来源 |
|---|---|---|---|---|
| DeepSeek | `GET api.deepseek.com/user/balance` | `is_available`;`balance_infos[]{currency,total_balance,granted_balance,topped_up_balance}` | CNY 或 USD,字符串 | 官方 |
| Kimi 开放平台 | `GET api.moonshot.cn/v1/users/me/balance`(国际 `.ai`) | `data{available_balance,voucher_balance,cash_balance}`,cash 可为负(欠费) | 国内元/国际 USD | 官方 |
| 阶跃星辰 | `GET api.stepfun.com/v1/accounts`(国际 `api.stepfun.ai`) | `balance`;`total_cash_balance`、`total_voucher_balance` 是累计数 | 未写，推断元/USD | 官方 |
| OpenRouter 单 key | `GET openrouter.ai/api/v1/key` | `data{limit(null=不限),limit_remaining,limit_reset,usage,usage_daily/weekly/monthly}` | USD | 官方 |
| SiliconFlow 国际站 | `GET api.siliconflow.com/v1/user/info` | `data{balance,chargeBalance,totalBalance}` 字符串 | 未写 | 官方;**国内站 2026-08-14 已停** |
| one-api/new-api 中转 | `GET {base}/v1/dashboard/billing/subscription` + `/usage` | 余额 = `hard_limit_usd - total_usage/100`;无限令牌回 100000000 | 美元或站点币种 | 中转站兼容接口 |
| new-api 令牌 | `GET {base}/api/usage/token/` | `data{total_granted,total_used,total_available,unlimited_quota,expires_at}` | quota ÷ `/api/status` 的 `quota_per_unit` | new-api 文档 |
| AIHubMix | `GET aihubmix.com/dashboard/billing/remain` | key 剩余额度(文档没给字段) | 未写 | 官方 |
| Novita | `GET api.novita.ai/openapi/v1/billing/balance/detail` | `availableBalance,cashBalance,creditLimit` | 1/10000 美元 | 官方 |
| PPIO 派欧云 | `GET api.ppio.com/openapi/v1/billing/balance/detail` | 同 Novita | 1/10000 元 | 官方 |
| 302.AI | `GET api.302.ai/dashboard/balance`(国内 `api.302ai.com`) | `data.balance`;key 要开权限 | 未写 | 官方 |
| API2D | `GET oa.api2d.net/dashboard/billing/credit_grants` | `total_available` | 点数 | 官方 |

### B. 要另一种凭证(全是官方接口)

| 服务商 | 凭证 | 端点 | 返回 | 口径 |
|---|---|---|---|---|
| OpenRouter 账户 | Management Key | `GET /api/v1/credits` | `total_credits,total_usage`,余额自己减 | 账户余额;普通 key 回 403 |
| xAI | Management Key + team_id(team_id 可用推理 key 调 `GET api.x.ai/v1/api-key` 拿) | `GET management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance` | `total.val` | 美分字符串，符号反着(负数=有余额，推断) |
| OpenAI | Admin Key `sk-admin-` | `GET /v1/organization/costs`(`start_time` 必填,`bucket_width=1d`) | 每天花费，美元 | **没有余额接口**,只有花费 |
| Anthropic | Admin Key `sk-ant-admin01-` | `GET /v1/organizations/cost_report`(`starting_at` 必填) | 每天花费,**美分字符串** | **没有余额接口**;个人账户用不了 |
| 通义千问(百炼) | 阿里云 AccessKey ID/Secret,RAM `bss:DescribeAcccount` | BSS `QueryAccountBalance`,ACS3-HMAC-SHA256 签名 | `Data.AvailableAmount` 等，元字符串 | 整个阿里云账户 |
| 豆包(火山方舟) | 火山 AK/SK | billing `QueryBalanceAcct` 2022-01-01,火山 V4 签名 | `Result.AvailableBalance` 等，元字符串 | 整个火山账户;ARK key 回 400 |
| 百度千帆 | 百度云 AK/SK | `POST billing.baidubce.com/v1/finance/cash/balance`,bce-auth-v1 签名 | `cashBalance` | 整个百度云账户;千帆 Bearer key 能否调未核实 |
| 腾讯混元 | SecretId/SecretKey | `DescribeAccountBalance` 2018-07-09,TC3 签名 | `RealBalance` 等 | 整个腾讯云账户，单位**分** |

### C. 非公开端点(套餐额度为主)

| 服务商 | 凭证 | 端点 | 返回 | 出处 |
|---|---|---|---|---|
| 智谱/Z.ai Coding Plan | 推理 key,`Authorization` **不加 Bearer** | `GET open.bigmodel.cn/api/monitor/usage/quota/limit`(国际 `api.z.ai`) | `limits[]{type,unit,number,percentage(已用%),nextResetTime(ms)}`;没开套餐回 200 + `code:500` | 官方仓库 zai-org/ZCode |
| 智谱余额 | 推理 key | `GET {host}/api/biz/account/query-customer-account-report` | `data{balance,availableBalance,frozenBalance}` 元 | 逆向(CC Switch、CodexBar) |
| Kimi Coding Plan | Kimi Code 的 key(不是开放平台那把) | `GET api.kimi.com/coding/v1/usages` | 周额度 + 5 小时窗口剩余、重置时间;格式变过 | 官方 kimi-cli 源码 |
| MiniMax 按量 | `sk-api-` key | `GET {base}/account/query_balance` | `available_amount,cash_balance,voucher_balance,owed_amount` | 官方 MiniMax CLI 源码 |
| MiniMax Token Plan | 套餐 key | `GET {base}/v1/token_plan/remains`(2026-06 前是 `/v1/api/openplatform/coding_plan/remains`) | `model_remains[]` 5 小时/周剩余%;老响应 `*_usage_count` 实为剩余 | 同上 |
| 火山 Coding Plan | 火山 AK/SK | `GetCodingPlanUsage` 2024-01-01 | `QuotaUsage[]{Level,Percent,ResetTime}` | 官方 ark-cli |
| ChatGPT 订阅 | Codex OAuth access_token + account_id | `GET chatgpt.com/backend-api/wham/usage` | 5h/周 `used_percent`、`reset_at`、credits | openai/codex 源码 |
| Claude 订阅 | OAuth token(要 `user:profile` scope) | `GET api.anthropic.com/api/oauth/usage` | `five_hour`、`seven_day` 的 `utilization`;容易 429 | CodexBar |

### D. 查不到

- Gemini:官方原文写余额和用量只在 AI Studio 看;Cloud Billing API 不给余额。
- 讯飞星火、无问芯穹、Groq、Together、Mistral(非企业)、Fireworks(只有花费)、Requesty:没有余额接口。
- 百炼 Coding Plan(`sk-sp-`):没找到额度接口。

## 对照 Coopanion 的 14 家

| Coo 的服务商 | 能做到什么 | 凭证 |
|---|---|---|
| DeepSeek | 余额 | 同 key |
| Kimi | 余额(+ Coding Plan 额度，非公开) | 同 key |
| 阶跃星辰 | 余额 | 同 key |
| OpenRouter | key 额度;账户余额要 Management Key | 同 key / 另一把 |
| 智谱 GLM | Coding Plan 额度(官方仓库);余额只有逆向接口 | 同 key |
| MiniMax | 余额与套餐额度，都是非公开 | 同 key |
| xAI | 余额 | Management Key + team_id |
| OpenAI | 近 N 天花费，无余额 | Admin Key |
| Anthropic | 近 N 天花费，无余额 | Admin Key |
| 通义千问 | 阿里云账户余额 | AK/SK |
| 豆包 | 火山账户余额(+ Coding Plan,非公开) | AK/SK |
| 百度千帆 | 百度云现金余额 | AK/SK |
| ChatGPT 登录 | 订阅额度，非公开 | OAuth,扩展拿不到 Coo 存的令牌 |
| Gemini | 查不到 | — |

## 未核实

- 全部端点没实测，含无效 key 的实际返回。
- 币种是推断的：阶跃、MiniMax 余额、302.AI、SiliconFlow。
- SiliconFlow 国际站 `/v1/user/info` 今天能否用;智谱余额接口国际站结构。
- 千帆 Bearer key 能否调计费接口;Novita/PPIO 的余额 key 是不是推理那把。
- xAI 余额符号与所需权限;腾讯 TC3 签名名凭记忆，没回文档核对。
- OpenAI platform 文档页抓取被 403,以 GitHub openai/openai-openapi 规范为准。
