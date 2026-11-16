/* 雅思·六级 PDF 学习器 — 纯前端原型
 * 词表：AWL（EAP Foundation / Coxhead 570 词族）+ 六级（KyleBing, BSD-3）
 * 释义：六级内置中文释义；任意词点击后由 Free Dictionary API 查询
 * 翻译：MyMemory 免费 API（en|zh-CN）
 * 历史：IndexedDB（本机，不上传服务器）
 */
(function () {
  "use strict";

  // ---------- 词表 ----------
  const AWL_SET = new Set((window.APP_DATA && window.APP_DATA.awl) || []);
  const CET6_MAP = (window.APP_DATA && window.APP_DATA.cet6) || {};

  // ---------- PDF.js ----------
  const pdfjsLib = window["pdfjsLib"];
  if (pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dropZone = $("dropZone");
  const fileInput = $("fileInput");
  const studyView = $("studyView");
  const defPanel = $("defPanel");
  const historyList = $("historyList");
  const historyEmpty = $("historyEmpty");
  const btnUpload = $("btnUpload");
  const btnTranslate = $("btnTranslate");
  const statusEl = $("status");
  const translateModal = $("translateModal");
  const translateBody = $("translateBody");
  const closeTranslate = $("closeTranslate");

  const state = { pages: [], fileName: "", blob: null };

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function setStatus(t) { statusEl.textContent = t || ""; }
  function fmtDate(iso) {
    const d = new Date(iso);
    const p = (n) => (n < 10 ? "0" + n : "" + n);
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- 学习数据层（localStorage，供计时器与记录面板共用）----------
  // 数据结构：{ version, dailyMs: {"YYYY-MM-DD": 毫秒}, timer: {status, accumulatedMs, lastStartTs} }
  // status: idle（未开始）/ running（计时中）/ paused（已暂停）
  //   running 时本次会话时长 = accumulatedMs + (Date.now() - lastStartTs)
  //   paused  时本次会话时长 = accumulatedMs
  const StudyStats = (function () {
    const KEY = "ielts_cet_study_v1";
    function blank() {
      return { version: 1, dailyMs: {}, timer: { status: "idle", accumulatedMs: 0, lastStartTs: 0 } };
    }
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return blank();
        const d = JSON.parse(raw);
        if (!d || !d.dailyMs || !d.timer) return blank();
        return d;
      } catch (e) { return blank(); }
    }
    let data = load();
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
    }
    // 北京时间"日期键"（换电脑/换时区也按北京日期归档）
    function bjParts(d) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      }).formatToParts(d);
      const o = {};
      parts.forEach((p) => { o[p.type] = p.value; });
      if (o.hour === "24") o.hour = "00";
      return o;
    }
    function todayKey() {
      const p = bjParts(new Date());
      return `${p.year}-${p.month}-${p.day}`;
    }
    // 本次会话已累计毫秒（running 含实时增量）
    function sessionMs() {
      const t = data.timer;
      if (t.status === "running") return t.accumulatedMs + Math.max(0, Date.now() - t.lastStartTs);
      if (t.status === "paused") return t.accumulatedMs;
      return 0;
    }
    function totalMs() {
      let sum = 0;
      for (const k in data.dailyMs) sum += data.dailyMs[k] || 0;
      return sum + sessionMs();
    }
    function start() {
      if (data.timer.status !== "idle") return;
      data.timer = { status: "running", accumulatedMs: 0, lastStartTs: Date.now() };
      save();
    }
    function pause() {
      if (data.timer.status !== "running") return;
      data.timer.accumulatedMs = sessionMs();
      data.timer.status = "paused";
      save();
    }
    function resume() {
      if (data.timer.status !== "paused") return;
      data.timer.status = "running";
      data.timer.lastStartTs = Date.now();
      save();
    }
    function end() {
      const ms = sessionMs();
      if (ms > 0) {
        const k = todayKey();
        data.dailyMs[k] = (data.dailyMs[k] || 0) + ms;
      }
      data.timer = { status: "idle", accumulatedMs: 0, lastStartTs: 0 };
      save();
    }
    // 供下一批记录面板使用
    function getDailyMs() { return Object.assign({}, data.dailyMs); }
    function getState() { return data.timer.status; }
    return { start, pause, resume, end, sessionMs, totalMs, todayKey, bjParts, getDailyMs, getState };
  })();

  // 词形还原（仅当还原后在词表中才采用，避免误判）
  function stemOf(w) {
    if (AWL_SET.has(w) || CET6_MAP.hasOwnProperty(w)) return w;
    const rules = [
      [/ies$/, (m) => m.slice(0, -3) + "y"],
      [/ches$/, (m) => m.slice(0, -2)],
      [/ses$/, (m) => m.slice(0, -2)],
      [/xes$/, (m) => m.slice(0, -2)],
      [/es$/, (m) => m.slice(0, -2)],
      [/ed$/, (m) => m.slice(0, -2)],
      [/ing$/, (m) => m.slice(0, -3)],
      [/ly$/, (m) => m.slice(0, -2)],
      [/est$/, (m) => m.slice(0, -3)],
      [/er$/, (m) => m.slice(0, -2)],
      [/s$/, (m) => m.slice(0, -1)],
    ];
    for (const [re, fn] of rules) {
      if (re.test(w)) {
        const b = fn(w);
        if (b.length > 1 && (AWL_SET.has(b) || CET6_MAP.hasOwnProperty(b))) return b;
      }
    }
    return w;
  }

  // 判断一个词是否属于词表
  function matchWord(raw) {
    const w = raw.toLowerCase().replace(/[^a-z']/g, "");
    if (!w) return null;
    const base = stemOf(w);
    const cands = base === w ? [w] : [w, base];
    let awl = false, cet6 = false;
    for (const c of cands) {
      if (AWL_SET.has(c)) awl = true;
      if (CET6_MAP.hasOwnProperty(c)) cet6 = true;
    }
    if (!awl && !cet6) return null;
    return { awl, cet6 };
  }

  // 文本 -> 高亮 HTML（每个词都可点击，词表词上色）
  function renderText(text) {
    const re = /([A-Za-z][A-Za-z'’\-]*)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      const raw = m[0];
      const mt = matchWord(raw);
      const cls = mt
        ? "word w-" + (mt.awl && mt.cet6 ? "both" : mt.awl ? "awl" : "cet6")
        : "word";
      const w = raw.toLowerCase().replace(/"/g, "");
      out += `<span class="${cls}" data-word="${w}">${escapeHtml(raw)}</span>`;
      last = m.index + raw.length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }

  // ---------- PDF 解析 ----------
  async function extractPages(buffer) {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const c = await page.getTextContent();
      let t = "";
      for (const it of c.items) {
        t += it.str;
        t += it.hasEOL ? "\n" : " ";
      }
      out.push(t);
    }
    return out;
  }

  // ---------- 视图渲染 ----------
  // 兜底：无 blob / pdf.js 不可用时，退回纯文本重排
  function renderTextFallback() {
    let html = "";
    state.pages.forEach((t, i) => {
      html += `<div class="page-block"><div class="page-head">第 ${i + 1} 页</div><div class="page-text">${renderText(t)}</div></div>`;
    });
    studyView.innerHTML = html;
    studyView.classList.remove("hidden");
  }

  // 在 pdf.js 文本层的 span 内，给每个单词包一层高亮/可点击 span（不改变文本与定位）
  function highlightSpan(span) {
    if (span.querySelector(".word")) return; // 已处理过，避免重复包裹
    const text = span.textContent;
    if (!/[A-Za-z]/.test(text)) return;
    const re = /([A-Za-z][A-Za-z'’\-]*)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += escapeHtml(text.slice(last, m.index));
      const raw = m[0];
      const mt = matchWord(raw);
      const cls = mt
        ? "word w-" + (mt.awl && mt.cet6 ? "both" : mt.awl ? "awl" : "cet6")
        : "word";
      const w = raw.toLowerCase().replace(/"/g, "");
      out += `<span class="${cls}" data-word="${w}">${escapeHtml(raw)}</span>`;
      last = m.index + raw.length;
    }
    out += escapeHtml(text.slice(last));
    span.innerHTML = out;
  }

  // ---------- 官方 PDFViewer（保证文本层与原页精确对齐、选区正常） ----------
  let pdfViewer = null, linkService = null, eventBus = null;
  // 从事件源对象里找到 .textLayer DOM（兼容 TextLayerBuilder / PageView 两种 source）
  function resolveTextLayer(obj) {
    if (!obj || !obj.div) return null;
    const d = obj.div;
    if (d.classList && d.classList.contains("textLayer")) return d;
    return d.querySelector(".textLayer");
  }
  // 每次打开文档都重建一套全新渲染器：pdf.js 3.11 的 PDFViewer.setDocument 不支持对
  // 同一实例二次换文档（AnnotationEditorUIManager.destroy 会抛 null 异常，导致退回纯文本）。
  function ensureViewer() {
    studyView.classList.remove("hidden");
    if (!window.pdfjsViewer || !pdfjsLib) {
      // 降级：pdf_viewer.js 未加载，退回纯文本
      state.fallback = true;
      return;
    }
    // 销毁旧实例（释放上次渲染残留的事件绑定），避免叠加
    pdfViewer = null; linkService = null; eventBus = null;
    try {
      // 官方要求：容器内必须有一个 .pdfViewer 子元素（否则构造函数抛错）
      studyView.innerHTML = '<div class="pdfViewer"></div>';
      eventBus = new pdfjsViewer.EventBus();
      linkService = new pdfjsViewer.PDFLinkService({ eventBus });
      pdfViewer = new pdfjsViewer.PDFViewer({
        container: studyView,
        viewer: studyView.firstElementChild,
        eventBus,
        linkService,
        textLayerMode: 2,        // 构建文本层（对齐+可选中）
      });
      linkService.setViewer(pdfViewer);
      // 文本层渲染完成后，给单词包高亮/可点击 span
      eventBus.on("textlayerrendered", (evt) => {
        const tl = resolveTextLayer(evt.source);
        if (tl) tl.querySelectorAll("span").forEach(highlightSpan);
      });
      eventBus.on("pagerendered", (evt) => {
        const tl = resolveTextLayer(evt.source);
        if (tl) tl.querySelectorAll("span").forEach(highlightSpan);
      });
    } catch (e) {
      state.fallback = true;
      pdfViewer = null;
    }
  }

  // 主视图：用官方 PDFViewer 渲染（canvas + 自动对齐文本层）
  async function renderStudyView() {
    if (!state.pages.length) return;
    studyView.classList.remove("hidden");
    ensureViewer();
    if (state.fallback || !pdfViewer) { renderTextFallback(); return; }
    setStatus("渲染中…");
    try {
      // 换文档前释放旧 PDF 文档，避免 worker 内存累积
      if (state.pdfDoc) {
        try { await state.pdfDoc.destroy(); } catch (e) {}
        state.pdfDoc = null;
      }
      const buf = await state.blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      state.pdfDoc = pdf;
      linkService.setDocument(pdf);
      pdfViewer.setDocument(pdf);
      // 官方自适应：按容器宽度缩放；渲染后滚动条出现会改变可用宽度，需再校准一次
      pdfViewer.currentScaleValue = "page-width";
      requestAnimationFrame(() => {
        pdfViewer.currentScaleValue = "page-width";
      });
      setStatus(`共 ${pdf.numPages} 页 · 原版式高亮`);
    } catch (e) {
      setStatus("渲染失败，已退回纯文本模式");
      renderTextFallback();
    }
  }

  // ---------- 释义 ----------
  function showDefinition(word) {
    switchTab("def");
    const mt = matchWord(word) || {};
    let tags = "";
    if (mt.awl) tags += '<span class="tag tag-awl">AWL</span> ';
    if (mt.cet6) tags += '<span class="tag tag-cet6">六级</span> ';
    const base = stemOf(word.toLowerCase());
    const cn = CET6_MAP[word.toLowerCase()] || CET6_MAP[base] || "";
    let html = `<div class="def-word">${escapeHtml(word)}</div>`;
    html += `<div class="def-tags">${tags || '<span style="color:#6b7280;font-size:12px;">普通词（不在雅思/六级词表中）</span>'}</div>`;
    if (cn) html += `<div class="def-sec"><h4>中文释义（六级词表）</h4><div class="def-cn">${escapeHtml(cn)}</div></div>`;
    html += `<div class="def-sec"><h4>英文释义（Free Dictionary / Wiktionary）</h4><div id="defEn" class="def-loading">查询中…</div></div>`;
    $("defContent").innerHTML = html;
    fetchFreeDict(word, base);
  }

  // 生成词典查询候选词形（不依赖词表，纯形态还原）
  function dictForms(word) {
    const w = word.toLowerCase().replace(/[^a-z']/g, "");
    const forms = new Set([w]);
    const add = (x) => { if (x && x.length > 2) forms.add(x); };
    if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
    if (w.endsWith("ves")) { add(w.slice(0, -3) + "f"); add(w.slice(0, -3) + "fe"); }
    if (w.endsWith("es")) add(w.slice(0, -2));
    if (w.endsWith("s") && !w.endsWith("ss")) add(w.slice(0, -1));
    if (w.endsWith("ed")) { add(w.slice(0, -1)); add(w.slice(0, -2)); }
    if (w.endsWith("ing")) {
      add(w.slice(0, -3));
      add(w.slice(0, -3) + "e");
      const stem = w.slice(0, -3);
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) add(stem.slice(0, -1));
    }
    if (w.endsWith("ly")) add(w.slice(0, -2));
    if (w.endsWith("er")) { add(w.slice(0, -1)); add(w.slice(0, -2)); }
    if (w.endsWith("est")) { add(w.slice(0, -2)); add(w.slice(0, -3)); }
    return [...forms];
  }

  function stripTags(s) { return String(s).replace(/<[^>]*>/g, "").trim(); }

  function renderDictEntries(el, data, usedForm) {
    let lines = "";
    const arr = Array.isArray(data) ? data : [data];
    for (const entry of arr) {
      const ph = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text) && entry.phonetics.find(p => p.text).text) || "";
      if (ph) lines += `<div class="def-line"><span class="pos">${escapeHtml(ph)}</span></div>`;
      for (const m of entry.meanings || []) {
        for (const d of m.definitions || []) {
          lines += `<div class="def-line"><span class="pos">${escapeHtml(m.partOfSpeech || "")}</span>${escapeHtml(d.definition)}`;
          if (d.example) lines += `<span class="ex">eg. ${escapeHtml(d.example)}</span>`;
          lines += "</div>";
        }
      }
    }
    if (usedForm && usedForm !== el.dataset.orig) {
      lines += `<div class="def-note">（查询词形：${escapeHtml(usedForm)}）</div>`;
    }
    el.className = "";
    el.innerHTML = lines || "（无释义）";
  }

  async function fetchFreeDict(word) {
    const el = $("defEn");
    if (!el) return;
    el.dataset.orig = word.toLowerCase();
    const forms = dictForms(word);
    let networkError = false;

    // 主力：Free Dictionary API（逐个尝试还原后的词形；网络错误重试一次）
    for (const f of forms) {
      let data = null, got = false;
      for (let attempt = 0; attempt < 2 && !got; attempt++) {
        try {
          const r = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(f));
          if (r.ok) { data = await r.json(); got = true; }
          else break; // 404/限流等 → 换下一个词形
        } catch (err) {
          if (attempt === 0) await new Promise(res => setTimeout(res, 500));
          else networkError = true;
        }
      }
      if (got && Array.isArray(data) && data.length) { renderDictEntries(el, data, f); return; }
    }

    // 兜底：Datamuse（WordNet 英文释义，CORS 友好；Wiktionary 在国内网络不可达故弃用）
    try {
      for (const f of forms) {
        const r = await fetch("https://api.datamuse.com/words?sp=" + encodeURIComponent(f) + "&md=d&max=1");
        if (!r.ok) continue;
        const d = await r.json();
        const defs = d && d[0] && d[0].defs;
        if (defs && defs.length) {
          let lines = "";
          for (const raw of defs.slice(0, 8)) {
            const idx = raw.indexOf("\t");
            const pos = idx > 0 ? raw.slice(0, idx) : "";
            const txt = stripTags(idx > 0 ? raw.slice(idx + 1) : raw);
            if (!txt) continue;
            lines += `<div class="def-line"><span class="pos">${escapeHtml(pos)}</span>${escapeHtml(txt)}</div>`;
          }
          if (lines) {
            el.className = "";
            el.innerHTML = lines + `<div class="def-note">（来源：WordNet via Datamuse${f !== el.dataset.orig ? "，查询词形：" + escapeHtml(f) : ""}）</div>`;
            return;
          }
        }
      }
    } catch (err) { networkError = true; }

    el.className = "def-err";
    el.textContent = networkError
      ? "网络查询失败（检查网络后重试）。中文释义（如有）已在上方显示。"
      : "在线词库未收录该词形（已尝试 " + forms.length + " 种词形）。中文释义（如有）已在上方显示。";
  }

  // ---------- 全文翻译 ----------
  // MyMemory 单次请求上限 500 字符；按句子边界切分后打包到 maxLen 以内
  function splitChunks(text, maxLen) {
    const sentences = [];
    for (const para of text.split(/\n+/)) {
      const p = para.trim();
      if (!p) continue;
      const parts = p.match(/[^.!?]+[.!?]*/g) || [p];
      for (const s of parts) { const t = s.trim(); if (t) sentences.push(t); }
    }
    const chunks = [];
    let cur = "";
    for (const s of sentences) {
      if (s.length > maxLen) {
        // 单句超长（如无标点长行），硬切兜底
        if (cur) { chunks.push(cur); cur = ""; }
        for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen));
        continue;
      }
      const merged = cur ? cur + " " + s : s;
      if (merged.length > maxLen) { chunks.push(cur); cur = s; }
      else cur = merged;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }
  async function translateChunk(text) {
    const q = encodeURIComponent(text);
    const r = await fetch("https://api.mymemory.translated.net/get?q=" + q + "&langpair=en|zh-CN");
    const data = await r.json();
    const t = data && data.responseData && data.responseData.translatedText;
    if (t && !/QUERY LENGTH LIMIT|MYMEMORY WARNING|QUOTA|INVALID/i.test(t)) return t;
    throw new Error((data && data.responseDetails) || t || "翻译服务返回异常");
  }
  async function translateAll() {
    if (!state.pages.length) return;
    const full = state.pages.join("\n\n");
    translateModal.classList.remove("hidden");
    const chunks = splitChunks(full, 450);
    let out = "";
    try {
      for (let i = 0; i < chunks.length; i++) {
        translateBody.innerHTML = `<div class="def-loading">翻译中… (${i + 1}/${chunks.length})</div>`;
        out += (await translateChunk(chunks[i])) + "\n\n";
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300)); // 请求间隔，避免被限流
      }
      translateBody.textContent = out.trim();
    } catch (e) {
      const msg = String(e.message || e);
      const friendly = /TODAY|QUOTA|LIMIT/i.test(msg)
        ? "免费翻译接口额度已用尽（MyMemory 匿名用户每日限额）。可明天再试，或换更短的文档。"
        : "翻译失败：" + msg;
      translateBody.innerHTML = `<div class="def-err">${escapeHtml(friendly)}</div>` +
        (out.trim() ? `<div style="white-space:pre-wrap;margin-top:12px">${escapeHtml(out.trim())}</div>` : "");
    }
  }

  // ---------- IndexedDB 历史 ----------
  const DB = "ielts_cet_db", STORE = "docs";
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveDoc(doc) {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(doc);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function getAllDocs() {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function delDoc(id) {
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  }
  async function renderHistory() {
    const docs = await getAllDocs();
    docs.sort((a, b) => b.date.localeCompare(a.date));
    historyList.innerHTML = "";
    historyEmpty.style.display = docs.length ? "none" : "block";
    for (const d of docs) {
      const li = document.createElement("li");
      li.className = "history-item";
      li.innerHTML =
        `<div class="h-name">${escapeHtml(d.name)}</div>` +
        `<div class="h-meta"><span>${fmtDate(d.date)} · ${fmtSize(d.size || 0)}</span>` +
        `<span class="h-del" data-del="${d.id}">删除</span></div>`;
      li.addEventListener("click", (e) => {
        if (e.target.dataset.del) {
          e.stopPropagation();
          delDoc(e.target.dataset.del).then(renderHistory);
          return;
        }
        openDoc(d);
      });
      historyList.appendChild(li);
    }
  }
  function openDoc(d) {
    state.pages = d.pages || [];
    state.fileName = d.name;
    state.blob = d.blob;
    dropZone.classList.add("hidden");
    btnTranslate.disabled = !state.pages.length;
    setStatus("共 " + state.pages.length + " 页");
    renderStudyView();
  }

  // ---------- 文件处理 ----------
  async function handleFile(file) {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      alert("请上传 PDF 文件");
      return;
    }
    setStatus("解析中…");
    dropZone.classList.add("hidden");
    try {
      const buf = await file.arrayBuffer();
      const pages = await extractPages(buf);
      state.pages = pages;
      state.fileName = file.name;
      state.blob = file;
      btnTranslate.disabled = false;
      renderStudyView();
      setStatus("共 " + pages.length + " 页");
      await saveDoc({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
        name: file.name, size: file.size, date: new Date().toISOString(),
        blob: file, pages,
      });
      renderHistory();
    } catch (e) {
      setStatus("解析失败");
      alert("PDF 解析失败：" + (e.message || e));
    }
  }

  // ---------- 选中即译 / 语法解析（悬浮工具栏） ----------
  const selToolbar = document.createElement("div");
  selToolbar.id = "selToolbar";
  selToolbar.className = "sel-toolbar hidden";
  selToolbar.innerHTML =
    '<button type="button" id="selTranslateBtn" class="sel-act">翻译</button>' +
    '<button type="button" id="selGrammarBtn" class="sel-act sel-grammar">语法</button>';
  document.body.appendChild(selToolbar);
  const selBtn = selToolbar.querySelector("#selTranslateBtn");
  const selGrammarBtn = selToolbar.querySelector("#selGrammarBtn");

  const transContent = $("transContent");
  const gramContent = $("gramContent");

  let selText = "";
  let selRect = null;

  // 右侧面板标签页切换（释义 / 翻译 / 语法）
  function switchTab(name) {
    document.querySelectorAll(".ptab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".ptab-body").forEach(p => p.classList.toggle("active", p.id === name + "Content"));
  }
  document.querySelectorAll(".ptab").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });

  function showTranslation(text, content, kind) {
    switchTab("trans");
    if (kind === "loading") transContent.innerHTML = `<div class="res-loading">${escapeHtml(content)}</div>`;
    else if (kind === "err") transContent.innerHTML = `<div class="res-err">${escapeHtml(content)}</div>`;
    else transContent.innerHTML = `<div class="res-src">“${escapeHtml(text)}”</div><div class="res-body">${escapeHtml(content)}</div>`;
  }
  function showGrammarResult(text, html, kind) {
    switchTab("gram");
    gramContent.innerHTML = kind === "loading"
      ? `<div class="res-loading">${escapeHtml(html)}</div>`
      : kind === "err" ? `<div class="res-err">${escapeHtml(html)}</div>` : html;
  }

  function getSelectionWithin(root) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    return { text, rect: range.getBoundingClientRect() };
  }

  studyView.addEventListener("mouseup", () => {
    const res = getSelectionWithin(studyView);
    if (!res) { selToolbar.classList.add("hidden"); return; }
    selText = res.text;
    selRect = res.rect;
    const tw = selToolbar.offsetWidth || 150;
    let top = res.rect.top - 6;
    if (res.rect.top < 42) top = res.rect.bottom + 6; // 贴近顶部时放到选区下方
    let left = res.rect.left + res.rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    selToolbar.style.top = top + "px";
    selToolbar.style.left = left + "px";
    selToolbar.classList.remove("hidden");
  });

  selBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = selText, rect = selRect;
    selToolbar.classList.add("hidden");
    if (!text || !rect) return;
    showTranslation(text, "翻译中…", "loading");
    try {
      const chunks = splitChunks(text, 450);
      let out = "";
      for (let i = 0; i < chunks.length; i++) {
        out += (await translateChunk(chunks[i])) + (i < chunks.length - 1 ? " " : "");
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
      }
      showTranslation(text, out.trim(), "ok");
    } catch (err) {
      const msg = String(err.message || err);
      const friendly = /TODAY|QUOTA|LIMIT/i.test(msg)
        ? "免费翻译接口额度已用尽（MyMemory 匿名用户每日限额），请明天再试或换更短内容。"
        : "翻译失败：" + msg;
      showTranslation(text, friendly, "err");
    }
  });

  // 语法解析：已配置 Key → 调 LLM 做 AI 讲解；否则退回免费规则引擎 LanguageTool
  selGrammarBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = selText, rect = selRect;
    selToolbar.classList.add("hidden");
    if (!text || !rect) return;
    const cfg = loadCfg();
    if (cfg && cfg.key && cfg.base && cfg.model) {
      showGrammarResult(text, "AI 语法讲解中…", "loading");
      try {
        const content = await explainGrammarAI(text);
        showGrammarResult(text, renderAiGrammar(content, text), "ok");
      } catch (err) {
        const msg = String(err.message || err);
        const friendly = /Failed to fetch|CORS|NetworkError|Load failed/i.test(msg)
          ? "调用 AI 失败：可能是该服务商的浏览器跨域（CORS）限制，或 Key 无效。可换 Gemini / OpenRouter，或用回免费规则检查。"
          : "AI 讲解失败：" + msg;
        showGrammarResult(text, friendly, "err");
      }
    } else {
      showGrammarResult(text, "语法分析中…", "loading");
      try {
        const matches = await checkGrammar(text);
        showGrammarResult(text, renderGrammar(matches, text), "ok");
      } catch (err) {
        showGrammarResult(text, "语法分析失败：" + String(err.message || err), "err");
      }
    }
  });

  async function checkGrammar(text) {
    const body = new URLSearchParams({ text, language: "en-US", enabledOnly: "false" });
    const r = await fetch("https://api.languagetool.org/v2/check", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    return data.matches || [];
  }

  function renderGrammar(matches, text) {
    if (!matches.length) {
      return '<div class="grammar-ok">✅ 未发现语法或拼写错误。' +
        '<div class="grammar-sub">基于规则引擎 LanguageTool（免费、无需 Key）。它只检测错误、不做结构讲解；若想要逐句 AI 讲解时态/从句/成分，可后续接入带 Key 的模型。</div></div>';
    }
    let html = '<div class="grammar-head">共发现 ' + matches.length + ' 处可优化点</div>';
    for (const m of matches) {
      const bad = (text || "").slice(m.offset, m.offset + m.length);
      const sug = (m.replacements || []).map(r => r.value).slice(0, 3).join(" / ");
      const type = (m.rule && m.rule.category && m.rule.category.name) || "";
      html += '<div class="grammar-item">';
      html += '<div class="grammar-bad">⚠ ' + escapeHtml(bad) + '</div>';
      html += '<div class="grammar-msg">' + escapeHtml(m.message) + '</div>';
      if (sug) html += '<div class="grammar-sug">建议改为：' + escapeHtml(sug) + '</div>';
      if (type) html += '<div class="grammar-type">类型：' + escapeHtml(type) + '</div>';
      html += '</div>';
    }
    return html;
  }

  // ---------- AI 语法讲解（OpenAI 兼容接口，Key 存 localStorage） ----------
  function loadCfg() {
    try {
      const cfg = JSON.parse(localStorage.getItem("ielts_cet_llm_cfg") || "null");
      if (cfg && STALE_MODELS[cfg.model]) { cfg.model = STALE_MODELS[cfg.model]; localStorage.setItem("ielts_cet_llm_cfg", JSON.stringify(cfg)); }
      return cfg;
    }
    catch (e) { return null; }
  }
  function saveCfg(c) { localStorage.setItem("ielts_cet_llm_cfg", JSON.stringify(c)); }
  function clearCfg() { localStorage.removeItem("ielts_cet_llm_cfg"); }

  async function explainGrammarAI(text) {
    const cfg = loadCfg();
    if (!cfg || !cfg.key || !cfg.base || !cfg.model) throw new Error("未配置 API");
    const sys = "你是严谨的英语语法老师，用简明中文讲解语法。针对给定英文句子，分析：时态与语态、句子成分（主谓宾/主系表）、从句类型（定语/状语/名词性）、非谓语动词、固定搭配与重点词汇。请分条列出、用例子说明，必要时对比常见错误。控制在 300 字以内，避免冗余。直接输出讲解正文，不要输出任何思考过程、草稿、格式检查或 meta 说明（如 Refining/Checking 之类）。";
    const user = "请解析这句话的语法结构：\n\"" + text + "\"";
    const body = JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.3, max_tokens: 3000,
      reasoning_effort: "low", // 思考型模型（Gemini 3.x 等）少花 token 在内部思考，避免正文被截断
    });
    let data = null, lastStatus = 0, lastDetail = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      try {
        r = await fetch(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
          body,
        });
      } catch (e) {
        throw new Error("请求失败（可能是网络或跨域限制）：" + String(e.message || e));
      }
      lastStatus = r.status;
      if (r.ok) { data = await r.json(); break; }
      let detail = "";
      try { const ej = await r.json(); detail = (ej.error && (ej.error.message || ej.error.status)) || ej.message || ""; } catch (e) {}
      lastDetail = detail;
      // 404/401/400 属确定性错误：不重试；502/503/429 为瞬时错误：等 2s 重试
      if (r.status !== 502 && r.status !== 503 && r.status !== 429) {
        if (r.status === 404) detail = "模型名不存在或已下线（" + cfg.model + "）。请到「⚙ 设置」换一个当前可用的模型名，如 gemini-3.5-flash、gemini-3.1-flash-lite。" + (detail ? "（接口返回：" + detail + "）" : "");
        throw new Error("HTTP " + r.status + (detail ? "：" + detail : ""));
      }
      if (attempt < 2) await new Promise(res => setTimeout(res, 2000));
    }
    if (!data) throw new Error("HTTP " + lastStatus + "：服务暂时过载或限流，已重试仍失败。请稍等几秒再点一次。" + (lastDetail ? "（接口返回：" + lastDetail + "）" : ""));
    const msg = data.choices && data.choices[0] && data.choices[0].message || {};
    let content = msg.content || "";
    // 有些思考型模型把正文放进 reasoning_content、content 为空
    if (!content.trim() && msg.reasoning_content) content = msg.reasoning_content;
    // 清掉漏出的思考/规划痕迹与未闭合的 markdown 残渣
    content = content
      .replace(/^\s*\d+\.\s*(Refining|Formatting|Checking|Draft|Final|Output|Review)\b[^\n]*$/gim, "")
      .replace(/^\s*\d+\.\s*\*{1,2}\s*$/gm, "")
      .replace(/^\s*\*{1,2}\s*$/gm, "")
      .trim();
    if (!content.trim()) throw new Error("模型返回为空（可能被截断），请重试一次");
    return content;
  }

  // 轻量 markdown：转义 + 加粗 + 标题 + 列表符号 + 换行
  function mdLite(s) {
    let t = escapeHtml(s || "");
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/^#{1,3}\s+(.+)$/gm, "<strong>$1</strong>");
    t = t.replace(/^\s*[-*]\s+/gm, "• ");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  function renderAiGrammar(content, text) {
    return '<div class="grammar-ai">' +
      '<div class="grammar-head">AI 语法讲解</div>' +
      '<div class="grammar-ai-src">“' + escapeHtml(text.slice(0, 180)) + '”</div>' +
      '<div class="grammar-ai-body">' + mdLite(content) + "</div>" +
      '<div class="grammar-ai-note">由 AI 生成，仅供学习参考；未配置 Key 时此按钮走免费规则引擎 LanguageTool。</div>' +
      "</div>";
  }

  // 点击别处 / 滚动时收起悬浮工具栏（结果已在右侧面板，无需收浮层）
  document.addEventListener("mousedown", (e) => {
    if (selToolbar.contains(e.target)) return;
    selToolbar.classList.add("hidden");
  });
  studyView.addEventListener("scroll", () => {
    selToolbar.classList.add("hidden");
  });

  // ---------- 顶部：北京时间 + 学习计时器 UI ----------
  const clockDateEl = $("clockDate"), clockTimeEl = $("clockTime");
  const timerValueEl = $("timerValue"), timerBox = document.querySelector(".timer-box");
  const btnTimerMain = $("btnTimerMain"), btnTimerEnd = $("btnTimerEnd");
  const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  function bjClockText() {
    const p = StudyStats.bjParts(new Date());
    // 用 UTC 正午计算星期，避免受本机时区影响（北京时间当天的星期始终正确）
    const weekday = WEEK[new Date(Date.UTC(+p.year, +p.month - 1, +p.day, 12)).getUTCDay()];
    return {
      date: `${p.year}年${p.month}月${p.day}日 ${weekday}`,
      time: `${p.hour}:${p.minute}:${p.second}`,
    };
  }
  function fmtDuration(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const p2 = (n) => (n < 10 ? "0" + n : "" + n);
    return `${p2(h)}:${p2(m)}:${p2(s)}`;
  }
  function renderTimerUI() {
    const st = StudyStats.getState();
    timerValueEl.textContent = fmtDuration(StudyStats.totalMs());
    timerBox.classList.toggle("running", st === "running");
    if (st === "idle") {
      btnTimerMain.textContent = "▶ 开始";
      btnTimerEnd.classList.add("hidden");
    } else if (st === "running") {
      btnTimerMain.textContent = "⏸ 暂停";
      btnTimerEnd.classList.remove("hidden");
    } else {
      btnTimerMain.textContent = "▶ 继续";
      btnTimerEnd.classList.remove("hidden");
    }
  }
  function tickTopbar() {
    const c = bjClockText();
    clockDateEl.textContent = c.date;
    clockTimeEl.textContent = c.time;
    renderTimerUI(); // 每秒刷新显示（running 时时长实时走动）
  }
  btnTimerMain.addEventListener("click", () => {
    const st = StudyStats.getState();
    if (st === "idle") StudyStats.start();
    else if (st === "running") StudyStats.pause();
    else if (st === "paused") StudyStats.resume();
    renderTimerUI();
  });
  btnTimerEnd.addEventListener("click", () => {
    StudyStats.end();
    renderTimerUI();
    setStatus("本次学习时长已记录");
  });
  // 页面重新可见时立即校准（避免后台节流导致显示滞后）
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tickTopbar(); });

  // ---------- 事件绑定 ----------
  btnUpload.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault(); dropZone.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  btnTranslate.addEventListener("click", translateAll);
  closeTranslate.addEventListener("click", () => translateModal.classList.add("hidden"));
  studyView.addEventListener("click", (e) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 有选区时不触发单词释义
    const el = e.target.closest(".word");
    if (el) showDefinition(el.dataset.word);
  });

  // ---------- 设置面板（AI 语法讲解 Key 配置） ----------
  const LLM_PRESETS = {
    gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash" },
    groq: { base: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
    openrouter: { base: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-120b:free" },
    custom: { base: "", model: "" },
  };
  // 已下线的旧模型名 -> 自动迁移到新模型（gemini-2.0 于 2026-06-01、Groq llama3.3 于 2026-08-16 退役）
  const STALE_MODELS = {
    "gemini-2.0-flash": "gemini-3.5-flash",
    "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
    "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
    "meta-llama/llama-3.1-8b-instruct:free": "openai/gpt-oss-120b:free",
  };
  loadCfg(); // 启动时即触发旧模型名自动迁移（须在 STALE_MODELS 声明之后）
  const btnSettings = $("btnSettings");
  const settingsModal = $("settingsModal");
  const closeSettings = $("closeSettings");
  const setProvider = $("setProvider");
  const setBase = $("setBase");
  const setKey = $("setKey");
  const setModel = $("setModel");
  const setSave = $("setSave");
  const setClear = $("setClear");

  function fillPreset(p) {
    const pre = LLM_PRESETS[p] || LLM_PRESETS.custom;
    setBase.value = pre.base;
    setModel.value = pre.model;
  }
  setProvider.addEventListener("change", () => fillPreset(setProvider.value));

  btnSettings.addEventListener("click", () => {
    const cfg = loadCfg() || {};
    let p = "custom";
    for (const k in LLM_PRESETS) {
      if (LLM_PRESETS[k].base && cfg.base === LLM_PRESETS[k].base) { p = k; break; }
    }
    setProvider.value = p;
    setBase.value = cfg.base || LLM_PRESETS[p].base || "";
    setModel.value = cfg.model || LLM_PRESETS[p].model || "";
    setKey.value = cfg.key || "";
    settingsModal.classList.remove("hidden");
  });
  closeSettings.addEventListener("click", () => settingsModal.classList.add("hidden"));
  settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) settingsModal.classList.add("hidden"); });
  setSave.addEventListener("click", () => {
    const base = setBase.value.trim();
    const key = setKey.value.trim();
    const model = setModel.value.trim();
    if (!base || !key || !model) { alert("请填写 API 地址、Key 和模型名（选了预设会自动填入后两项）"); return; }
    saveCfg({ base, key, model });
    settingsModal.classList.add("hidden");
    setStatus("AI 语法讲解已配置（仅本机）");
  });
  setClear.addEventListener("click", () => {
    clearCfg();
    settingsModal.classList.add("hidden");
    setStatus("已清除 Key，语法按钮改用免费规则引擎");
  });

  // ---------- 启动 ----------
  window.addEventListener("DOMContentLoaded", () => {
    if (!pdfjsLib) { setStatus("PDF.js 加载失败，请检查网络"); }
    renderHistory();
    tickTopbar();                 // 立即显示一次，不等 1 秒
    setInterval(tickTopbar, 1000); // 北京时间每秒刷新
  });
})();
