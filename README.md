# cortico-world-deepseek-usage

<img src="assets/icon.png" width="96" alt="">

Cortico World:bot 查询 DeepSeek 账户余额，可以定时把余额发给 bot,账户跌破警告线时提醒。

读数来自 DeepSeek 官方接口 `GET https://api.deepseek.com/user/balance`,用调用模型的同一把 API Key:每种币种的余额、其中赠金、其中充值，以及余额够不够调用。

## 使用

在 Cortico WebUI 的扩展市场里安装，或在扩展目录 `pnpm add cortico-world-deepseek-usage`。启用 World 后打开它的页面:

- **快速配置**:粘贴 key,停顿后自动测试，测试通过后保存;可以登记多个账户。账户卡片上能看余额、填警告线、刷新、更换 key、删除。
- **定时与提醒**:播报时刻、送达方式(叫醒 bot / 随下一批事件)、警告线检查间隔，以及播报正文的预览。
- **配置**:上面这些设置加提示词语言、读数缓存时长。

key 存在部署 `.env` 的 `DEEPSEEK_USAGE_<账户 id>_KEY`,页面与工具回执只显示前 6 后 4 位。

## 给 bot 的工具

| 工具 | 作用 |
|---|---|
| `deepseek_usage_check` | 查一个或全部账户的余额，带查询时刻 |
| `deepseek_usage_add_account` | 用一把 key 登记账户，先查一次，查通才保存 |
| `deepseek_usage_edit_account` | 改备注、设或去掉警告线、删除账户 |
| `deepseek_usage_set_schedule` | 设定时播报的时刻与是否叫醒 bot |

## 事件

| type | 何时 |
|---|---|
| `deepseek-usage.report` | 到了播报时刻;bot 没开错过的时刻不补发 |
| `deepseek-usage.low` | 余额从警告线上方跌到下方;回到上方后再跌破才再发。比的是第一种币种的余额 |

## 开发

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

图标源文件是 `assets/icon.svg`,`assets/icon.png` 由它导出(256×256)。
