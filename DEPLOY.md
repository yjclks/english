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

## 二、方案 A：GitHub Pages（推荐，免费，无需服务器）

适合：想拿到一个 `https://用户名.github.io/仓库名/` 的公网链接，随时用任意设备打开。

### 1. 把本目录推送到 GitHub
```bash
# 在 ielts-cet-site 目录内（已 git init 并提交了初始版本）
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```
> 若还没建仓库：去 github.com → New repository → 仓库名随意（如 `ielts-cet`）→ 不要勾选
> “Add a README”（我们已有文件）→ Create repository，然后执行上面三条命令。

### 2. 开启 Pages
- 进入仓库 → **Settings → Pages**（左侧栏）
- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，目录选 `/ (root)`
- 保存后等待约 1 分钟，访问 `https://用户名.github.io/仓库名/` 即可。

### 3. 关于私有仓库
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

> 注意：移动端（手机）没有 `python3` 也不方便起服务，所以手机上访问请用方案 A/B 的公网链接。

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
