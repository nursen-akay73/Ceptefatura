(function bootSplash() {
  const scriptSrc = document.currentScript ? document.currentScript.src : "";
  const iconSrc = scriptSrc
    ? new URL("../img/logo-icon.png", scriptSrc).href
    : "../assets/img/logo-icon.png";
  const wordSrc = scriptSrc
    ? new URL("../img/logo-word.png", scriptSrc).href
    : "../assets/img/logo-word.png";

  function splashMarkup() {
    return `
      <div class="splash-inner">
        <div class="splash-logo-wrap">
          <img class="splash-icon" src="${iconSrc}" alt="">
          <img class="splash-word" src="${wordSrc}" alt="CepteFatura">
        </div>
        <div class="splash-skeleton">
          <div class="sk-line"></div>
          <div class="sk-line"></div>
          <div class="sk-line"></div>
          <div class="sk-check"></div>
        </div>
      </div>`;
  }

  function mountSplash() {
    if (document.getElementById("app-splash")) return;
    const el = document.createElement("div");
    el.id = "app-splash";
    el.className = "app-splash";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = splashMarkup();
    document.body.appendChild(el);
  }

  function dismissSplash() {
    const el = document.getElementById("app-splash");
    if (!el) return;
    setTimeout(() => {
      el.classList.add("is-done");
      setTimeout(() => el.remove(), 450);
    }, 1250);
    try { sessionStorage.setItem("cf_splash", "1"); } catch {}
  }

  function start() {
    const hasSplash = !!document.getElementById("app-splash");
    let seen = false;
    try { seen = sessionStorage.getItem("cf_splash") === "1"; } catch {}
    if (hasSplash) {
      if (seen) {
        document.getElementById("app-splash")?.remove();
        return;
      }
      dismissSplash();
      return;
    }
    if (seen) return;
    mountSplash();
    dismissSplash();
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  if (!document.querySelector(".sidebar-overlay")) {
    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    overlay.addEventListener("click", () => document.body.classList.remove("nav-open"));
    document.body.appendChild(overlay);
  }

  fetch("../components/sidebar.html")
    .then(r => r.text())
    .then(html => {
      const target = document.getElementById("sidebar-container");
      if (target) {
        target.innerHTML = html;
        const active = target.querySelector(`[data-page="${page}"]`);
        if (active) active.classList.add("active");
        target.querySelectorAll("a").forEach((a) => {
          a.addEventListener("click", () => document.body.classList.remove("nav-open"));
        });
        applyRoleNav(getSessionUser());
      }
    });

  fetch("../components/header.html")
    .then(r => r.text())
    .then(html => {
      const target = document.getElementById("header-container");
      if (target) {
        target.innerHTML = html;
        const menu = document.getElementById("user-menu");
        menu?.addEventListener("click", (e) => {
          e.stopPropagation();
          if (e.target.closest(".user-dropdown")) return;
          menu.classList.toggle("open");
        });
        document.addEventListener("click", () => menu?.classList.remove("open"));
        document.getElementById("menu-toggle")?.addEventListener("click", (e) => {
          e.stopPropagation();
          document.body.classList.toggle("nav-open");
        });
        applyCompanyContext();
        applyUserMenu();
        if (typeof initThemeToggle === "function") initThemeToggle();
        document.getElementById("logout-link")?.addEventListener("click", (e) => {
          e.preventDefault();
          clearSession();
          window.location.href = "login.html";
        });

        const notifMenu = document.getElementById("notif-menu");
        if (notifMenu && localStorage.getItem("token")) {
          document.getElementById("notif-bell")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const opening = !notifMenu.classList.contains("open");
            notifMenu.classList.toggle("open", opening);
            if (opening) loadNotifList();
          });
          // Dropdown içindeki tıklamalar dışarı taşıp paneli erken kapatmasın.
          document.getElementById("notif-dropdown")?.addEventListener("click", (e) => e.stopPropagation());
          document.addEventListener("click", () => notifMenu.classList.remove("open"));
          document.getElementById("notif-mark-all")?.addEventListener("click", async () => {
            await markAllNotificationsRead();
          });
          initNotifBell();
        } else if (notifMenu) {
          notifMenu.hidden = true;
        }
      }
    });

  const fabHrefs = {
    invoices: "invoice-new.html",
    expenses: "expense-new.html",
  };
  if (fabHrefs[page]) {
    const fab = document.createElement("a");
    fab.className = "fab";
    fab.href = fabHrefs[page];
    fab.setAttribute("aria-label", "Yeni kayıt");
    fab.textContent = "+";
    document.body.appendChild(fab);
    document.body.classList.add("has-fab");
  } else if (page === "accounts") {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fab";
    fab.setAttribute("aria-label", "Yeni cari");
    fab.textContent = "+";
    fab.addEventListener("click", () => document.getElementById("btn-open-new")?.click());
    document.body.appendChild(fab);
    document.body.classList.add("has-fab");
  }

  if (!document.body.classList.contains("auth-page")) {
    mountCepteAsistan(page);
  }

  document.querySelectorAll("[data-demo-link]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-demo-link");
      if (target) window.location.href = target;
    });
  });

  const remember = document.getElementById("beni_hatirla");
  const emailInput = document.getElementById("email");
  try {
    const savedEmail = localStorage.getItem("cf_email");
    if (savedEmail && emailInput) {
      emailInput.value = savedEmail;
      if (remember) remember.checked = true;
    }
  } catch {}
  document.getElementById("forgot-pass")?.addEventListener("click", () => {
    const mail = emailInput?.value.trim();
    if (!mail) {
      showToast("Önce e-posta adresinizi yazın", "error");
      emailInput?.focus();
      return;
    }
    showToast("Şifre sıfırlama bağlantısı e-postanıza gönderildi");
  });

  document.querySelectorAll("[data-password-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".input-password")?.querySelector("input");
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.classList.toggle("is-visible", show);
      btn.setAttribute("aria-label", show ? "Şifreyi gizle" : "Şifreyi göster");
      btn.title = show ? "Şifreyi gizle" : "Şifreyi göster";
    });
  });

  document.querySelectorAll("[data-auth-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mode = form.dataset.authForm;
      const body = Object.fromEntries(new FormData(form).entries());
      const url = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const btn = form.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || "İşlem başarısız", "error");
          return;
        }
        if (data.token) localStorage.setItem("token", data.token);
        if (data.user) {
          saveSessionUser(data.user);
          if (data.user.activeBusinessId) setActiveBusinessId(data.user.activeBusinessId);
        }
        if (mode === "login") {
          try {
            if (remember?.checked && body.email) localStorage.setItem("cf_email", body.email);
            else localStorage.removeItem("cf_email");
          } catch {}
        }
        if (mode === "register") {
          showToast("Kayıt oluşturuldu");
          window.location.href = "login.html";
        } else {
          window.location.href = "dashboard.html";
        }
      } catch {
        showToast("Sunucuya bağlanılamadı. npm run dev çalışıyor mu?", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  });

  document.querySelectorAll("form[data-demo-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showToast(form.dataset.toast || "Kaydedildi");
      const redirect = form.dataset.redirect;
      if (redirect) setTimeout(() => { window.location.href = redirect; }, 600);
    });
  });

  document.querySelectorAll("[data-add-row]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tbody = document.querySelector(btn.dataset.addRow);
      if (!tbody) return;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><input class="table-input" name="aciklama[]" placeholder="Ürün veya hizmet"></td>
        <td><input class="table-input" name="miktar[]" type="number" value="1"></td>
        <td><input class="table-input" name="birim_fiyat[]" type="number" value="0"></td>
        <td><input class="table-input" name="kdv_orani[]" type="number" value="20"></td>
        <td class="money">₺0,00</td>
        <td><button type="button" class="text-btn danger" data-remove-row>Sil</button></td>`;
      tbody.appendChild(row);
      row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());
    });
  });

  document.querySelectorAll("[data-remove-row]").forEach(btn => {
    btn.addEventListener("click", () => btn.closest("tr")?.remove());
  });

  const drop = document.getElementById("ocr-dropzone");
  const fileInput = document.getElementById("ocr-file");
  if (drop && fileInput) {
    const runOcr = () => {
      const status = document.getElementById("ocr-status");
      const bar = document.getElementById("ocr-progress");
      const fill = bar?.querySelector("span");
      if (status) {
        status.style.display = "block";
        status.textContent = "Tutar ve KDV taranıyor...";
      }
      if (bar) bar.style.display = "block";
      if (fill) fill.style.width = "12%";
      setTimeout(() => { if (fill) fill.style.width = "70%"; }, 400);
      setTimeout(() => {
        if (fill) fill.style.width = "100%";
        if (status) status.textContent = "Tutar ve KDV okundu";
        const firma = document.getElementById("gider-firma");
        const tutar = document.getElementById("gider-tutar");
        const kdv = document.getElementById("gider-kdv");
        const kaynak = document.getElementById("gider-kaynak");
        const kategori = document.getElementById("gider-kategori");
        const aciklama = document.getElementById("gider_aciklama");
        if (firma) firma.value = "ABC Ofis Ltd.";
        if (tutar) tutar.value = "2450.00";
        if (kdv) kdv.value = "490.00";
        if (kaynak) kaynak.value = "OCR";
        if (kategori) kategori.value = "Ofis";
        if (aciklama) aciklama.value = "Ofis kırtasiye ve sarf malzeme fişi";
        showToast("Fiş tarandı, tutar ve KDV dolduruldu");
      }, 1000);
    };
    drop.addEventListener("click", (e) => {
      if (e.target !== fileInput) fileInput.click();
    });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      runOcr();
    });
    fileInput.addEventListener("change", runOcr);
  }

  document.getElementById("btn-pdf-report")?.addEventListener("click", () => {
    showToast("Rapor PDF olarak hazırlanıyor...");
    setTimeout(() => {
      downloadSimplePdf("CepteFatura-Rapor-2026.pdf", "CepteFatura Finansal Rapor", [
        "Donem: 2026 Yili",
        "Toplam Nakit: TL 125.000,00",
        "Bu Ay Gelir: TL 85.000,00",
        "Bu Ay Gider: TL 32.000,00",
        "Bekleyen Tahsilat: TL 18.500,00",
        "KDV Satis: TL 32.400,00",
        "KDV Alis: TL 6.200,00",
        "Net KDV: TL 26.200,00",
        "",
        "Ozet: Nakit akisi pozitif, tahsilat takibi devam ediyor.",
      ]);
      showToast("Rapor indirildi");
    }, 900);
  });
  document.getElementById("btn-pdf-invoice")?.addEventListener("click", () => {
    showToast("Rapor PDF olarak hazırlanıyor...");
    const no = document.getElementById("m-fatura-no")?.textContent || "Fatura";
    const cari = document.getElementById("m-cari")?.textContent || "";
    const tutar = document.getElementById("m-toplam")?.textContent || "";
    setTimeout(() => {
      downloadSimplePdf(`${no}.pdf`, "CepteFatura Fatura Ozeti", [
        "Fatura No: " + no,
        "Cari: " + cari,
        "Tutar: " + tutar,
        "Durum: " + (document.getElementById("m-durum")?.textContent || ""),
      ]);
      showToast("Fatura özeti indirildi");
    }, 700);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".js-switch-company");
    if (!btn) return;
    e.preventDefault();
    const businessId = btn.dataset.businessId
      || btn.closest("tr")?.dataset.businessId
      || document.getElementById("companyModal")?.dataset.businessId;
    const name = btn.dataset.company
      || btn.closest("tr")?.querySelector("strong")?.textContent.trim()
      || document.getElementById("m-isletme-adi")?.textContent.trim();
    if (!businessId || !name) return;
    setActiveBusinessId(businessId);
    try { sessionStorage.setItem("cf_company", name); } catch {}
    showToast(name + " hesabına geçildi");
    setTimeout(() => { window.location.href = "dashboard.html"; }, 450);
  });

  document.querySelectorAll("[data-tabs]").forEach((root) => {
    const tabs = root.querySelectorAll("[data-tab]");
    const panels = root.querySelectorAll("[data-tab-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        const id = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle("active", t === tab));
        panels.forEach((p) => { p.hidden = p.dataset.tabPanel !== id; });
      });
    });
  });

  document.getElementById("btn-upgrade-plan")?.addEventListener("click", () => {
    showToast("KOBİ paketine geçiş talebi alındı");
  });
  document.getElementById("btn-contact-plan")?.addEventListener("click", () => {
    showToast("Muhasebeci paketi için iletişim kaydı oluşturuldu");
  });

  document.querySelectorAll(".mic-btn").forEach((btn) => {
    if (btn.closest("#items-body")) return;
    btn.addEventListener("click", () => {
      const input = btn.closest(".input-mic")?.querySelector("input, textarea");
      if (input) startSpeechToText(input, btn);
    });
  });

  labelTableCells();
  document.querySelectorAll("table.table-cards tbody").forEach((tbody) => {
    new MutationObserver(() => {
      labelTableCells();
      syncEmptyStates();
    }).observe(tbody, { childList: true });
  });

  document.querySelectorAll(".filter-row input, .filter-row select, #search-accounts, #search-company, #filter-search, #filter-status, #filter-type, .tab-btn").forEach((el) => {
    el.addEventListener("input", () => setTimeout(syncEmptyStates, 0));
    el.addEventListener("change", () => setTimeout(syncEmptyStates, 0));
    el.addEventListener("click", () => setTimeout(syncEmptyStates, 0));
  });
  syncEmptyStates();

  if (page === "dashboard") initCashflowChart();
  if (page === "settings") initSettingsPage();
});

function initCashflowChart() {
  const chart = document.querySelector("[data-cashflow]");
  const readout = document.querySelector("[data-cf-readout]");
  if (!chart || !readout) return;

  const money = (n) => "₺" + Number(n).toLocaleString("tr-TR");

  function show(col) {
    if (!col) return;
    chart.querySelectorAll(".cashflow-col").forEach((el) => {
      el.classList.toggle("is-active", el === col);
    });
    const gelir = Number(col.dataset.gelir) || 0;
    const gider = Number(col.dataset.gider) || 0;
    const net = gelir - gider;
    readout.textContent = col.dataset.label + " 2026 · Gelir " + money(gelir)
      + " · Gider " + money(gider) + " · Net " + money(net);
  }

  const current = chart.querySelector(".cashflow-col.is-current") || chart.querySelector(".cashflow-col");
  show(current);

  chart.querySelectorAll(".cashflow-col").forEach((col) => {
    col.addEventListener("mouseenter", () => show(col));
    col.addEventListener("focus", () => show(col));
    col.addEventListener("click", () => {
      const month = col.dataset.month;
      window.location.href = month ? "reports.html?period=" + month : "reports.html";
    });
  });
  chart.addEventListener("mouseleave", () => show(current));
}

function labelTableCells() {
  document.querySelectorAll("table.table-cards").forEach((table) => {
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.children].forEach((td, i) => {
        if (headers[i]) td.dataset.label = headers[i];
      });
    });
  });
}

function syncEmptyStates() {
  document.querySelectorAll("[data-empty-for]").forEach((empty) => {
    const tbody = document.querySelector(empty.dataset.emptyFor);
    if (!tbody) return;
    const rows = [...tbody.querySelectorAll("tr")];
    const visible = rows.filter((r) => r.style.display !== "none");
    const wrap = tbody.closest(".table-wrap");
    const noneMsg = empty.querySelector("[data-empty-none]");
    const filterMsg = empty.querySelector("[data-empty-filter]");
    if (visible.length === 0) {
      empty.classList.add("visible");
      wrap?.classList.add("is-empty");
      if (noneMsg) noneMsg.hidden = rows.length > 0;
      if (filterMsg) filterMsg.hidden = rows.length === 0;
    } else {
      empty.classList.remove("visible");
      wrap?.classList.remove("is-empty");
    }
  });
}

function getSessionUser() {
  try {
    const raw = localStorage.getItem("cf_user");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveSessionUser(user) {
  if (!user) return;
  try {
    localStorage.setItem("cf_user", JSON.stringify({
      id: user.id,
      ad_soyad: user.ad_soyad,
      isletme_adi: user.isletme_adi,
      email: user.email,
      businesses: user.businesses || [],
      activeBusinessId: user.activeBusinessId || null,
    }));
  } catch {}
}

function clearSession() {
  try {
    localStorage.removeItem("token");
    localStorage.removeItem("cf_user");
    localStorage.removeItem("cf_business_id");
    sessionStorage.removeItem("cf_company");
  } catch {}
}

function activeBusinessId() {
  try { return localStorage.getItem("cf_business_id") || ""; } catch { return ""; }
}

function setActiveBusinessId(id) {
  try {
    if (id) localStorage.setItem("cf_business_id", id);
    else localStorage.removeItem("cf_business_id");
  } catch {}
}

async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem("token");
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const bizId = activeBusinessId();
  if (bizId) headers["X-Business-Id"] = bizId;
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== "string") {
    headers["Content-Type"] = "application/json";
    opts = { ...opts, body: JSON.stringify(opts.body) };
  } else if (opts.body && typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(path, { ...opts, headers });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || "İstek başarısız");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function userInitial(name) {
  const ch = String(name || "N").trim().charAt(0);
  return ch ? ch.toLocaleUpperCase("tr-TR") : "N";
}

function isMusavir(user) {
  return ((user && user.businesses) || []).some((b) => b.role === "musavir");
}

function applyRoleNav(user) {
  const musavir = isMusavir(user);
  document.querySelectorAll(".nav-musavir-only").forEach((el) => {
    el.hidden = !musavir;
  });
  const invite = document.querySelector(".invite-btn");
  if (invite) invite.hidden = musavir;
}

function paintUserMenu(user) {
  const full = (user && user.ad_soyad) || "Nurşen";
  const first = full.trim().split(/\s+/)[0] || "Nurşen";
  const businesses = (user && user.businesses) || [];
  const activeId = activeBusinessId() || (user && user.activeBusinessId) || "";
  const active = businesses.find((b) => b.id === activeId) || businesses[0];
  const role = active && active.role === "musavir" ? "Mali Müşavir" : "İşletme Yöneticisi";
  const nameEl = document.getElementById("user-name");
  const roleEl = document.getElementById("user-role");
  const avatar = document.getElementById("user-avatar");
  if (nameEl) nameEl.textContent = first;
  if (roleEl) roleEl.textContent = role;
  if (avatar) avatar.textContent = userInitial(first);
  const sorumlu = document.getElementById("sorumlu-musavir");
  if (sorumlu) sorumlu.value = full;
  applyRoleNav(user);
}

async function applyUserMenu() {
  let user = getSessionUser();
  paintUserMenu(user);
  const token = localStorage.getItem("token");
  if (!token) return;
  try {
    const data = await apiFetch("/api/auth/me");
    if (data && data.ad_soyad) {
      const list = data.businesses || [];
      const current = activeBusinessId();
      const stillValid = current && list.some((b) => b.id === current);
      if (!stillValid && data.activeBusinessId) setActiveBusinessId(data.activeBusinessId);
      saveSessionUser(data);
      paintUserMenu(data);
      fillSettingsUser(data);
      if (document.body.dataset.page === "accountant" && !isMusavir(data)) {
        window.location.replace("settings.html#account");
      }
    }
  } catch {}
}

/* --- Bildirim zili: vadesi yaklaşan/geçen faturalar için otomatik hatırlatmalar --- */
let _notifPollHandle = null;

function dateTrShort(d) {
  return d ? new Date(d).toLocaleDateString("tr-TR") : "";
}

function paintNotifBadge(count) {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  if (!count) {
    badge.hidden = true;
    badge.textContent = "0";
  } else {
    badge.hidden = false;
    badge.textContent = count > 9 ? "9+" : String(count);
  }
}

async function loadNotifUnreadCount() {
  try {
    const data = await apiFetch("/api/notifications/unread-count");
    paintNotifBadge(data.count || 0);
  } catch {}
}

async function loadNotifList() {
  const list = document.getElementById("notif-list");
  if (!list) return;
  list.innerHTML = '<p class="muted notif-empty">Yükleniyor…</p>';
  try {
    // Panel her açıldığında güncel veriyle taransın (arka plan zamanlayıcısını beklemeden).
    await apiFetch("/api/notifications/sweep", { method: "POST" }).catch(() => {});
    const items = await apiFetch("/api/notifications");
    renderNotifList(items || []);
    const unread = (items || []).filter((n) => n.durum === "okunmadi").length;
    paintNotifBadge(unread);
  } catch (err) {
    list.innerHTML = `<p class="muted notif-empty">Bildirimler alınamadı.</p>`;
  }
}

function renderNotifList(items) {
  const list = document.getElementById("notif-list");
  if (!list) return;
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = '<p class="muted notif-empty">Bildiriminiz yok.</p>';
    return;
  }
  items.forEach((n) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notif-item" + (n.durum === "okunmadi" ? " is-unread" : "");
    btn.dataset.id = n.id;
    btn.innerHTML = `
      <span class="notif-item-top"><span class="notif-item-dot"></span><span class="notif-item-msg"></span></span>
      <span class="notif-item-time"></span>`;
    btn.querySelector(".notif-item-msg").textContent = n.mesaj;
    btn.querySelector(".notif-item-time").textContent = dateTrShort(n.created_at);
    btn.addEventListener("click", async () => {
      if (n.durum === "okunmadi") {
        await markNotificationRead(n.id);
        btn.classList.remove("is-unread");
      }
      window.location.href = "invoices.html";
    });
    list.appendChild(btn);
  });
}

async function markNotificationRead(id) {
  try {
    await apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
    loadNotifUnreadCount();
  } catch {}
}

async function markAllNotificationsRead() {
  try {
    await apiFetch("/api/notifications/read-all", { method: "POST" });
    document.querySelectorAll(".notif-item.is-unread").forEach((el) => el.classList.remove("is-unread"));
    paintNotifBadge(0);
  } catch {}
}

function initNotifBell() {
  loadNotifUnreadCount();
  if (_notifPollHandle) clearInterval(_notifPollHandle);
  // Sayfa açık kaldığı sürece rozet düzenli tazelensin.
  _notifPollHandle = setInterval(loadNotifUnreadCount, 60000);
}

function fillSettingsUser(user) {
  if (!user || document.body.dataset.page !== "settings") return;
  const name = document.getElementById("set-ad-soyad");
  const email = document.getElementById("set-email");
  const full = user.ad_soyad || "";
  if (name && !name.dataset.dirty) name.value = full;
  if (email && !email.dataset.dirty) email.value = user.email || "";

  const businesses = user.businesses || [];
  const activeId = activeBusinessId() || user.activeBusinessId || "";
  const active = businesses.find((b) => b.id === activeId) || businesses[0];
  const role = active && active.role === "musavir" ? "Mali Müşavir" : "İşletme Yöneticisi";
  const heroName = document.getElementById("set-hero-name");
  const heroEmail = document.getElementById("set-hero-email");
  const heroRole = document.getElementById("set-hero-role");
  const heroAvatar = document.getElementById("set-avatar");
  const rolInput = document.getElementById("set-rol");
  if (heroName) heroName.textContent = full || "Hesabım";
  if (heroEmail) heroEmail.textContent = user.email || "E-posta yok";
  if (heroRole) heroRole.textContent = role;
  if (heroAvatar) heroAvatar.textContent = userInitial(full || user.email || "?");
  if (rolInput) rolInput.value = role;
}

const FIRMA_PROFIL_FIELDS = {
  "set-isletme": "isletme_adi",
  "set-vergi-no": "vergi_no",
  "set-vergi-dairesi": "vergi_dairesi",
  "set-firma-telefon": "telefon",
  "set-firma-email": "email",
  "set-firma-sehir": "sehir",
  "set-firma-adres": "adres",
};

async function loadFirmaProfil() {
  const form = document.getElementById("form-firma-profil");
  if (!form) return;
  const businessId = activeBusinessId();
  if (!businessId) return;

  try {
    const list = await apiFetch("/api/businesses");
    const biz = list.find((b) => b.id === businessId) || list[0];
    if (!biz) return;

    form.dataset.businessId = biz.id;
    Object.entries(FIRMA_PROFIL_FIELDS).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el && !el.dataset.dirty) el.value = biz[key] || "";
    });

    const readOnly = biz.role !== "sahip";
    const note = document.getElementById("firma-profil-readonly-note");
    if (note) note.hidden = !readOnly;
    Object.keys(FIRMA_PROFIL_FIELDS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = readOnly;
    });
    const submitBtn = form.querySelector("button[type=submit]");
    if (submitBtn) submitBtn.disabled = readOnly;
  } catch (err) {
    showToast(err.message || "Firma bilgileri alınamadı", "error");
  }
}

function initSettingsPage() {
  const user = getSessionUser();
  fillSettingsUser(user);
  loadFirmaProfil();

  const hash = (location.hash || "").replace("#", "");
  if (hash) {
    const tab = document.querySelector(`[data-tabs] [data-tab="${hash}"]`);
    tab?.click();
  }

  document.getElementById("form-account")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const ad = document.getElementById("set-ad-soyad")?.value.trim();
    const mail = document.getElementById("set-email")?.value.trim();
    const pass = document.getElementById("set-sifre")?.value;
    const pass2 = document.getElementById("set-sifre-tekrar")?.value;
    if (pass || pass2) {
      if (pass.length < 6) {
        showToast("Şifre en az 6 karakter olmalı", "error");
        return;
      }
      if (pass !== pass2) {
        showToast("Şifreler eşleşmiyor", "error");
        return;
      }
    }
    const current = getSessionUser() || {};
    saveSessionUser({ ...current, ad_soyad: ad, email: mail });
    paintUserMenu(getSessionUser());
    showToast("Hesap bilgileri kaydedildi");
    document.getElementById("set-sifre").value = "";
    document.getElementById("set-sifre-tekrar").value = "";
  });

  document.getElementById("form-notify")?.addEventListener("submit", (e) => {
    e.preventDefault();
    showToast("Bildirim tercihleri kaydedildi");
  });

  document.getElementById("form-firma-profil")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const businessId = form.dataset.businessId || activeBusinessId();
    if (!businessId) {
      showToast("Aktif işletme bulunamadı", "error");
      return;
    }
    const isletmeAdi = document.getElementById("set-isletme")?.value.trim();
    if (!isletmeAdi) {
      showToast("İşletme unvanı zorunlu", "error");
      return;
    }
    const body = { isletme_adi: isletmeAdi };
    Object.entries(FIRMA_PROFIL_FIELDS).forEach(([id, key]) => {
      if (key === "isletme_adi") return;
      body[key] = document.getElementById(id)?.value.trim() || null;
    });

    const submitBtn = form.querySelector("button[type=submit]");
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiFetch("/api/businesses/" + businessId, { method: "PATCH", body });
      Object.keys(FIRMA_PROFIL_FIELDS).forEach((id) => {
        const el = document.getElementById(id);
        if (el) delete el.dataset.dirty;
      });
      showToast("Firma profili kaydedildi");
    } catch (err) {
      showToast(err.message || "Firma profili kaydedilemedi", "error");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById("btn-invite-accountant")?.addEventListener("click", () => {
    const mail = document.getElementById("set-invite-email")?.value.trim();
    if (!mail) {
      showToast("Müşavir e-postasını yazın", "error");
      return;
    }
    showToast("Davet e-postası gönderildi");
  });

  ["set-ad-soyad", "set-email", ...Object.keys(FIRMA_PROFIL_FIELDS)].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      e.target.dataset.dirty = "1";
    });
  });
}

function applyCompanyContext() {
  let name = "";
  try { name = sessionStorage.getItem("cf_company") || ""; } catch {}
  if (!name || document.body.classList.contains("auth-page")) return;
  document.querySelector(".context-banner")?.remove();
  const bar = document.createElement("div");
  bar.className = "context-banner";
  bar.setAttribute("role", "status");
  bar.innerHTML = `
    <div class="context-banner-main">
      <span class="context-banner-badge">Aktif işletme</span>
      <p class="context-banner-text"><strong>${escapeHtml(name)}</strong> adına işlem yapıyorsunuz</p>
    </div>
    <button type="button" id="exit-firm-context">Kendi hesabıma dön</button>`;
  const header = document.getElementById("header-container");
  if (header) header.insertAdjacentElement("afterend", bar);
  else document.querySelector(".main")?.prepend(bar);
  document.body.classList.add("has-firm-context");
  document.getElementById("exit-firm-context")?.addEventListener("click", () => {
    try { sessionStorage.removeItem("cf_company"); } catch {}
    setActiveBusinessId(null);
    bar.remove();
    document.body.classList.remove("has-firm-context");
    showToast("Kendi hesabınıza döndünüz");
  });
}

function downloadSimplePdf(filename, title, rows) {
  const latin = (s) => String(s)
    .replace(/₺/g, "TL ")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[ıİ]/g, "i")
    .replace(/[^\x20-\x7E]/g, " ");
  const escapePdf = (s) => latin(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const lines = [title, ""].concat(rows || []);
  let content = "BT\n/F1 16 Tf\n50 780 Td\n";
  lines.forEach((line, i) => {
    if (i === 0) content += `(${escapePdf(line)}) Tj\n/F1 11 Tf\n0 -24 Td\n`;
    else content += `(${escapePdf(line)}) Tj\n0 -16 Td\n`;
  });
  content += "ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const blob = new Blob([pdf], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function showToast(message, type = "success") {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

let _activeSpeechRecognition = null;
let _activeMicStream = null;

function stopMicStream() {
  if (_activeMicStream) {
    _activeMicStream.getTracks().forEach((t) => t.stop());
    _activeMicStream = null;
  }
}

async function startSpeechToText(inputEl, micBtn, onEnd) {
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) {
    showToast("Ses tanıma bu tarayıcıda yok. Chrome kullanın.", "error");
    return;
  }

  // İkinci tık = bitir
  if (_activeSpeechRecognition) {
    try {
      _activeSpeechRecognition.stop();
    } catch {}
    return;
  }

  if (window.speechSynthesis) window.speechSynthesis.cancel();

  const wrap = micBtn.closest(".input-mic") || micBtn.closest(".cf-asst-form");
  const originalTitle = micBtn.title;
  const originalPlaceholder = inputEl.placeholder;

  let finalTranscript = "";
  let interimTranscript = "";
  let finished = false;
  let watchTimer = null;
  let levelTimer = null;

  function paintInput() {
    const text = [finalTranscript, interimTranscript].filter(Boolean).join(" ").trim();
    inputEl.value = text;
  }

  function cleanupUi() {
    micBtn.classList.remove("mic-listening");
    micBtn.setAttribute("aria-pressed", "false");
    wrap?.classList.remove("listening");
    micBtn.title = originalTitle;
    inputEl.placeholder = originalPlaceholder || "Sorunuzu yazın veya konuşun...";
    micBtn.style.removeProperty("--mic-level");
    if (watchTimer) clearTimeout(watchTimer);
    if (levelTimer) clearInterval(levelTimer);
    watchTimer = null;
    levelTimer = null;
    _activeSpeechRecognition = null;
    stopMicStream();
  }

  function finish() {
    if (finished) return;
    finished = true;
    try {
      if (_activeSpeechRecognition) _activeSpeechRecognition.stop();
    } catch {}
    const spoken = (finalTranscript || interimTranscript || inputEl.value || "").trim();
    cleanupUi();
    if (spoken) {
      inputEl.value = spoken;
      if (typeof onEnd === "function") onEnd(spoken);
    } else {
      showToast("Metin algılanamadı. Yazıp Gönder’e basabilir veya tekrar deneyin.", "error");
    }
  }

  // 1) Önce gerçek mikrofon erişimi — tanıma çoğu zaman bundan sonra çalışır
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("Mikrofon API’si yok. HTTPS veya localhost + Chrome gerekli.", "error");
      return;
    }
    _activeMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    showToast("Mikrofon izni gerekli. Adres çubuğundan izin verin.", "error");
    return;
  }

  // Ses seviyesi göstergesi (mik gerçekten çalışıyor mu?)
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(_activeMicStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    levelTimer = setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length / 255;
      micBtn.style.setProperty("--mic-level", String(Math.min(1, avg * 3)));
      if (avg > 0.05) inputEl.placeholder = "Sizi duyuyorum… konuşmaya devam";
    }, 100);
    micBtn._audioCtx = audioCtx;
  } catch {}

  const recognition = new SpeechRecognitionImpl();
  _activeSpeechRecognition = recognition;
  recognition.lang = "tr-TR";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  micBtn.classList.add("mic-listening");
  micBtn.setAttribute("aria-pressed", "true");
  wrap?.classList.add("listening");
  micBtn.title = "Dinleniyor… Bitirmek için tekrar tıklayın";
  inputEl.placeholder = "Şimdi net konuşun…";
  inputEl.value = "";
  showToast("Mikrofon açık — şimdi konuşun (örn. yeni fatura aç)");

  recognition.onresult = (event) => {
    interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = (event.results[i][0].transcript || "").trim();
      if (!piece) continue;
      if (event.results[i].isFinal) finalTranscript = (finalTranscript + " " + piece).trim();
      else interimTranscript = piece;
    }
    paintInput();
    // Final parça geldiyse hemen işle
    if (finalTranscript) {
      setTimeout(() => finish(), 150);
    }
  };

  recognition.onerror = (event) => {
    const err = event.error;
    if (err === "aborted") return;
    if (err === "not-allowed" || err === "service-not-allowed") {
      finished = true;
      cleanupUi();
      showToast("Mikrofon engelli. Chrome ayarlarından izin verin.", "error");
      return;
    }
    if (err === "network") {
      finished = true;
      cleanupUi();
      showToast("Ses tanıma internet ister. Bağlantıyı kontrol edin.", "error");
      return;
    }
    if (err === "no-speech") {
      // Bir tur daha dene
      try {
        recognition.start();
        return;
      } catch {
        finish();
      }
      return;
    }
    showToast("Ses hatası: " + err, "error");
    finish();
  };

  recognition.onend = () => {
    if (finished) return;
    if (finalTranscript || interimTranscript) {
      finish();
      return;
    }
    // Tek yeniden deneme
    if (!recognition._retried) {
      recognition._retried = true;
      try {
        recognition.start();
        return;
      } catch {}
    }
    finish();
  };

  watchTimer = setTimeout(() => finish(), 10000);

  try {
    recognition.start();
  } catch (e) {
    finished = true;
    cleanupUi();
    showToast("Ses tanıma başlatılamadı.", "error");
  }
}

function foldTr(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CF_ASSISTANT_PAGES = {
  dashboard: {
    title: "Ana Sayfa",
    hello: "Ana sayfadasınız. Nakit, gelir ve gider özetini buradan görürsünüz. Ne takıldı?",
    chips: ["Fatura nasıl kesilir?", "Nakit özeti ne anlama geliyor?", "Müşavirimi nasıl davet ederim?"],
  },
  invoices: {
    title: "Faturalar",
    hello: "Kesilmiş faturalar burada. Detaya tıklayın, PDF alın veya yeni fatura kesin.",
    chips: ["Yeni fatura nasıl kesilir?", "Fatura durumları ne demek?", "PDF nasıl alınır?"],
  },
  "invoice-new": {
    title: "Yeni Fatura",
    hello: "Bu ekranda müşteri, kalem, KDV ve vade girerek e-fatura kesersiniz. Sesle de yazabilirsiniz.",
    chips: ["KDV nasıl hesaplanır?", "Sesle nasıl yazarım?", "Tekrarlayan fatura nedir?"],
  },
  "invoice-template": {
    title: "Otomatik Fatura",
    hello: "Kira, aidat gibi her ay kesilen faturalar için şablon kurarsınız. Belirlediğiniz günde otomatik oluşur.",
    chips: ["Tekrarlayan fatura nedir?", "Ne sıklıkta kesilir?", "Şablon nasıl kaydedilir?"],
  },
  expenses: {
    title: "Giderler",
    hello: "Alış fişleriniz ve giderleriniz bu listede. Yeni fiş yüklemek için sağdaki + veya Yeni Gider sayfasına gidin.",
    chips: ["Fiş nasıl yüklenir?", "Gider kategorileri neler?", "OCR ne işe yarar?"],
  },
  "expense-new": {
    title: "Yeni Gider",
    hello: "Fiş fotoğrafını sürükleyin; tutar ve KDV otomatik dolsun. Elle de girebilirsiniz.",
    chips: ["Fiş nasıl yüklenir?", "OCR ne doldurur?", "KDV alış nedir?"],
  },
  accounts: {
    title: "Cari Hesaplar",
    hello: "Müşteri ve tedarikçileriniz burada. Bakiye tutarı, Durum sütunu alacak veya borç olduğunu gösterir.",
    chips: ["Alacak ve borç farkı nedir?", "Bu cariye fatura nasıl kesilir?", "Yeni cari nasıl eklenir?"],
  },
  reports: {
    title: "Raporlar",
    hello: "Aylık gelir-gider ve KDV özetini buradan bakarsınız. PDF Rapor Al ile indirebilirsiniz.",
    chips: ["PDF rapor nasıl alınır?", "KDV özeti ne gösterir?", "Nakit akışı nedir?"],
  },
  accountant: {
    title: "Muhasebeci Paneli",
    hello: "Mali müşavir buradan işletmelere bağlanır. İşletmeye Geçiş Yap deyince o firma adına işlem açılır.",
    chips: ["İşletmeye nasıl geçerim?", "Muhasebeci nasıl davet edilir?", "Bağlı işletme nedir?"],
  },
  settings: {
    title: "Ayarlar",
    hello: "Paket, firma profili ve GİB e-fatura sekmeleri burada. Üstteki sekmelerden geçin.",
    chips: ["Paketler neler?", "GİB entegrasyonu ne işe yarar?", "Firma bilgisi nerede?"],
  },
};

const CF_ASSISTANT_KB = [
  {
    q: "Fatura nasıl kesilir?",
    keys: ["fatura", "kes", "yeni fatura", "e fatura", "efatura", "nasil kesilir"],
    pages: ["dashboard", "invoices", "invoice-new", "accounts"],
    text: "Soldan Yeni Fatura’ya gidin (veya Faturalar’da +). Cari seçin, kalem ekleyin, KDV oranını girin. Kaydet deyince fatura listesine düşer.",
    href: "invoice-new.html",
    hrefLabel: "Yeni fatura aç",
  },
  {
    q: "KDV nasıl hesaplanır?",
    keys: ["kdv", "vergi", "oran", "yuzde 20", "hesap"],
    pages: ["invoice-new", "invoice-template", "expense-new", "reports"],
    text: "Kalemde birim fiyat × miktar matrahtır. KDV = matrah × oran (genelde %20). Satır toplamı matrah + KDV’dir. Sistem satır toplamını kendisi günceller. Mevzuat sorusu için mali müşavirinize sorun.",
  },
  {
    q: "Sesle nasıl yazarım?",
    keys: ["ses", "mikrofon", "konus", "konusarak", "yazdir", "dikte"],
    pages: ["invoice-new", "invoice-template"],
    text: "Fatura notu veya kalem yanındaki mikrofon simgesine basın, Chrome veya Edge’de konuşun. Metin alana yazılır. Bu asistan panelindeki mikrofonda da soru sorabilirsiniz.",
  },
  {
    q: "Tekrarlayan fatura nedir?",
    keys: ["tekrar", "otomatik", "sablon", "kira", "aidat", "her ay"],
    pages: ["invoice-new", "invoice-template", "invoices", "dashboard"],
    text: "Aylık kira veya aidat gibi düzenli kesilen faturalardır. Yeni Fatura’da “her ay otomatik tekrarla”yı açın veya Otomatik Fatura’dan şablon kaydedin. Belirlediğiniz günde yeni fatura oluşur.",
    href: "invoice-template.html",
    hrefLabel: "Şablon sayfasına git",
  },
  {
    q: "Ne sıklıkta kesilir?",
    keys: ["siklik", "aylik", "haftalik", "yillik"],
    pages: ["invoice-template"],
    text: "Şablonda sıklığı Aylık, Haftalık, 3 Aylık veya Yıllık seçersiniz. Sonraki fatura tarihi, bir sonraki otomatik kesim günüdür.",
  },
  {
    q: "Şablon nasıl kaydedilir?",
    keys: ["sablon", "kaydet", "otomatik sablon"],
    pages: ["invoice-template"],
    text: "Cari, sıklık, tutar ve KDV’yi doldurup Otomatik Şablonu Kaydet’e basın. Kayıt Faturalar listesine bağlanır.",
  },
  {
    q: "Fatura durumları ne demek?",
    keys: ["durum", "taslak", "gonderildi", "odendi", "gecikti"],
    pages: ["invoices"],
    text: "Taslak henüz GİB’e gitmemiştir. Gönderildi müşteriye iletilmiştir. Ödendi tahsil edilmiştir. Gecikti vadesi geçmiştir — cari bakiyede alacak olarak durur.",
  },
  {
    q: "PDF nasıl alınır?",
    keys: ["pdf", "indir", "yazdir", "rapor al"],
    pages: ["invoices", "reports"],
    text: "Fatura detayında PDF, Raporlar’da PDF Rapor Al butonunu kullanın. Özet dosya indirilir; tarayıcı yazdırma penceresi açılmaz.",
    href: "reports.html",
    hrefLabel: "Raporlara git",
  },
  {
    q: "Fiş nasıl yüklenir?",
    keys: ["fis", "yukle", "gider", "fotograf", "surukle", "ocr"],
    pages: ["expenses", "expense-new", "dashboard"],
    text: "Giderler → Yeni Gider. Fiş fotoğrafını kutuya sürükleyin veya tıklayıp seçin. Tutar, KDV ve firma alanı dolmaya çalışır; kontrol edip kaydedin.",
    href: "expense-new.html",
    hrefLabel: "Fiş yükle",
  },
  {
    q: "OCR ne işe yarar?",
    keys: ["ocr", "tara", "okuma", "kamera", "fis tara"],
    pages: ["expenses", "expense-new"],
    text: "OCR, fiş görselinden tutar ve KDV okumayı dener. Sonuç yanlışsa elle düzeltin. Kaynak alanında OCR yazar.",
  },
  {
    q: "OCR ne doldurur?",
    keys: ["ocr doldur", "hangi alan", "tutar kdv"],
    pages: ["expense-new"],
    text: "Deneme taramasında firma adı, tutar, KDV, kategori ve kısa açıklama doldurulur. Kaydetmeden önce rakamları kontrol edin.",
  },
  {
    q: "Gider kategorileri neler?",
    keys: ["kategori", "ofis", "yakit", "kira gider"],
    pages: ["expenses", "expense-new"],
    text: "Listede Ofis, Ulaşım, Kira gibi kategorilerle filtreleyebilirsiniz. Yeni giderde kategoriyi siz seçersiniz; raporlarda gruplanır.",
  },
  {
    q: "Alacak ve borç farkı nedir?",
    keys: ["alacak", "borc", "bakiye", "durum", "dengede"],
    pages: ["accounts"],
    text: "Bakiye sütunu tutardır. Durum Alacak ise müşteri size borçlu, Borç ise siz tedarikçiye borçlusunuz, Dengede ise net sıfırdır.",
  },
  {
    q: "Bu cariye fatura nasıl kesilir?",
    keys: ["bu cariye", "cariye fatura", "musteriye kes"],
    pages: ["accounts"],
    text: "Cari satırına tıklayıp çekmeceden Bu Cariye Fatura Kes deyin. Yeni fatura o müşteriyle açılır.",
    href: "invoice-new.html",
    hrefLabel: "Fatura kes",
  },
  {
    q: "Yeni cari nasıl eklenir?",
    keys: ["yeni cari", "musteri ekle", "tedarikci"],
    pages: ["accounts"],
    text: "Cari Hesaplar’da Yeni Cari veya sağ alttaki + ile formu açın. Unvan ve vergi no girip kaydedin.",
  },
  {
    q: "Nakit özeti ne anlama geliyor?",
    keys: ["nakit", "ozet", "dashboard", "ana sayfa", "gelir gider"],
    pages: ["dashboard"],
    text: "Toplam Nakit kasadaki para, Bu Ay Gelir kesilen faturalar, Bu Ay Gider fişler, Bekleyen Tahsilat vadesi gelmemiş alacaklardır. Hızlı İşlemler’den fatura veya gider açarsınız.",
  },
  {
    q: "Nakit akışı nedir?",
    keys: ["nakit akisi", "tahmin", "grafik"],
    pages: ["reports", "dashboard"],
    text: "Giren para (tahsilat) eksi çıkan para (gider). Raporlar’da aya göre bakarsınız. Pozitifse kasa büyür.",
  },
  {
    q: "KDV özeti ne gösterir?",
    keys: ["kdv ozet", "kdv satis", "kdv alis", "net kdv"],
    pages: ["reports"],
    text: "KDV Satış kestiğiniz faturalardaki KDV, KDV Alış gider fişlerindeki KDV, Net KDV aradaki farktır. Beyan rakamı mali müşavirinizle netleşir; asistan hukuki tavsiye vermez.",
  },
  {
    q: "PDF rapor nasıl alınır?",
    keys: ["pdf rapor", "rapor indir"],
    pages: ["reports"],
    text: "Raporlar sayfasında PDF Rapor Al’a basın. Dönem özeti indirilir.",
  },
  {
    q: "İşletmeye nasıl geçerim?",
    keys: ["isletmeye gec", "firma adi na", "switch", "gecis yap"],
    pages: ["accountant"],
    text: "Muhasebeci Paneli’nde işletme satırında İşletmeye Geçiş Yap’a tıklayın. Üstte o firma adına işlem yaptığınız yazılır. Bitince Kendi hesabıma dön deyin.",
  },
  {
    q: "Muhasebeci nasıl davet edilir?",
    keys: ["muhasebeci", "davet", "musteri temsilci", "mali musavir"],
    pages: ["accountant", "dashboard", "settings"],
    text: "Mali müşavir hesabıyla Muhasebeci Paneli’nden işletme bağlar. Davet / bağla adımı panelde. Bağlandıktan sonra o KOBİ’nin fatura ve giderine bakabilir.",
  },
  {
    q: "Müşavirimi nasıl davet ederim?",
    keys: ["musteri davet", "muhasebecimi"],
    pages: ["dashboard", "accountant"],
    text: "Muhasebeci Paneli’nden işletme bağlanır. Siz KOBİ iseniz mali müşavirinizin e-postasıyla davet / bağlama adımını kullanın; o da aynı panele girer.",
    href: "accountant.html",
    hrefLabel: "Müşavir paneline git",
  },
  {
    q: "Bağlı işletme nedir?",
    keys: ["bagli isletme", "bagli firma"],
    pages: ["accountant"],
    text: "Müşavirin yetkili olduğu KOBİ hesaplarıdır. Geçiş yapınca o işletmenin dashboard’u açılır; veriler karışmaz.",
  },
  {
    q: "Paketler neler?",
    keys: ["paket", "abonelik", "kobi", "ucretsiz", "fiyat", "299"],
    pages: ["settings"],
    text: "Ücretsiz: aylık 10 fatura. KOBİ (₺299): sınırsız fatura ve otomatik tekrar. Muhasebeci paketi çoklu işletme içindir. Ayarlar → Abonelik sekmesi.",
  },
  {
    q: "GİB entegrasyonu ne işe yarar?",
    keys: ["gib", "efatura entegrasyon", "gelir idaresi"],
    pages: ["settings"],
    text: "Ayarlar → GİB sekmesi e-faturayı Gelir İdaresi’ne bağlamak içindir. Anahtar ve ortam bilgisi burada. Canlı kesim için müşavirinizle doğrulayın; bu asistan GİB işlemi başlatmaz.",
  },
  {
    q: "Firma bilgisi nerede?",
    keys: ["firma profil", "unvan", "vergi no", "sirket bilg"],
    pages: ["settings"],
    text: "Ayarlar → Firma Profil Bilgileri. Unvan, vergi dairesi ve adres fatura üstbilgisinde kullanılır.",
  },
  {
    q: "CepteFatura nedir?",
    keys: ["ceptefatura", "nedir", "bu site", "ne ise yarar", "akilli muhasebe"],
    pages: [],
    text: "CepteFatura, KOBİ ve esnaf için fatura, gider, cari ve rapor uygulamasıdır. Mali müşavir aynı panele bağlanır. E-fatura keser, fiş yüklersiniz, nakit özetini görürsünüz.",
  },
];

function resolveVoiceCommand(message) {
  const q = foldTr(message);
  if (!q) return null;

  const rules = [
    {
      test: /(yeni\s*fatura|fatura\s*kes|fatura\s*olustur|fatura\s*ac)/,
      href: "invoice-new.html",
      label: "Yeni Fatura",
      text: "Yeni fatura sayfasını açıyorum.",
    },
    {
      test: /(otomatik\s*fatura|tekrarlayan|sablon)/,
      href: "invoice-template.html",
      label: "Otomatik Fatura",
      text: "Otomatik fatura şablonuna gidiyorum.",
    },
    {
      test: /(gelen\s*fatura)/,
      href: "incoming-invoices.html",
      label: "Gelen Faturalar",
      text: "Gelen faturalar listesini açıyorum.",
    },
    {
      test: /(faturalar|fatura\s*listesi|faturalara\s*(git|ac|goster))/,
      href: "invoices.html",
      label: "Giden Faturalar",
      text: "Giden faturalar listesini açıyorum.",
    },
    {
      test: /(yeni\s*gider|gider\s*(ekle|kaydet|ac)|fis\s*(yukle|tara|ac)|ocr)/,
      href: "expense-new.html",
      label: "Yeni Gider",
      text: "Yeni gider / fiş yükleme sayfasını açıyorum.",
    },
    {
      test: /(giderler|gider\s*listesi)/,
      href: "expenses.html",
      label: "Giderler",
      text: "Giderler sayfasını açıyorum.",
    },
    {
      test: /(cari|musteri\s*listesi|carilere)/,
      href: "accounts.html",
      label: "Cari Hesaplar",
      text: "Cari hesaplar sayfasını açıyorum.",
    },
    {
      test: /(rapor|kdv\s*ozet|nakit\s*ozet)/,
      href: "reports.html",
      label: "Raporlar",
      text: "Raporlar sayfasını açıyorum.",
    },
    {
      test: /(muhasebeci|mali\s*musavir|musavir\s*panel)/,
      href: "accountant.html",
      label: "Muhasebeci Paneli",
      text: "Muhasebeci panelini açıyorum.",
    },
    {
      test: /(ayarlar|abonelik|gib)/,
      href: "settings.html",
      label: "Ayarlar",
      text: "Ayarlar sayfasını açıyorum.",
    },
    {
      test: /(ana\s*sayfa|dashboard|panele\s*don|basa\s*don)/,
      href: "dashboard.html",
      label: "Ana Sayfa",
      text: "Ana sayfaya gidiyorum.",
    },
  ];

  for (const rule of rules) {
    if (rule.test.test(q)) {
      return {
        text: rule.text,
        href: rule.href,
        hrefLabel: rule.label + " →",
        autoNav: true,
      };
    }
  }
  return null;
}

function localAssistantAnswer(message, page) {
  const nav = resolveVoiceCommand(message);
  if (nav) return nav;

  const q = foldTr(message);
  if (!q) {
    return { text: "Bir soru yazın, mikrofona basıp konuşun veya hazır sorulardan birine tıklayın." };
  }

  const exact = CF_ASSISTANT_KB.find((item) => foldTr(item.q) === q);
  if (exact) return exact;

  let best = null;
  let bestScore = 0;
  CF_ASSISTANT_KB.forEach((item) => {
    let score = 0;
    item.keys.forEach((key) => {
      if (q.includes(key) || key.split(" ").every((w) => q.includes(w))) score += key.length > 8 ? 3 : 2;
    });
    foldTr(item.q).split(" ").forEach((w) => {
      if (w.length > 3 && q.includes(w)) score += 1;
    });
    if (item.pages.includes(page)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });

  if (best && bestScore >= 3) return best;

  return {
    text: "Bunu net bilemedim. Örnek: “yeni fatura aç”, “giderlere git”, “cari hesaplar”, “raporları göster”. Veya fatura / fiş / cari hakkında sorun.",
  };
}

async function askCepteAsistan(message, page) {
  const nav = resolveVoiceCommand(message);
  if (nav) return nav;

  const token = localStorage.getItem("token");
  const bizId = typeof activeBusinessId === "function" ? activeBusinessId() : "";
  try {
    const res = await fetch("/api/assistant/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(bizId ? { "X-Business-Id": bizId } : {}),
      },
      body: JSON.stringify({ message, page }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.reply || data.text) {
        return {
          text: data.reply || data.text,
          href: data.href,
          hrefLabel: data.hrefLabel,
          pending_action: data.pending_action,
        };
      }
    }
  } catch {}
  return localAssistantAnswer(message, page);
}

function mountCepteAsistan(page) {
  if (document.getElementById("cf-asst")) return;
  const meta = CF_ASSISTANT_PAGES[page] || {
    title: "CepteFatura",
    hello: "Site hakkında sorun. Fatura, gider, cari veya rapor için yardımcı olurum.",
    chips: ["Fatura nasıl kesilir?", "Fiş nasıl yüklenir?", "CepteFatura nedir?"],
  };

  const root = document.createElement("div");
  root.id = "cf-asst";
  root.className = "cf-asst";
  root.innerHTML = `
    <div class="cf-asst-panel" hidden>
      <div class="cf-asst-head">
        <img src="../assets/img/logo-icon.png" alt="" width="28" height="28">
        <div>
          <strong>Cepte Asistan</strong>
          <span>${escapeHtml(meta.title)}</span>
        </div>
        <button type="button" class="cf-asst-iconbtn" data-asst-voice title="Sesli cevap açık" aria-pressed="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        </button>
        <button type="button" class="cf-asst-iconbtn" data-asst-close title="Kapat" aria-label="Kapat">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div class="cf-asst-msgs" data-asst-msgs></div>
      <form class="cf-asst-form" data-asst-form>
        <input type="text" data-asst-input placeholder="Sorunuzu yazın veya konuşun..." autocomplete="off">
        <button type="button" class="cf-asst-iconbtn" data-asst-mic title="Sesle sor">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
        </button>
        <button type="submit" class="cf-asst-send" title="Gönder">Gönder</button>
      </form>
    </div>
    <button type="button" class="cf-asst-fab" data-asst-toggle aria-label="Cepte Asistan">
      <img src="../assets/img/logo-icon.png" alt="" width="84" height="84">
    </button>`;
  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "cf-asst-backdrop";
  backdrop.setAttribute("aria-label", "Asistanı kapat");
  backdrop.tabIndex = -1;
  document.body.appendChild(backdrop);
  document.body.appendChild(root);

  const panel = root.querySelector(".cf-asst-panel");
  const msgs = root.querySelector("[data-asst-msgs]");
  const form = root.querySelector("[data-asst-form]");
  const input = root.querySelector("[data-asst-input]");
  const micBtn = root.querySelector("[data-asst-mic]");
  const voiceBtn = root.querySelector("[data-asst-voice]");
  let voiceOn = true;
  let busy = false;

  function speak(text) {
    if (!voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    u.rate = 1.04;
    const voices = window.speechSynthesis.getVoices();
    const tr = voices.find((v) => (v.lang || "").toLowerCase().startsWith("tr"));
    if (tr) u.voice = tr;
    window.speechSynthesis.speak(u);
  }

  function addMsg(role, item) {
    const el = document.createElement("div");
    el.className = "cf-asst-msg " + role;
    if (role === "user") {
      el.textContent = item;
    } else {
      const p = document.createElement("p");
      p.textContent = item.text;
      el.appendChild(p);
      if (item.href) {
        const a = document.createElement("a");
        a.className = "cf-asst-link";
        a.href = item.href;
        a.textContent = item.hrefLabel || "Sayfaya git";
        el.appendChild(a);
      }
      if (item.pending_action) {
        const action = item.pending_action;
        const actions = document.createElement("div");
        actions.className = "cf-asst-confirm";
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "cf-asst-confirm-yes";
        confirmBtn.textContent = action.label || "Onayla";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "cf-asst-confirm-no";
        cancelBtn.textContent = "Vazgeç";
        actions.appendChild(confirmBtn);
        actions.appendChild(cancelBtn);
        el.appendChild(actions);

        confirmBtn.addEventListener("click", async () => {
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          try {
            await apiFetch(action.endpoint, { method: action.method, body: action.payload });
            actions.remove();
            const doneP = document.createElement("p");
            doneP.className = "cf-asst-confirm-done";
            doneP.textContent = "Yapıldı.";
            el.appendChild(doneP);
            showToast((action.label || "İşlem") + " tamamlandı");
          } catch (err) {
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            showToast(err.message || "İşlem başarısız", "error");
          }
        });
        cancelBtn.addEventListener("click", () => {
          actions.remove();
          const cancelP = document.createElement("p");
          cancelP.className = "cf-asst-confirm-done";
          cancelP.textContent = "Vazgeçildi.";
          el.appendChild(cancelP);
        });
      }
    }
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addChips() {
    const wrap = document.createElement("div");
    wrap.className = "cf-asst-chips";
    meta.chips.forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => send(label));
      wrap.appendChild(btn);
    });
    msgs.appendChild(wrap);
  }

  function setOpen(open) {
    panel.hidden = !open;
    root.classList.toggle("is-open", open);
    document.body.classList.toggle("asst-open", open);
    if (open) {
      input.focus();
    } else if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  async function send(text) {
    const message = String(text || "").trim();
    if (!message || busy) return;
    busy = true;
    addMsg("user", message);
    input.value = "";
    const wait = document.createElement("div");
    wait.className = "cf-asst-msg bot pending";
    wait.textContent = "Bakıyorum...";
    msgs.appendChild(wait);
    msgs.scrollTop = msgs.scrollHeight;
    const answer = await askCepteAsistan(message, page);
    wait.remove();
    addMsg("bot", answer);
    // Sayfa açma komutlarını seslendirme (küçük ifadeler)
    if (answer.autoNav && answer.href) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      busy = false;
      showToast((answer.hrefLabel || "Sayfa") + " açılıyor…");
      setTimeout(() => {
        window.location.href = answer.href;
      }, 450);
      return;
    }
    speak(answer.text);
    busy = false;
  }

  addMsg("bot", {
    text: meta.hello + " Mikrofona basıp aşağıdaki kısa komutları söyleyin; yeşil yanınca konuşun, bitince mik’e tekrar basın.",
  });
  addChips();

  // Sesli komut kısayolları — tıklayınca da aynı (seslendirilmez)
  const navChips = document.createElement("div");
  navChips.className = "cf-asst-chips";
  [
    "yeni fatura aç",
    "giderlere git",
    "cari hesaplar",
    "raporları göster",
    "ana sayfa",
  ].forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = "Söyle veya tıkla — sayfa açılır, seslendirilmez";
    btn.addEventListener("click", () => send(label));
    navChips.appendChild(btn);
  });
  msgs.appendChild(navChips);

  root.querySelector("[data-asst-toggle]").addEventListener("click", () => {
    setOpen(panel.hidden);
  });
  root.querySelector("[data-asst-close]").addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  voiceBtn.addEventListener("click", () => {
    voiceOn = !voiceOn;
    voiceBtn.setAttribute("aria-pressed", voiceOn ? "true" : "false");
    voiceBtn.title = voiceOn ? "Sesli cevap açık" : "Sesli cevap kapalı";
    voiceBtn.classList.toggle("is-muted", !voiceOn);
    if (!voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  micBtn.addEventListener("click", () => {
    // Dinlerken tekrar tık = bitir (startSpeechToText içinde)
    startSpeechToText(input, micBtn, (value) => {
      if (value && value.trim()) send(value);
    });
  });
}
