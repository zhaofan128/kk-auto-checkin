const { chromium } = require('playwright');

// 需要 Turnstile 验证的令牌类站点
const SITES = [
  { name: 'SeekAI', url: 'https://seekai.cc', tokenEnv: 'SEEKAI_TOKEN' },
];

const MAX_ATTEMPTS = Math.max(1, Number(process.env.KK_MAX_ATTEMPTS) || 3);
const TOKEN_TIMEOUT_MS = Math.max(15000, Number(process.env.KK_TOKEN_TIMEOUT_MS) || 90000);
const FORCE = /^(1|true)$/i.test(process.env.SITE_FORCE || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);

async function api(site, path, token, init = {}) {
  const res = await fetch(`${site.url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回异常 (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
}

async function waitTurnstileToken(page) {
  const deadline = Date.now() + TOKEN_TIMEOUT_MS;
  let lastClick = 0;
  let clicks = 0;
  while (Date.now() < deadline) {
    const token = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) return input.value;
      try {
        return (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || '';
      } catch {
        return '';
      }
    });
    if (token) return token;

    if (clicks < 3 && Date.now() - lastClick > 15000) {
      const frame = page.frames().find((f) => f.url().includes('challenges.cloudflare.com'));
      if (frame) {
        const element = await frame.frameElement().catch(() => null);
        const box = element && (await element.boundingBox().catch(() => null));
        if (box && box.width > 50 && box.height > 20) {
          await page.mouse.click(box.x + 30, box.y + box.height / 2).catch(() => {});
          clicks += 1;
          lastClick = Date.now();
          log('检测到人机验证，已尝试点击验证框');
        }
      }
    }
    await page.waitForTimeout(2000);
  }
  return '';
}

async function checkinInBrowser(site, token) {
  const launchOptions = {
    headless: process.env.KK_HEADLESS !== '0',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };
  if (process.env.PLAYWRIGHT_CHROME_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
  }
  const proxy = process.env.KK_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (proxy) {
    launchOptions.proxy = { server: proxy };
  }

  let browser;
  const channel = process.env.KK_CHANNEL;
  try {
    browser = await chromium.launch(channel ? { ...launchOptions, channel } : launchOptions);
  } catch (err) {
    if (!channel) throw err;
    log(`启动 ${channel} 失败，回退到内置 Chromium: ${err.message.split('\n')[0]}`);
    browser = await chromium.launch(launchOptions);
  }

  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1366, height: 800 },
    });
    const page = await context.newPage();
    log(`[${site.name}] 打开登录页，等待 Turnstile 验证...`);
    await page.goto(`${site.url}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const turnstileToken = await waitTurnstileToken(page);
    if (!turnstileToken) {
      await page.screenshot({ path: '/tmp/turnstile-timeout.png' }).catch(() => {});
      throw new Error('Turnstile 验证超时，未能获取 token');
    }
    log(`[${site.name}] Turnstile 验证完成，token 长度 ${turnstileToken.length}`);

    const apiUrl = `${site.url}/api/user/checkin?turnstile=${encodeURIComponent(turnstileToken)}`;
    const res = await page.evaluate(async ({ url, auth }) => {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
          body: '{}',
        });
        return { status: r.status, text: await r.text() };
      } catch (err) {
        return { error: String(err) };
      }
    }, { url: apiUrl, auth: token });

    if (res.error) throw new Error(`浏览器内签到请求失败: ${res.error}`);
    try {
      return JSON.parse(res.text);
    } catch {
      throw new Error(`签到接口返回异常 (HTTP ${res.status}): ${res.text.slice(0, 200)}`);
    }
  } finally {
    await browser.close();
  }
}

async function processSite(site) {
  const token = (process.env[site.tokenEnv] || '').trim();
  if (!token) throw new Error(`缺少环境变量 ${site.tokenEnv}`);

  const status = await api(site, '/api/user/checkin', token);
  if (!status.success || !status.data) {
    throw new Error(`查询签到状态失败: ${status.message || '未知错误'}`);
  }

  const stats = status.data.stats || {};
  log(`[${site.name}] 今日已签到: ${stats.checked_in_today ? '是' : '否'}`);
  if (stats.checked_in_today && !FORCE) {
    log(`[${site.name}] 跳过`);
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`[${site.name}] 第 ${attempt}/${MAX_ATTEMPTS} 次尝试签到...`);
    const result = await checkinInBrowser(site, token);
    if (result && result.success) {
      log(`[${site.name}] 签到成功，获得额度 ${result.data && result.data.quota_awarded}`);
      return;
    }
    const message = (result && (result.message || result.message_key)) || JSON.stringify(result);
    log(`[${site.name}] 签到失败: ${message}`);
    if (/already|已签到|今天已/i.test(message)) {
      log(`[${site.name}] 今日已签到`);
      return;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(15000 * attempt);
  }

  throw new Error('已达到最大重试次数，签到失败');
}

async function main() {
  const failures = [];
  for (const site of SITES) {
    try {
      await processSite(site);
    } catch (err) {
      log(`[${site.name}] 执行失败: ${err.message}`);
      failures.push(site.name);
    }
  }
  if (failures.length) throw new Error(`以下站点执行失败: ${failures.join('、')}`);
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} 执行失败: ${err.message}`);
  process.exit(1);
});
