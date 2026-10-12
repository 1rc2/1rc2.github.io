// Vercel Function：管理后台密码验证
// 部署后在 Vercel 后台 Settings → Environment Variables 设置 ADMIN_PASSWORD
//
// 环境变量：
//   ADMIN_PASSWORD   必填，管理后台登录密码
//   ALLOWED_ORIGIN    可选，允许的前端域名，默认 * （生产建议改为你自己的域名）
//   ADMIN_SESSION_TTL 可选，会话有效期（秒），默认 86400（1天）

const crypto = require("crypto");

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

// 会话 token：base64url(时间戳) + "." + base64url(HMAC-SHA256(时间戳, 密码))
function makeToken(password, ttl) {
  const expireAt = Date.now() + ttl * 1000;
  const payload = String(expireAt);
  const sig = crypto.createHmac("sha256", password).update(payload).digest("base64url");
  return Buffer.from(payload).toString("base64url") + "." + sig;
}

function verifyToken(token, password) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const expireAt = parseInt(Buffer.from(parts[0], "base64url").toString(), 10);
    if (!expireAt || expireAt < Date.now()) return false;
    const expected = crypto
      .createHmac("sha256", password)
      .update(String(expireAt))
      .digest("base64url");
    const a = Buffer.from(parts[1]);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  const allow = process.env.ALLOWED_ORIGIN || "*";
  const password = process.env.ADMIN_PASSWORD;

  // CORS 预检
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", allow);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "仅支持 POST" });
  }

  if (!password) {
    return res.status(500).json({ error: "服务器未配置 ADMIN_PASSWORD 环境变量" });
  }

  const body = req.body || {};
  const action = body.action || "login";

  // 登录：验证密码，返回会话 token
  if (action === "login") {
    if (body.password !== password) {
      return res.status(401).json({ error: "密码错误" });
    }
    const ttl = parseInt(process.env.ADMIN_SESSION_TTL) || 86400;
    const token = makeToken(password, ttl);
    return res.status(200).json({ ok: true, token, expireIn: ttl });
  }

  // 其他操作需要携带有效 token
  const token = body.token;
  if (!token || !verifyToken(token, password)) {
    return res.status(401).json({ error: "未登录或会话已过期" });
  }

  // 校验 token
  if (action === "verify") {
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "未知操作: " + action });
};
