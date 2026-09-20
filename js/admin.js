/* =====================================================
   管理面板：密码进入，直接在网页里编辑网站内容
   -----------------------------------------------------
   工作原理：浏览器调用 GitHub API 把修改提交到仓库，
   GitHub Pages 会在约 1 分钟后自动发布新内容。
   GitHub 令牌只保存在你自己浏览器的 localStorage 里，
   不会写进网站文件，也不会发给我或其他任何人。
   ===================================================== */
(() => {
  "use strict";
  if (!window.fetch || !window.crypto || !window.TextDecoder || !window.FileReader) return;

  /* ---------- 配置：改成你自己的仓库即可 ---------- */
  const CONFIG = { owner: "Hey-Alan", repo: "personal-website" };
  const API = "https://api.github.com";
  const LS_TOKEN = "site_admin_token";     // GitHub 令牌存这里
  const SS_AUTH = "site_admin_authed";     // 本次会话已通过密码验证

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const today = () => new Date().toISOString().slice(0, 10);
  const newId = () => "x" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const apiPath = (p) => "/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + p.split("/").map(encodeURIComponent).join("/");

  /* ---------- 小工具 ---------- */
  let toastTimer = null;
  function toast(msg, ms) {
    let el = $("#adm-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "adm-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms || 4000);
  }
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const utf8ToB64 = (str) => btoa(unescape(encodeURIComponent(str)));
  const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("读取文件失败"));
      r.readAsDataURL(file);
    });
  }
  /* 读 txt：先按 utf-8 读，出现乱码字符就自动换 gbk 再读一次 */
  function readTextSmart(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        if (/\uFFFD/.test(r.result)) {
          const r2 = new FileReader();
          r2.onload = () => resolve(r2.result);
          r2.readAsText(file, "gbk");
        } else resolve(r.result);
      };
      r.readAsText(file, "utf-8");
    });
  }

  /* ---------- GitHub API 封装 ---------- */
  function gh(path, opts = {}) {
    const token = localStorage.getItem(LS_TOKEN);
    if (!token) return Promise.reject(new Error("尚未设置 GitHub 令牌，请到“设置”页填写"));
    const headers = Object.assign({
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json"
    }, opts.headers || {});
    let body = opts.body;
    if (body && typeof body !== "string") { body = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
    return fetch(API + path, { method: opts.method || "GET", headers, body }).then(async (r) => {
      if (r.ok) return r.status === 204 ? null : r.json();
      let detail = "";
      try { const j = await r.json(); if (j && j.message) detail = j.message; } catch (e) { /* 忽略 */ }
      const err = new Error("GitHub 拒绝了请求（" + r.status + "）" + (detail ? "：" + detail : ""));
      err.status = r.status;
      throw err;
    });
  }
  async function ghGetTextFile(path) {
    const j = await gh(apiPath(path) + "?ref=main&ts=" + Date.now());
    if (!j || j.type !== "file") return null;
    return { sha: j.sha, text: b64ToUtf8(String(j.content || "").replace(/\s/g, "")) };
  }
  async function ghFileSha(path) {
    try {
      const j = await gh(apiPath(path) + "?ref=main&ts=" + Date.now());
      return j && j.sha ? j.sha : null;
    } catch (e) { return null; }
  }
  async function ghPutText(path, text, sha, message) {
    const j = await gh(apiPath(path), {
      method: "PUT",
      body: { message, content: utf8ToB64(text), branch: "main", sha: sha || undefined }
    });
    return j && j.content ? j.content.sha : null;
  }
  async function ghPutBinary(path, file, message) {
    if (file.size > 20 * 1024 * 1024) throw new Error("文件超过 20 MB，建议压缩或改用网盘外链");
    const sha = await ghFileSha(path); // 同名覆盖需要旧 sha
    await gh(apiPath(path), {
      method: "PUT",
      body: { message, content: await fileToB64(file), branch: "main", sha: sha || undefined }
    });
    return path;
  }
  async function ghDelete(path, message) {
    const sha = await ghFileSha(path);
    if (!sha) return; // 本来就不存在
    await gh(apiPath(path), { method: "DELETE", body: { message, sha, branch: "main" } });
  }

  /* 读取仓库里最新的 content.json → 应用修改 → 提交（冲突自动重试一次） */
  async function updateContent(mutator, message) {
    for (let i = 0; i < 2; i++) {
      const meta = await ghGetTextFile("content/content.json");
      if (!meta) throw new Error("仓库里找不到 content/content.json");
      const data = JSON.parse(meta.text);
      await mutator(data);
      try {
        await ghPutText("content/content.json", JSON.stringify(data, null, 2), meta.sha, message);
        return data;
      } catch (e) {
        if (e.status === 409 && i === 0) continue;
        throw e;
      }
    }
  }

  /* ---------- txt 章节自动切分 ---------- */
  function splitChapters(rawText) {
    const text = String(rawText || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return [];
    const re = /^[ \t]*(第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集][ \t]*[^\n]{0,40}|序章|序幕|楔子|尾声|番外[^\n]{0,20})[ \t]*$/;
    const lines = text.split("\n");
    const marks = [];
    lines.forEach((l, i) => { if (re.test(l)) marks.push(i); });
    if (marks.length >= 2) {
      const chapters = [];
      const pre = lines.slice(0, marks[0]).join("\n").trim();
      if (pre) chapters.push({ title: "开篇", content: pre });
      marks.forEach((start, k) => {
        const end = k + 1 < marks.length ? marks[k + 1] : lines.length;
        chapters.push({
          title: lines[start].trim(),
          content: lines.slice(start + 1, end).join("\n").trim()
        });
      });
      return chapters;
    }
    return [{ title: "全文", content: text }];
  }

  /* ---------- 面板骨架 ---------- */
  function injectSkeleton() {
    if ($("#admin-fab")) return;

    const fab = document.createElement("button");
    fab.id = "admin-fab";
    fab.title = "管理";
    fab.textContent = "⚙";
    fab.addEventListener("click", onFabClick);
    document.body.appendChild(fab);

    const login = document.createElement("div");
    login.id = "adm-login";
    login.hidden = true;
    login.innerHTML =
      '<div class="adm-login-card">' +
      '<h3>🔐 网站管理</h3>' +
      '<p class="adm-note">请输入管理密码</p>' +
      '<input type="password" id="adm-pass" placeholder="管理密码" autocomplete="current-password">' +
      '<div class="adm-row"><button class="btn btn-primary" id="adm-login-go">进入</button>' +
      '<button class="btn btn-ghost" id="adm-login-cancel">取消</button></div>' +
      "</div>";
    document.body.appendChild(login);
    $("#adm-login-go").addEventListener("click", doLogin);
    $("#adm-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    $("#adm-login-cancel").addEventListener("click", () => { $("#adm-login").hidden = true; });

    const root = document.createElement("div");
    root.id = "adm-root";
    root.hidden = true;
    root.innerHTML =
      '<div class="adm-panel">' +
      '<div class="adm-head"><span>🛠 网站管理面板</span>' +
      '<span class="adm-status" id="adm-status">检查令牌中…</span>' +
      '<button id="adm-close" title="关闭">✕</button></div>' +
      '<div class="adm-tabs" id="adm-tabs">' +
      '<button class="adm-tab active" data-tab="novel">小说</button>' +
      '<button class="adm-tab" data-tab="program">程序</button>' +
      '<button class="adm-tab" data-tab="game">游戏</button>' +
      '<button class="adm-tab" data-tab="profile">基本信息</button>' +
      '<button class="adm-tab" data-tab="settings">设置</button>' +
      "</div>" +
      '<div class="adm-body" id="adm-body"></div>' +
      "</div>";
    document.body.appendChild(root);
    $("#adm-close").addEventListener("click", closePanel);
    $$("#adm-tabs .adm-tab").forEach((b) => b.addEventListener("click", () => {
      $$("#adm-tabs .adm-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderTab(b.dataset.tab);
    }));
  }

  async function onFabClick() {
    injectSkeleton();
    if (sessionStorage.getItem(SS_AUTH) === "1") return openPanel();
    try {
      const r = await fetch("content/content.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error();
      const j = await r.json();
      if (!j || !j.admin || !j.admin.passwordHash) throw new Error();
      $("#adm-login").hidden = false;
      $("#adm-pass").value = "";
      $("#adm-pass").focus();
    } catch (e) {
      toast("管理功能需要在线使用（请打开线上网址）");
    }
  }

  async function doLogin() {
    const pass = $("#adm-pass").value;
    if (!pass) return;
    try {
      const r = await fetch("content/content.json?t=" + Date.now(), { cache: "no-store" });
      const j = await r.json();
      const hash = await sha256Hex(pass);
      if (j && j.admin && hash === j.admin.passwordHash) {
        sessionStorage.setItem(SS_AUTH, "1");
        $("#adm-login").hidden = true;
        openPanel();
      } else {
        toast("密码不对，再试试");
        $("#adm-pass").value = "";
      }
    } catch (e) {
      toast("无法读取管理配置，请确认在线");
    }
  }

  function openPanel() {
    $("#adm-root").hidden = false;
    document.body.style.overflow = "hidden";
    $$("#adm-tabs .adm-tab").forEach((x) => x.classList.remove("active"));
    const first = $("#adm-tabs .adm-tab");
    if (first) first.classList.add("active");
    renderTab("novel");
    checkToken();
  }
  function closePanel() {
    $("#adm-root").hidden = true;
    document.body.style.overflow = "";
  }

  async function checkToken() {
    const el = $("#adm-status");
    if (!localStorage.getItem(LS_TOKEN)) {
      el.textContent = "⚠ 未设置令牌（见“设置”页）";
      el.className = "adm-status bad";
      return;
    }
    try {
      await gh("/repos/" + CONFIG.owner + "/" + CONFIG.repo);
      el.textContent = "● 已连接 GitHub";
      el.className = "adm-status ok";
    } catch (e) {
      el.textContent = "✕ 令牌无效（去“设置”页重新填写）";
      el.className = "adm-status bad";
    }
  }

  /* ---------- 各标签页渲染 ---------- */
  let live = null; // 面板内缓存的内容（用于列表展示）
  async function fetchLive() {
    const r = await fetch("content/content.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("读取内容失败");
    return r.json();
  }

  async function renderTab(tab) {
    const body = $("#adm-body");
    if (!live) {
      try { live = await fetchLive(); }
      catch (e) { body.innerHTML = '<p class="adm-note">⚠ ' + esc(e.message) + "</p>"; return; }
    }
    if (tab === "novel") renderNovelTab(body);
    else if (tab === "program") renderFileTab(body, "program");
    else if (tab === "game") renderFileTab(body, "game");
    else if (tab === "profile") renderProfileTab(body);
    else if (tab === "settings") renderSettingsTab(body);
  }

  /* ===== 小说页 ===== */
  function renderNovelTab(body) {
    body.innerHTML =
      '<div class="adm-form">' +
      '<h4>上传小说（.txt）</h4>' +
      '<div class="adm-field"><label>选择 txt 文件</label><input type="file" id="nv-file" accept=".txt,.text"></div>' +
      '<div class="adm-field"><label>或直接粘贴正文</label><textarea id="nv-text" rows="6" placeholder="把小说全文粘贴到这里，支持自动识别“第一章 …”等章节标题"></textarea></div>' +
      '<div class="adm-field"><label>书名</label><input type="text" id="nv-title" placeholder="例如：轨道上的书店"></div>' +
      '<div class="adm-field"><label>类型</label><input type="text" id="nv-genre" placeholder="例如：科幻 · 短篇"></div>' +
      '<div class="adm-field"><label>简介</label><textarea id="nv-desc" rows="2" placeholder="一两句话介绍，显示在书架卡片上"></textarea></div>' +
      '<p class="adm-note" id="nv-preview"></p>' +
      '<button class="btn btn-primary" id="nv-go">发布小说</button>' +
      "</div>" +
      '<h4 class="adm-list-title">已有作品（' + live.novels.length + " 部）</h4>" +
      '<div class="adm-list">' + live.novels.map((n) =>
        '<div class="adm-item"><span>' + esc(n.title) + ' <small>' + esc(n.genre) + " · " + n.chapters.length + " 章</small></span>" +
        '<button class="adm-del" data-kind="novel" data-id="' + esc(n.id) + '">删除</button></div>'
      ).join("") + "</div>";

    $("#nv-file").addEventListener("change", async () => {
      const f = $("#nv-file").files[0];
      if (!f) return;
      if (!$("#nv-title").value) $("#nv-title").value = f.name.replace(/\.(txt|text)$/i, "");
      const text = await readTextSmart(f);
      $("#nv-text").value = "";
      $("#nv-file")._text = text;
      previewChapters(text);
    });
    let deb = null;
    $("#nv-text").addEventListener("input", () => {
      clearTimeout(deb);
      deb = setTimeout(() => { $("#nv-file")._text = null; previewChapters($("#nv-text").value); }, 400);
    });
    $("#nv-go").addEventListener("click", publishNovel);
    bindDeletes();
  }
  function previewChapters(text) {
    const n = splitChapters(text).length;
    $("#nv-preview").textContent = text.trim() ? "检测到 " + n + " 个章节，发布后可在阅读页切换。" : "";
  }
  async function publishNovel() {
    const btn = $("#nv-go");
    const title = $("#nv-title").value.trim();
    const genre = $("#nv-genre").value.trim() || "未分类";
    const desc = $("#nv-desc").value.trim() || "（暂无简介）";
    const text = $("#nv-file")._text || $("#nv-text").value;
    if (!title) return toast("请填写书名");
    if (!text || !text.trim()) return toast("请选择 txt 文件或粘贴正文");
    const chapters = splitChapters(text);
    if (!chapters.length) return toast("正文是空的");
    btn.disabled = true;
    btn.textContent = "发布中…";
    try {
      live = await updateContent((d) => {
        d.novels.unshift({
          id: newId(), title, genre, description: desc,
          cover: "", updatedAt: today(), chapters
        });
      }, "管理面板：上传小说《" + title + "》");
      toast("✅ 发布成功！约 1 分钟后线上生效，刷新页面即可看到");
      renderTab("novel");
    } catch (e) {
      toast("发布失败：" + e.message, 6000);
      btn.disabled = false;
      btn.textContent = "发布小说";
    }
  }

  /* ===== 程序 / 游戏页（结构相同） ===== */
  function renderFileTab(body, kind) {
    const isGame = kind === "game";
    const list = isGame ? live.games : live.programs;
    body.innerHTML =
      '<div class="adm-form">' +
      "<h4>上传" + (isGame ? "游戏" : "程序") + "</h4>" +
      '<div class="adm-field"><label>选择文件' + (isGame ? "（.html 网页游戏可直接在线玩；其他格式提供下载）" : "（zip / exe / py 等均可）") + "</label>" +
      '<input type="file" id="up-file"></div>' +
      '<div class="adm-field"><label>' + (isGame ? "游戏名" : "程序名") + '</label><input type="text" id="up-title"></div>' +
      '<div class="adm-field"><label>简介</label><textarea id="up-desc" rows="2"></textarea></div>' +
      '<div class="adm-field"><label>技术标签（逗号分隔）</label><input type="text" id="up-tech" placeholder="例如：Python, JavaScript"></div>' +
      '<div class="adm-field"><label>外部链接（可选，如仓库地址）</label><input type="text" id="up-link" placeholder="https://…"></div>' +
      '<p class="adm-note" id="up-preview"></p>' +
      '<button class="btn btn-primary" id="up-go">发布</button>' +
      "</div>" +
      '<h4 class="adm-list-title">已有内容（' + list.length + " 项）</h4>" +
      '<div class="adm-list">' + list.map((p) =>
        '<div class="adm-item"><span>' + (p.icon ? esc(p.icon) + " " : "") + esc(p.title) + " <small>" + esc((p.tech || []).join(" / ")) + (p.file ? " · " + esc(p.file.split("/").pop()) : "") + "</small></span>" +
        '<button class="adm-del" data-kind="' + kind + '" data-id="' + esc(p.id) + '">删除</button></div>'
      ).join("") + "</div>";

    $("#up-file").addEventListener("change", () => {
      const f = $("#up-file").files[0];
      if (!f) return;
      if (!$("#up-title").value) $("#up-title").value = f.name.replace(/\.[^.]+$/, "");
      $("#up-preview").textContent = "文件：" + f.name + "（" + (f.size / 1024 / 1024).toFixed(2) + " MB）";
    });
    $("#up-go").addEventListener("click", () => publishFile(kind));
    bindDeletes();
  }
  async function publishFile(kind) {
    const isGame = kind === "game";
    const btn = $("#up-go");
    const file = $("#up-file").files[0];
    const title = $("#up-title").value.trim();
    const desc = $("#up-desc").value.trim() || "（暂无简介）";
    const link = $("#up-link").value.trim();
    const tech = $("#up-tech").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (!title) return toast("请填写名称");
    if (!file && !link) return toast("请选择文件，或至少填写一个外部链接");

    btn.disabled = true;
    btn.textContent = "发布中…（文件较大的话请耐心等待）";
    try {
      let filePath = "";
      if (file) {
        const dir = isGame ? "assets/games" : "assets/programs";
        filePath = await ghPutBinary(dir + "/" + file.name, file, "管理面板：上传文件 " + file.name);
      }
      live = await updateContent((d) => {
        const arr = isGame ? d.games : d.programs;
        arr.unshift({
          id: newId(), title, description: desc,
          tech, file: filePath, link,
          icon: isGame ? "🎮" : "💻",
          type: isGame && file && /\.html?$/i.test(file.name) ? "embed" : (isGame ? "download" : undefined)
        });
      }, "管理面板：上传" + (isGame ? "游戏" : "程序") + "「" + title + "」");
      toast("✅ 发布成功！约 1 分钟后线上生效");
      renderTab(kind);
    } catch (e) {
      toast("发布失败：" + e.message, 6000);
      btn.disabled = false;
      btn.textContent = "发布";
    }
  }

  /* ===== 基本信息页 ===== */
  function renderProfileTab(body) {
    const p = live.profile;
    body.innerHTML =
      '<div class="adm-form">' +
      "<h4>基本信息（网站名、简介、联系方式）</h4>" +
      '<div class="adm-field"><label>名字 / 昵称</label><input type="text" id="pf-name" value="' + esc(p.name) + '"></div>' +
      '<div class="adm-field"><label>一句话签名</label><input type="text" id="pf-tagline" value="' + esc(p.tagline) + '"></div>' +
      '<div class="adm-field"><label>头像图片地址（留空显示名字首字）</label><input type="text" id="pf-avatar" value="' + esc(p.avatar || "") + '" placeholder="assets/avatar.jpg"></div>' +
      '<div class="adm-field"><label>自我介绍（空一行 = 分一段）</label><textarea id="pf-bio" rows="6">' + esc((p.bio || []).join("\n\n")) + "</textarea></div>" +
      '<div class="adm-field"><label>技能标签（逗号分隔）</label><input type="text" id="pf-skills" value="' + esc((p.skills || []).join("，")) + '"></div>' +
      '<div class="adm-field"><label>联系方式（每行一条：标签 | 显示内容 | 链接）</label><textarea id="pf-contacts" rows="3" placeholder="邮箱 | you@example.com | mailto:you@example.com">' +
      esc((p.contacts || []).map((c) => [c.label, c.value, c.href || ""].join(" | ")).join("\n")) + "</textarea></div>" +
      '<button class="btn btn-primary" id="pf-go">保存基本信息</button>' +
      "</div>";
    $("#pf-go").addEventListener("click", saveProfile);
  }
  async function saveProfile() {
    const btn = $("#pf-go");
    const bio = $("#pf-bio").value.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const skills = $("#pf-skills").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const contacts = $("#pf-contacts").value.split("\n").map((line) => {
      const parts = line.split("|").map((s) => s.trim());
      return parts[0] ? { label: parts[0], value: parts[1] || parts[0], href: parts[2] || "" } : null;
    }).filter(Boolean);
    if (!$("#pf-name").value.trim()) return toast("名字不能为空");
    btn.disabled = true;
    try {
      live = await updateContent((d) => {
        d.profile = {
          name: $("#pf-name").value.trim(),
          tagline: $("#pf-tagline").value.trim(),
          avatar: $("#pf-avatar").value.trim(),
          bio: bio.length ? bio : ["（暂无介绍）"],
          skills: skills.length ? skills : ["写作"],
          contacts
        };
      }, "管理面板：更新基本信息");
      toast("✅ 保存成功！约 1 分钟后线上生效");
    } catch (e) {
      toast("保存失败：" + e.message, 6000);
    }
    btn.disabled = false;
  }

  /* ===== 设置页 ===== */
  function renderSettingsTab(body) {
    body.innerHTML =
      '<div class="adm-form">' +
      "<h4>GitHub 令牌（发布内容的钥匙，只需设置一次）</h4>" +
      '<ol class="adm-note"><li>打开 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a></li>' +
      "<li>Repository access 选 <b>Only select repositories</b> → 选中 <b>" + esc(CONFIG.owner + "/" + CONFIG.repo) + "</b></li>" +
      "<li>Permissions → Repository permissions → <b>Contents</b> → 选 <b>Read and write</b>（其他都不用给）</li>" +
      "<li>点 Generate token，复制生成的一串字符粘贴到下面</li></ol>" +
      '<div class="adm-field"><label>令牌</label><input type="password" id="st-token" placeholder="github_pat_…（只保存在本机浏览器）" autocomplete="off"></div>' +
      '<div class="adm-row"><button class="btn btn-primary" id="st-save">保存并验证</button>' +
      '<button class="btn btn-ghost" id="st-clear">清除本机令牌</button></div>' +
      "</div>" +
      '<div class="adm-form">' +
      "<h4>修改管理密码</h4>" +
      '<div class="adm-field"><label>新密码（至少 6 位，请不要太简单）</label><input type="password" id="st-pass1" autocomplete="new-password"></div>' +
      '<div class="adm-field"><label>再输一遍</label><input type="password" id="st-pass2" autocomplete="new-password"></div>' +
      '<button class="btn btn-primary" id="st-pass-go">修改密码</button>' +
      "</div>" +
      '<div class="adm-form">' +
      "<h4>其他</h4>" +
      '<button class="btn btn-ghost" id="st-logout">退出管理（收起面板）</button>' +
      '<p class="adm-note">说明：发布的内容约 1 分钟后生效（GitHub Pages 需要重新构建）。令牌与密码都只保存在你自己的浏览器里。</p>' +
      "</div>";

    $("#st-save").addEventListener("click", async () => {
      const t = $("#st-token").value.trim();
      if (!t) return toast("请先粘贴令牌");
      localStorage.setItem(LS_TOKEN, t);
      $("#adm-status").textContent = "验证中…";
      await checkToken();
      toast(localStorage.getItem(LS_TOKEN) ? "✅ 令牌有效，可以发布了" : "令牌无效，请检查权限设置", 5000);
    });
    $("#st-clear").addEventListener("click", () => {
      localStorage.removeItem(LS_TOKEN);
      checkToken();
      toast("已清除本机保存的令牌");
    });
    $("#st-pass-go").addEventListener("click", async () => {
      const p1 = $("#st-pass1").value, p2 = $("#st-pass2").value;
      if (p1.length < 6) return toast("密码至少 6 位");
      if (p1 !== p2) return toast("两次输入不一致");
      try {
        const hash = await sha256Hex(p1);
        live = await updateContent((d) => { d.admin = d.admin || {}; d.admin.passwordHash = hash; }, "管理面板：修改管理密码");
        toast("✅ 密码已修改，下次登录请使用新密码");
        $("#st-pass1").value = ""; $("#st-pass2").value = "";
      } catch (e) { toast("修改失败：" + e.message, 6000); }
    });
    $("#st-logout").addEventListener("click", closePanel);
  }

  /* ===== 删除 ===== */
  function bindDeletes() {
    $$(".adm-del").forEach((b) => b.addEventListener("click", async () => {
      const kind = b.dataset.kind;
      const id = b.dataset.id;
      if (!confirm("确定删除这个条目吗？（对应上传的文件也会从仓库删除）")) return;
      b.disabled = true;
      try {
        let file = null;
        live = await updateContent((d) => {
          const key = kind === "novel" ? "novels" : (kind === "game" ? "games" : "programs");
          const item = d[key].find((x) => x.id === id);
          if (item && item.file) file = item.file;
          d[key] = d[key].filter((x) => x.id !== id);
        }, "管理面板：删除条目 " + id);
        if (file) { try { await ghDelete(file, "管理面板：删除文件 " + file); } catch (e) { /* 已忽略 */ } }
        toast("✅ 已删除");
        renderTab(kind);
      } catch (e) {
        toast("删除失败：" + e.message, 6000);
        b.disabled = false;
      }
    }));
  }

  /* ---------- 页面加载后挂上 ⚙ 按钮 ---------- */
  if (document.body) injectSkeleton();
  else document.addEventListener("DOMContentLoaded", injectSkeleton);
})();
