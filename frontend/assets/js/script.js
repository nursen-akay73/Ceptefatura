document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;

  fetch("../components/sidebar.html")
    .then(r => r.text())
    .then(html => {
      const target = document.getElementById("sidebar-container");
      if (target) {
        target.innerHTML = html;
        const active = target.querySelector(`[data-page="${page}"]`);
        if (active) active.classList.add("active");
      }
    });

  fetch("../components/header.html")
    .then(r => r.text())
    .then(html => {
      const target = document.getElementById("header-container");
      if (target) target.innerHTML = html;
    });

  document.querySelectorAll("[data-demo-link]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-demo-link");
      if (target) window.location.href = target;
    });
  });

  document.querySelectorAll("form[data-demo-form]").forEach(form => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const redirect = form.dataset.redirect;
      if (redirect) window.location.href = redirect;
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
        <td><span class="muted">₺0,00</span></td>
        <td><button type="button" class="text-btn danger" data-remove-row>Sil</button></td>`;
      tbody.appendChild(row);
      row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());
    });
  });

  document.querySelectorAll("[data-remove-row]").forEach(btn => {
    btn.addEventListener("click", () => btn.closest("tr")?.remove());
  });
});