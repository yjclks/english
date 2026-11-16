# 部署指南（让学习器可在任意电脑 / 分享链接打开）

本学习器是**纯前端静态站点**：所有 PDF 解析、词表高亮、释义、翻译都在浏览器本地完成，
PDF 不上传服务器（存于本机浏览器 IndexedDB）。因此可以部署到任意静态托管服务，
部署后换电脑、用手机、发给朋友都能直接打开同一个网址使用。

> 当前本地预览是用 `python -m http.server` 起的 `http://localhost:8123`，
> 这个地址**只有你这台电脑能访问**，所以才需要下面的部署步骤。

---

## 一、前提与已知限制（先读）

1. **历史记录按“浏览器 + 设备”隔离**
   IndexedDB 数据只存在上传时的那台设备的那个浏览器里。换设备 / 换浏览器后，
   历史列表为空——这是正常的，**重新上传一次 PDF 即可**（PDF 从不离开你的设备）。
2. **需要联网**
   - pdf.js（渲染引擎）从 cdnjs CDN 加载；
   - 释义（Free Dictionary / Datamuse）、翻译（MyMemory）、语法规则引擎（LanguageTool）、
     AI 语法讲解（你自己的 Key 对应服务商）均走浏览器直连的公开 API。
   断网时只能看到上传入口，正文无法渲染。
3. **子路径安全**：站点内所有资源（样式、脚本、`data/data.js`）都用**相对路径**，
   因此既能在 `用户名.github.io`（根路径）也能在 `用户名.github.io/仓库名/`（子路径）下正常加载。

---

## 二、方案 A：GitHub Pages（需 GitHub 账号，免费，无需服务器）

适合：想拿到一个 `https://用户名.github.io/仓库名/` 的公网链接，随时用任意设备打开。

### 0. 注册 GitHub 账户（没有账号时）
1. 打开 https://github.com/signup
2. 填写邮箱、密码、**用户名**（用户名会出现在你的网址里，如 `zhangsan.github.io`，建议用英文/拼音）
3. 完成验证 → **Create account**
4. 去注册邮箱点验证链接激活账户
5. 选免费计划（Free）即可，**无需绑定信用卡**

### 1. 新建仓库
- 登录后点右上角 **+ → New repository**
- 仓库名随意（如 `ielts-cet`），**可见性选 Public**（免费账户只有 Public 能开 Pages）
- **不要**勾选 “Add a README / .gitignore / license”（我们本地已有文件）
- 点 **Create repository**

### 2. 把本目录推送到 GitHub
```bash
# 在 ielts-cet-site 目录内（已 git init 并提交了全部版本）
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

> **push 时需要认证**：GitHub 已不允许用账户密码推送，需用以下任一方式：
> - **图形界面（最省事，推荐新手）**：安装 [GitHub Desktop](https://desktop.github.com/) → 登录 →
>   File → Add Local Repository → 选中 `ielts-cet-site` 文件夹 → 点 **Publish repository**，
>   按提示选 Public 即可，全程不用管 token。
> - **命令行 + Token**：GitHub 头像 → Settings → Developer settings → Personal access tokens →
>   Tokens (classic) → Generate new token → 勾选 `repo` 权限 → 生成后复制那串 token；
>   在 `git push` 提示输入密码时**粘贴 token**（不是账户密码）。
>   Mac 上可先执行一次 `git config --global credential.helper osxkeychain`，让系统记住凭据。

### 3. 开启 Pages
- 进入仓库 → **Settings → Pages**（左侧栏）
- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，目录选 `/ (root)`
- 保存后等待约 1 分钟，访问 `https://用户名.github.io/仓库名/` 即可。

### 4. 关于私有仓库
GitHub 免费版对**私有仓库**开启 Pages 需要付费计划。若希望免费且不怕公开，
把仓库设为 **Public** 即可。介意公开的同学可用方案 B（Netlify / Vercel 支持私有仓库免费托管）。

---

## 三、方案 B：Netlify / Vercel（备选，支持私有、拖拽即传）

1. 打开 https://app.netlify.com 或 https://vercel.com ，注册/登录。
2. 直接把 `ielts-cet-site` 文件夹**拖到 Netlify 的 “Deploy manually”** 区域，
   或连接 GitHub 仓库后导入。
3. 自动分配一个 `xxx.netlify.app` / `xxx.vercel.app` 公网地址，立即可用。
4. 之后代码更新时重新拖拽 / 重新推送即可。

这两种对私有仓库免费、无需配置构建命令（纯静态，构建命令留空、发布目录填 `.` 或 `ielts-cet-site`）。
注册用邮箱或微信/Google 等第三方登录即可，**不需要 GitHub 账号**。

---

## 三-B、方案 B2：Surge.sh（无需 GitHub，仅需邮箱，一条命令）

最适合「没有 GitHub、又想要公网链接」的场景：注册只需填邮箱+密码（无需验证、无需信用卡），
安装一个命令行工具后一条 `surge` 命令即可拿到 `xxx.surge.sh` 公网地址。

```bash
# 1. 安装 surge（需要 Node 环境，本机已具备）
npm install -g surge

# 2. 进入站点目录并发布（首次会提示输入邮箱/密码，自动创建账号）
cd /Users/ssqin/WorkBuddy/外语能力提升/ielts-cet-site
surge
```
- 执行后按提示填邮箱、设密码（即注册），然后选择要发布的目录（默认就是当前目录），
  回车确认，就会分配一个 `随机名.surge.sh` 的链接，立即可用。
- 之后更新代码：重新在该目录执行 `surge` 即可覆盖发布。
- 注意：surge 免费档适合个人/非商业用途，链接是公开的（任何拿到链接的人都能打开使用，但看不到彼此数据）。

---

## 四、方案 C：不部署，仅换电脑自带（零依赖）

如果只想在**自己的另一台电脑**上用，不分享给别人：
1. 把整个 `ielts-cet-site` 文件夹拷贝到那台电脑（U 盘 / 网盘 / 邮件附件都行）。
2. 在那台电脑上起一个静态服务：
   ```bash
   cd ielts-cet-site
   python3 -m http.server 8123
   ```
3. 浏览器打开 `http://localhost:8123/` 即可（必须走 http，不能直接双击 index.html，
   否则浏览器会因 file:// 协议限制而加载不了 pdf.js / 跨域 API）。

> 注意：移动端（手机）没有 `python3` 也不方便起服务，所以手机上访问请用方案 A / B / B2 的公网链接。

---

## 五、更新部署

代码改动后（例如改了 `app.js` / `styles.css`），重新推送即可：
```bash
git add -A
git commit -m "更新说明"
git push
```
GitHub Pages 会在 push 后自动重新发布（通常几十秒到 1 分钟）。
浏览器端若没看到更新，强制刷新（Mac `Cmd+Shift+R` / Win `Ctrl+F5`）清掉缓存。
