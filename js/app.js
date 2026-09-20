/* =====================================================
   全站渲染脚本：根据 js/data.js 里的内容生成页面
   一般情况下不需要修改这个文件
   ===================================================== */
(function () {
  "use strict";

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var data = null;
  var page = document.body.dataset.page;

  /* 绑定自定义域名后：旧 github.io 地址整体跳转到新域名（避免 https→http 资源加载被拦截） */
  if (location.hostname === "hey-alan.github.io") {
    location.replace("http://hey-alan.com.cn" + location.pathname.replace(/^\/personal-website/, "") + location.search + location.hash);
    return;
  }

  /* ---------- 公共部分：logo / 标题 / 导航高亮 / 页脚 ---------- */
  function renderCommon() {
    var p = data.profile;
    var logo = $("#logo");
    if (logo) logo.textContent = p.name;
    document.title = document.title.replace("你的名字", p.name);
    var footer = $("#footer-text");
    if (footer) footer.textContent = "© " + new Date().getFullYear() + " " + p.name + " · 用文字与代码搭建";
    $$("[data-nav]").forEach(function (a) {
      if (a.dataset.nav === page) a.classList.add("active");
    });
  }

  /* ---------- 卡片模板 ---------- */
  function novelCard(n) {
    return (
      '<a class="card" href="novel.html?id=' + encodeURIComponent(n.id) + '">' +
      '<div class="card-cover" style="background:' + (n.cover || "linear-gradient(135deg,#5b7c99,#2e4a62)") + '">' +
      "<span>" + esc(n.title.charAt(0)) + "</span></div>" +
      '<div class="card-body"><h3>' + esc(n.title) + "</h3>" +
      '<p class="card-desc">' + esc(n.description) + "</p>" +
      '<div class="card-meta"><span class="tag">' + esc(n.genre) + "</span><span>" +
      n.chapters.length + " 章 · " + esc(n.updatedAt) + "</span></div>" +
      "</div></a>"
    );
  }

  function programCard(p) {
    var btns = [];
    if (p.file) btns.push('<a class="btn btn-small btn-primary" href="' + esc(p.file) + '" download>⬇ 下载</a>');
    if (p.link) btns.push('<a class="btn btn-small btn-ghost" href="' + esc(p.link) + '" target="_blank" rel="noopener">查看页面 ↗</a>');
    return (
      '<div class="card"><div class="card-body">' +
      '<div class="card-icon">' + esc(p.icon || "💻") + "</div>" +
      "<h3>" + esc(p.title) + "</h3>" +
      '<p class="card-desc">' + esc(p.description) + "</p>" +
      '<div class="tag-row">' + (p.tech || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
      '<div class="card-actions">' + (btns.join("") || '<span class="muted">文件整理中</span>') + "</div>" +
      "</div></div>"
    );
  }

  function gameCard(g) {
    var btns = [];
    if (g.type === "embed" && g.file) {
      btns.push('<button class="btn btn-small btn-primary js-play" data-file="' + esc(g.file) + '" data-title="' + esc(g.title) + '">▶ 在线试玩</button>');
      btns.push('<a class="btn btn-small btn-ghost" href="' + esc(g.file) + '" target="_blank">新窗口打开 ↗</a>');
    }
    if (g.type !== "embed" && g.file) {
      btns.push('<a class="btn btn-small btn-primary" href="' + esc(g.file) + '" download>⬇ 下载游戏</a>');
    }
    if (g.link) btns.push('<a class="btn btn-small btn-ghost" href="' + esc(g.link) + '" target="_blank" rel="noopener">打开链接 ↗</a>');
    return (
      '<div class="card"><div class="card-body">' +
      '<div class="card-icon">' + esc(g.icon || "🎮") + "</div>" +
      "<h3>" + esc(g.title) + "</h3>" +
      '<p class="card-desc">' + esc(g.description) + "</p>" +
      '<div class="tag-row">' + (g.tech || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
      '<div class="card-actions">' + (btns.join("") || '<span class="muted">敬请期待</span>') + "</div>" +
      "</div></div>"
    );
  }

  function fillCards(sel, tpl, items) {
    var el = $(sel);
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '<p class="empty">这里还空空如也，去 js/data.js 里添加内容吧。</p>';
      return;
    }
    el.innerHTML = items.map(tpl).join("");
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    var p = data.profile;
    $("#hero-name").textContent = p.name;
    $("#hero-tagline").textContent = p.tagline;

    var av = $("#hero-avatar");
    if (p.avatar) av.innerHTML = '<img src="' + esc(p.avatar) + '" alt="' + esc(p.name) + '">';
    else av.textContent = p.name.trim().charAt(0);

    $("#about-bio").innerHTML = p.bio.map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("");
    $("#about-skills").innerHTML = p.skills.map(function (s) { return '<span class="tag">' + esc(s) + "</span>"; }).join("");
    $("#about-contacts").innerHTML = p.contacts.map(function (c) {
      var text = esc(c.label) + "：" + esc(c.value);
      return c.href ? '<a href="' + esc(c.href) + '" target="_blank" rel="noopener">' + text + "</a>" : "<span>" + text + "</span>";
    }).join("");

    var novels = data.novels.slice().sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    fillCards("#latest-novels", novelCard, novels.slice(0, 3));
    fillCards("#latest-programs", programCard, data.programs.slice(0, 3));
    fillCards("#latest-games", gameCard, data.games.slice(0, 3));
  }

  /* ---------- 书架页 ---------- */
  function renderNovels() {
    var count = $("#novel-count");
    if (count) count.textContent = "共 " + data.novels.length + " 部作品 · 点击开始阅读";
    fillCards("#novel-grid", novelCard, data.novels);
  }

  /* ---------- 阅读页 ---------- */
  function renderNovelPage() {
    var params = new URLSearchParams(location.search);
    var id = params.get("id");
    var novel = null;
    for (var i = 0; i < data.novels.length; i++) {
      if (data.novels[i].id === id) novel = data.novels[i];
    }
    if (!novel) { location.replace("novels.html"); return; }

    var ch = parseInt(params.get("ch") || "0", 10);
    if (isNaN(ch) || ch < 0 || ch >= novel.chapters.length) ch = 0;

    document.title = novel.title + " · " + data.profile.name;
    $("#novel-title").textContent = novel.title;

    $("#chapter-list").innerHTML = novel.chapters.map(function (c, idx) {
      return '<a class="ch-item' + (idx === ch ? " active" : "") +
        '" href="novel.html?id=' + encodeURIComponent(id) + "&ch=" + idx + '">' + esc(c.title) + "</a>";
    }).join("");

    var current = novel.chapters[ch];
    $("#chapter-title").textContent = current.title;
    $("#novel-content").innerHTML = String(current.content)
      .split(/\n+/)
      .filter(function (t) { return t.trim(); })
      .map(function (t) { return "<p>" + esc(t) + "</p>"; })
      .join("");

    var base = "novel.html?id=" + encodeURIComponent(id) + "&ch=";
    var hasPrev = ch > 0;
    var hasNext = ch < novel.chapters.length - 1;
    $("#chapter-nav").innerHTML =
      (hasPrev
        ? '<a class="btn btn-ghost" href="' + base + (ch - 1) + '">← 上一章</a>'
        : '<span class="btn btn-ghost disabled">← 上一章</span>') +
      (hasNext
        ? '<a class="btn btn-primary" href="' + base + (ch + 1) + '">下一章 →</a>'
        : '<span class="btn btn-ghost disabled">已是最后一章</span>');

    /* 阅读页字号调节，会记住你的选择 */
    var contentEl = $("#novel-content");
    var size = parseInt(localStorage.getItem("reader-font") || "18", 10);
    var apply = function () {
      contentEl.style.fontSize = size + "px";
      localStorage.setItem("reader-font", String(size));
    };
    $("#font-plus").addEventListener("click", function () { size = Math.min(24, size + 1); apply(); });
    $("#font-minus").addEventListener("click", function () { size = Math.max(14, size - 1); apply(); });
    apply();
  }

  /* ---------- 程序页 ---------- */
  function renderPrograms() {
    var count = $("#program-count");
    if (count) count.textContent = "共 " + data.programs.length + " 个项目 · 都是亲手写的";
    fillCards("#program-grid", programCard, data.programs);
  }

  /* ---------- 游戏页 ---------- */
  function renderGames() {
    var count = $("#game-count");
    if (count) count.textContent = "共 " + data.games.length + " 个游戏 · 网页游戏可以直接玩";
    fillCards("#game-grid", gameCard, data.games);

    var modal = $("#game-modal");
    if (!modal) return;
    var frame = $("#game-frame");

    var open = function (file, title) {
      $("#game-modal-title").textContent = title;
      frame.src = file;
      modal.hidden = false;
      document.body.style.overflow = "hidden";
    };
    var close = function () {
      modal.hidden = true;
      frame.src = "about:blank";
      document.body.style.overflow = "";
    };

    $$(".js-play").forEach(function (b) {
      b.addEventListener("click", function () { open(b.dataset.file, b.dataset.title); });
    });
    $("#game-modal-close").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) close();
    });
  }

  /* ---------- 启动：优先读取线上内容 content.json，失败则回退 data.js ---------- */
  function boot(d) {
    data = d;
    if (!data) return;
    renderCommon();
    if (page === "home") renderHome();
    else if (page === "novels") renderNovels();
    else if (page === "novel") renderNovelPage();
    else if (page === "programs") renderPrograms();
    else if (page === "games") renderGames();
  }

  fetch("content/content.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (j) { boot(j && j.profile ? j : window.SITE_DATA); })
    .catch(function () { boot(window.SITE_DATA); });
})();
