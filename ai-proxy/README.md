# AI 代理服务

Vercel Edge Function，代理 DeepSeek API，让前端调用时不暴露 API key。

## 部署步骤

### 1. 把这个仓库推到 GitHub
```bash
cd ai-proxy
git init && git add . && git commit -m "AI proxy"
git branch -M main
git remote add origin https://github.com/你的用户名/ai-proxy.git
git push -u origin main
```

或者直接在 GitHub 网页新建仓库 `ai-proxy`，把 `api/chat.js` 和 `vercel.json` 上传过去。

### 2. 在 Vercel 导入
- 打开 https://vercel.com → 用 GitHub 账号登录
- 点 `Add New` → `Project` → 选刚才的 `ai-proxy` 仓库
- 一路 `Continue`，点 `Deploy`（不需要改任何配置）

### 3. 设置环境变量
- 部署完成后进入项目 → `Settings` → `Environment Variables`
- 新增一条：
  - Key: `DEEPSEEK_API_KEY`
  - Value: 你的 DeepSeek key（`sk-xxx`，从 https://platform.deepseek.com 获取）
- 保存后点 `Redeploy` 让变量生效

### 4. 拿到代理 URL
- 项目首页顶部能看到部署域名，形如 `https://ai-proxy-xxx.vercel.app`
- 完整接口地址：`https://ai-proxy-xxx.vercel.app/api/chat`

### 5. 回填到 index.html
在主页仓库的 `CONFIG.ai` 中填入 `proxyUrl`：
```js
ai: {
  proxyUrl: "https://ai-proxy-xxx.vercel.app/api/chat",  // ← 填这里
  apiKey: "",   // 留空，前端不再需要 key
  ...
}
```
提交推送，1rc2.github.io 上即可使用，key 不再暴露。

## 可选：限制来源域名
在 Vercel 环境变量加 `ALLOWED_ORIGIN = https://1rc2.github.io`，只允许你的站点调用。

---

# 管理后台密码验证

`api/admin.js` 提供管理后台登录验证，密码保存在 Vercel 环境变量中，前端不暴露。

## 部署

与 `api/chat.js` 同一个 Vercel 项目，无需额外部署。

## 环境变量

在 Vercel 项目 → Settings → Environment Variables 中添加：

| Key | 必填 | 说明 |
|-----|------|------|
| `ADMIN_PASSWORD` | 是 | 管理后台登录密码 |
| `ALLOWED_ORIGIN` | 否 | 允许的前端域名，默认 `*` |
| `ADMIN_SESSION_TTL` | 否 | 会话有效期（秒），默认 86400（1天） |

保存后点 `Redeploy` 生效。

## 接口

- `POST /api/admin`，body: `{ "action": "login", "password": "xxx" }`
  - 成功：`{ "ok": true, "token": "...", "expireIn": 86400 }`
  - 失败：`{ "error": "密码错误" }`（401）
- `POST /api/admin`，body: `{ "action": "verify", "token": "..." }`
  - 有效：`{ "ok": true }`
  - 无效：`{ "error": "未登录或会话已过期" }`（401）

会话 token 用 `ADMIN_PASSWORD` 做 HMAC-SHA256 签名，含过期时间，服务端无状态。

---

# 音频跨域代理

`api/audio.js` 用于解决「浏览器直接读取第三方音频被 CORS 拦截」的问题。听力训练页需要拿到音频字节做本地 Whisper 转写，这一步必须同源或允许跨域，因此用服务端转发。

## 接口

- `GET /api/audio?url=<encodeURIComponent(音频地址)>`
  - 成功：返回音频二进制流（带 `Content-Type` 与 CORS 头）
  - 失败：`{ "error": "..." }`

## 环境变量

| Key | 必填 | 说明 |
|-----|------|------|
| `ALLOWED_ORIGIN` | 否 | 允许的前端域名，默认 `*` |
| `MAX_AUDIO_MB` | 否 | 单个音频上限（MB），默认 60 |

## 前端怎么填

在听力训练页 → 第 1 步 → 在线链接 → 「高级：自定义 CORS 代理」填入：

```
https://你的项目.vercel.app/api/audio?url=
```

页面检测到没有 `{url}` 占位符时，会把音频地址 URL 编码后自动拼接在末尾。

