const { chromium } = require('playwright');

const BASE_URL = (process.env.KK_BASE_URL || 'https://kk.xjidjjdj.xyz').replace(/\/+$/, '');
const TOKEN = (process.env.KK_TOKEN || '').trim();
const MAX_ATTEMPTS = Math.max(1, Number(process.env.KK_MAX_ATTEMPTS) || 3);
const TOKEN_TIMEOUT_MS = Math.max(15000, Number(process.env.KK_TOKEN_TIMEOUT_MS) || 90000);
const MANUAL_TOKEN = (process.env.KK_TURNSTILE_TOKEN || '').trim();
const FORCE = /^(1|true)$/i.test(process.env.KK_FORCE || '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...args) => console.log(new Date().toISOString(), ...args);

async function api(path, init = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回异常 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getStatus() {
  const data = await api('/api/user/checkin');
  if (!data || data.success !== true || !data.data) {
    throw new Error(`获取签到状态失败: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.data;
}

// 在真实浏览器里打开站点，触发 Cloudflare Turnstile 并取出验证 token
async function solveTurnstile() {
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

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1366, height: 800 },
    });
    const page = await context.newPage();
    log('打开登录页，等待 Turnstile 验证...');
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    const deadline = Date.now() + TOKEN_TIMEOUT_MS;
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
      if (token) {
        log(`Turnstile 验证完成，token 长度 ${token.length}`);
        return token;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error('Turnstile 验证超时，未能获取 token');
  } finally {
    await browser.close();
  }
}

async function doCheckin(turnstileToken) {
  const url = `${BASE_URL}/api/user/checkin?turnstile=${encodeURIComponent(turnstileToken)}`;
  return api(url, { method: 'POST', body: '{}' });
}

async function main() {
  if (!TOKEN) {
    throw new Error('缺少环境变量 KK_TOKEN（站点访问令牌）');
  }
  log(`站点: ${BASE_URL}`);
  log('查询签到状态...');
  const status = await getStatus();
  const stats = status.stats || {};
  log(`今日已签到: ${stats.checked_in_today ? '是' : '否'}，累计 ${stats.total_checkins || 0} 次`);

  if (stats.checked_in_today && !FORCE) {
    log('今天已经签到过了，无需重复操作。');
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    log(`第 ${attempt}/${MAX_ATTEMPTS} 次尝试签到...`);
    const turnstileToken = MANUAL_TOKEN || (await solveTurnstile());
    const result = await doCheckin(turnstileToken);

    if (result && result.success) {
      const awarded = result.data && result.data.quota_awarded;
      log(`签到成功，获得额度: ${awarded}`);
      return;
    }

    const message = (result && (result.message || result.message_key)) || JSON.stringify(result);
    log(`签到失败: ${message}`);
    if (/already|已签到|今天已/i.test(message)) {
      log('今天已经签到过了。');
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      const wait = 15000 * attempt;
      log(`等待 ${wait / 1000}s 后重试...`);
      await sleep(wait);
    }
  }

  throw new Error('已达到最大重试次数，签到失败');
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} 执行失败: ${err.message}`);
  process.exit(1);
});
