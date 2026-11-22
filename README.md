# multi-site-auto-checkin

每天在云端自动为多个 AI 站点签到领取积分。

## 已接入站点

| 站点 | 登录方式 | 说明 |
| --- | --- | --- |
| [kk.xjidjjdj.xyz](https://kk.xjidjjdj.xyz) | 访问令牌 | 需要 Cloudflare Turnstile，脚本用真实浏览器完成并自动点击验证框 |
| [DGB 公益站](https://freeapi.dgbmc.top) | 账号密码 | 新版 JWT 登录，无验证码 |
| [AIAIAI 工具箱](https://api.aiaiai001.com) | 账号密码 | 无验证码 |
| [帮帮程序员](https://helpcoder.cc) | 账号密码 | 无验证码 |
| [可萌中转站](https://api456.me) | 账号密码 | 新版 JWT 登录，签到无需验证码 |
| [SeekAI](https://seekai.cc) | 访问令牌 | 系统访问令牌，签到无需验证码 |
| [神秘小站](http://newapi.benst.asia) | 访问令牌 | 每日名额有限，凌晨 02:00 开放，已安排 02:00/02:10 抢名额 |

## 原理

1. 账号密码类站点：登录 → 查询 `/api/user/checkin` 状态 → 未签到则 `POST` 签到，单个站点失败不影响其他站点。
2. kk 站点：用访问令牌查状态，未签到则用 Playwright 打开登录页，等待 Turnstile 完成（必要时自动点击“请验证您是真人”），并在同一浏览器页面内调用签到接口。

所有令牌和密码只保存在 GitHub Actions Secret 中，不会写入代码。

## 可靠性设计

- **一天三次兜底**：北京时间 06:20 / 09:10 / 13:30 各运行一次，已签到会自动跳过，单次失败还有后两次补签。
- **自动保活**：GitHub 会在仓库连续 60 天无提交时停用定时任务；本项目每天第一次运行会自动向 `history/run.log` 提交一条记录，保持定时任务不被停用。
- **单站隔离**：每个站点独立执行，单个站点失败不影响其他站点，最终仍会把失败暴露为红色运行结果。
- **凭据零明文**：脚本只从环境变量 / Secret 读取凭证，仓库中没有任何密钥。

## 部署步骤

1. 新建 GitHub 仓库并推送本项目。
2. 仓库 **Settings → Secrets and variables → Actions** 中添加：
   - `KK_TOKEN`：kk 站的 `nap_` 访问令牌
   - `CHECKIN_USERNAME`：账号密码类站点的默认用户名
   - `CHECKIN_PASSWORD`：对应的默认密码
   - `SEEKAI_TOKEN`：SeekAI 安全设置里生成的系统访问令牌
   - `BENST_TOKEN`：神秘小站的 `nap_` 访问令牌
3. 打开 **Actions** 页面，选择 `Daily check-in`，点击 **Run workflow** 手动验证；勾选 `force` 可强制重跑 kk 的 Turnstile 验证流程。
4. 之后每天北京时间 **02:00 / 02:10** 抢神秘小站名额，**06:20 / 09:10 / 13:30** 继续兜底（cron 在 `.github/workflows/checkin.yml` 中修改）。

## 本地运行

```bash
npm install
npx playwright install chromium

# 账号密码类站点
CHECKIN_USERNAME='zhaofan' CHECKIN_PASSWORD='xxx' node checkin-passwords.js

# kk 站点
KK_TOKEN='nap_xxx' node checkin.js
```

无图形界面的机器可加 `KK_HEADLESS=1`。

## 可配置环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `CHECKIN_USERNAME` | 账号密码类站点的用户名 | - |
| `CHECKIN_PASSWORD` | 账号密码类站点的密码 | - |
| `SEEKAI_TOKEN` | SeekAI 系统访问令牌 | - |
| `BENST_TOKEN` | 神秘小站访问令牌 | - |
| `KK_TOKEN` | kk 站访问令牌 | - |
| `KK_BASE_URL` | kk 站点地址 | `https://kk.xjidjjdj.xyz` |
| `KK_HEADLESS` | 设为 `0` 以有头模式运行 | 有头 |
| `KK_CHANNEL` | 使用已安装的 Chrome，如 `chrome` | 内置 Chromium |
| `KK_FORCE` | 设为 `1`/`true` 时忽略“今日已签到”强制测试 | 关闭 |
| `KK_MAX_ATTEMPTS` | kk 站最大尝试次数 | `3` |
| `KK_TOKEN_TIMEOUT_MS` | 等待 Turnstile 的超时时间 | `90000` |
| `KK_TURNSTILE_TOKEN` | 手动指定 Turnstile token（本机调试用） | - |

站点列表维护在 `checkin-passwords.js` 顶部的 `SITES` 数组中，新增站点只需追加名称和地址。

## 注意

- Cloudflare Turnstile 属于人机验证，真实浏览器自动通过并非 100% 成功；失败时 Actions 会显示红色并输出原因，可手动重新运行。
- 仓库连续 60 天无提交时 GitHub 会自动暂停定时任务，届时在 Actions 页面点击启用即可。
- 请遵守站点使用条款，控制运行频率。
