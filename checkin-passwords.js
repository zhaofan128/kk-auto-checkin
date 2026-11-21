const SITES = [
  { name: 'DGB 公益站', url: 'https://freeapi.dgbmc.top' },
  { name: 'AIAIAI 工具箱', url: 'https://api.aiaiai001.com' },
  { name: '帮帮程序员', url: 'https://helpcoder.cc' },
  { name: '可萌中转站', url: 'https://api456.me' },
];

const USERNAME = (process.env.CHECKIN_USERNAME || '').trim();
const PASSWORD = process.env.CHECKIN_PASSWORD || '';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const log = (...args) => console.log(new Date().toISOString(), ...args);

async function request(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`接口返回异常 (HTTP ${res.status}): ${text.slice(0, 160)}`);
  }
  return { res, data };
}

async function login(site) {
  const { res, data } = await request(`${site.url}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!data.success) {
    throw new Error(`登录失败: ${data.message || data.message_key || '未知错误'}`);
  }
  const payload = data.data || {};
  const user = payload.user || payload;
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return {
    user,
    token: payload.access_token || '',
    cookie: cookies.map((c) => c.split(';')[0]).join('; '),
  };
}

function authHeaders(session) {
  const headers = { 'User-Agent': UA, 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.cookie) headers.Cookie = session.cookie;
  if (session.user && session.user.id) headers['New-Api-User'] = String(session.user.id);
  return headers;
}

async function processSite(site) {
  const session = await login(site);
  const status = await request(`${site.url}/api/user/checkin`, {
    headers: authHeaders(session),
  });
  if (!status.data.success || !status.data.data) {
    throw new Error(`查询签到状态失败: ${status.data.message || '未知错误'}`);
  }

  const stats = status.data.data.stats || {};
  if (stats.checked_in_today) {
    log(`[${site.name}] 今日已签到，跳过`);
    return;
  }

  const result = await request(`${site.url}/api/user/checkin`, {
    method: 'POST',
    headers: authHeaders(session),
    body: '{}',
  });
  if (result.data.success) {
    log(`[${site.name}] 签到成功，获得额度 ${result.data.data && result.data.data.quota_awarded}`);
    return;
  }

  const message = result.data.message || result.data.message_key || JSON.stringify(result.data);
  if (/already|已签到|今天已/i.test(message)) {
    log(`[${site.name}] 今日已签到，跳过`);
    return;
  }
  throw new Error(`签到失败: ${message}`);
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('缺少环境变量 CHECKIN_USERNAME / CHECKIN_PASSWORD');
  }

  const failures = [];
  for (const site of SITES) {
    try {
      await processSite(site);
    } catch (err) {
      log(`[${site.name}] 执行失败: ${err.message}`);
      failures.push(site.name);
    }
  }

  if (failures.length) {
    throw new Error(`以下站点执行失败: ${failures.join('、')}`);
  }
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} 执行失败: ${err.message}`);
  process.exit(1);
});
