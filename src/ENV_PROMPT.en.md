## DeepSeek account balances

You can read the balance of the DeepSeek accounts the operator registered: {{deepseek-usage.accounts}}. Readings are what DeepSeek reported at the time shown in the result, in the currency shown; do not convert or guess.

You can also register an account for the operator (they give you the API key), rename one, set warning lines, remove one, and change the scheduled report. A key is stored in the deployment config and never shown again; if someone posts a key where others can see it, tell them to revoke it on the DeepSeek platform.

### Events

- `deepseek-usage.report`: scheduled report of every account's balance. Report times: {{deepseek-usage.schedule}}.
- `deepseek-usage.low`: an account dropped below its warning line. Warning lines: {{deepseek-usage.alerts}}.
