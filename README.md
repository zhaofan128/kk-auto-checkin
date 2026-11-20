# kk-auto-checkin

每天在云端自动为 [kk.xjidjjdj.xyz](https://kk.xjidjjdj.xyz) 签到领取积分。

## 原理

1. 使用站点访问令牌查询当天签到状态（`GET /api/user/checkin`），已签到则直接退出。
2. 未签到则用 Playwright 打开站点登录页，等待 Cloudflare Turnstile 完成；若出现“请验证您是真人”，会自动点击验证框。
3. 在同一个浏览器页面内调用 `POST /api/user/checkin?turnstile=...` 完成签到，失败会自动重试。

令牌只保存在 GitHub Actions Secret 中，不会写入代码。

## 部署步骤

1. 新建 GitHub 仓库并推送本项目。
2. 仓库 **Settings → Secrets and variables → Actions → New repository secret**：
   - Name: `KK_TOKEN`
   - Secret: 你的站点访问令牌（`nap_` 开头）
3. 打开 **Actions** 页面，选择 `Daily check-in`，点击 **Run workflow** 手动验证一次；勾选 `force` 可在当天已签到时强制走一遍验证流程。
4. 之后每天北京时间 08:17 自动执行（cron 为 UTC 00:17，可在 `.github/workflows/checkin.yml` 中修改）。

## 本地运行

```bash
npm install
npx playwright install chromium
KK_TOKEN='nap_xxx' node checkin.js
```

无图形界面的机器可加 `KK_HEADLESS=1`。

## 可配置环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `KK_TOKEN` | 站点访问令牌（必填） | - |
| `KK_BASE_URL` | 站点地址 | `https://kk.xjidjjdj.xyz` |
| `KK_HEADLESS` | 设为 `0` 以有头模式运行 | 有头 |
| `KK_CHANNEL` | 使用已安装的 Chrome，如 `chrome` | 内置 Chromium |
| `KK_FORCE` | 设为 `1`/`true` 时忽略“今日已签到”强制测试 | 关闭 |
| `KK_MAX_ATTEMPTS` | 最大尝试次数 | `3` |
| `KK_TOKEN_TIMEOUT_MS` | 等待 Turnstile 的超时时间 | `90000` |
| `KK_TURNSTILE_TOKEN` | 手动指定 Turnstile token（本机调试用） | - |

## 注意

- Cloudflare Turnstile 属于人机验证，真实浏览器自动通过并非 100% 成功；失败时 Actions 会显示红色并输出原因，可手动重新运行。
- 仓库连续 60 天无提交时 GitHub 会自动暂停定时任务，届时在 Actions 页面点击启用即可。
- 请遵守站点使用条款，控制运行频率。
