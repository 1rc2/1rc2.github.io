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
