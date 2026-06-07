"use strict";
// Warehouse14 Begleiter — companion SPA logic.
//
// Served as a SEPARATE script (GET /app.js) so the strict CSP can use
// `script-src 'self'` with no `'unsafe-inline'`. All cloud-derived strings
// (product names, SKUs, cart line names) are rendered as textContent only —
// the el() helper has NO innerHTML / `html:` sink, so a malicious product
// name from the cloud can never inject markup into this DOM.
(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────
  var LS_TOKEN = "w14.companion.token";
  var LS_ROLE  = "w14.companion.role";
  var ROLES = {
    warehouse: { label: "Lager",         ico: "📦", desc: "Bestand & SKU-Suche" },
    cashier:   { label: "Zweitkasse",    ico: "💳", desc: "Zweiter Kassenplatz" },
    display:   { label: "Kundenanzeige", ico: "🖥️", desc: "Live-Warenkorb für Kunden" }
  };

  // ── State ──────────────────────────────────────────────────────────
  var token = localStorage.getItem(LS_TOKEN) || "";
  var role  = localStorage.getItem(LS_ROLE)  || "";
  var displayTimer = null;

  var app = document.getElementById("app");

  // ── Helpers ────────────────────────────────────────────────────────
  // NOTE: deliberately NO `html:` / innerHTML sink. Every text node goes
  // through document.createTextNode so cloud-derived strings render inert.
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function")
        n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmtEur(v) {
    var s = (v == null ? "0.00" : String(v)).replace(",", ".");
    var n = parseFloat(s);
    if (!isFinite(n)) n = 0;
    return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function stopDisplayTimer() { if (displayTimer) { clearInterval(displayTimer); displayTimer = null; } }

  // ── API (companion -> mother) ──────────────────────────────────────
  function pair(code, chosenRole) {
    return fetch("/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, role: chosenRole })
    }).then(function (r) {
      if (r.status === 429) throw new Error("Zu viele Versuche. Bitte kurz warten.");
      if (r.status === 403) throw new Error("Code oder Rolle ungültig.");
      if (!r.ok) throw new Error("Kopplung fehlgeschlagen (" + r.status + ").");
      return r.json();
    });
  }
  function getCart() {
    return fetch("/cart", { headers: { "X-Companion-Token": token } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { logout(); throw new Error("Sitzung abgelaufen."); }
        if (!r.ok) throw new Error("Warenkorb nicht verfügbar.");
        return r.json();
      });
  }
  function proxy(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers["X-Companion-Token"] = token;
    return fetch("/api/proxy/" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body
    }).then(function (r) {
      if (r.status === 401) { logout(); throw new Error("Sitzung abgelaufen."); }
      return r;
    });
  }

  // ── Session ────────────────────────────────────────────────────────
  function logout() {
    stopDisplayTimer();
    token = ""; role = "";
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ROLE);
    render();
  }

  // ── Top bar ────────────────────────────────────────────────────────
  function topbar() {
    var meta = ROLES[role];
    var brand = el("span", { class: "brand" }, [
      "Warehouse14 ",
      el("b", {}, "Begleiter")
    ]);
    return el("header", { class: "topbar" }, [
      brand,
      meta ? el("span", { class: "role-pill" }, meta.label) : null,
      el("button", { class: "btn-switch", onclick: function () {
        if (confirm("Rolle wechseln und abmelden?")) logout();
      } }, "Rolle wechseln")
    ]);
  }

  // ── Pairing screen ─────────────────────────────────────────────────
  function renderPairing() {
    stopDisplayTimer();
    clear(app);

    var chosen = "cashier";
    var codeVal = "";
    var busy = false;

    var errBox = el("div", { class: "err" });
    var submitBtn;

    function refresh() {
      submitBtn.disabled = busy || codeVal.length !== 6 || !chosen;
      submitBtn.textContent = busy ? "Wird gekoppelt…" : "Koppeln";
    }

    var codeInput = el("input", {
      class: "code-input", type: "text", inputmode: "numeric",
      autocomplete: "one-time-code", maxlength: "6",
      placeholder: "000000", "aria-label": "6-stelliger Kopplungscode",
      oninput: function (e) {
        codeVal = e.target.value.replace(/\D/g, "").slice(0, 6);
        e.target.value = codeVal;
        errBox.textContent = "";
        refresh();
      }
    });

    var roleBtns = Object.keys(ROLES).map(function (key) {
      var m = ROLES[key];
      var btn = el("button", {
        class: "role-btn", type: "button",
        "aria-pressed": key === chosen ? "true" : "false",
        onclick: function () {
          chosen = key;
          roleBtns.forEach(function (b) {
            b.setAttribute("aria-pressed", b === btn ? "true" : "false");
          });
          refresh();
        }
      }, [
        el("span", { class: "ico" }, m.ico),
        el("span", {}, [
          el("span", { class: "rt" }, m.label),
          el("span", { class: "rd" }, m.desc)
        ])
      ]);
      return btn;
    });

    submitBtn = el("button", { class: "btn-primary", type: "button",
      onclick: function () {
        if (busy || codeVal.length !== 6) return;
        busy = true; errBox.textContent = ""; refresh();
        pair(codeVal, chosen).then(function (res) {
          token = res.token; role = res.role;
          localStorage.setItem(LS_TOKEN, token);
          localStorage.setItem(LS_ROLE, role);
          render();
        }).catch(function (err) {
          busy = false; codeVal = ""; codeInput.value = "";
          errBox.textContent = err.message || "Kopplung fehlgeschlagen.";
          refresh();
        });
      }
    }, "Koppeln");

    var card = el("div", { class: "card" }, [
      el("h1", {}, "Mit der Hauptkasse koppeln"),
      el("p", { class: "sub" }, "Code von der Hauptkasse ablesen und die Rolle dieses Geräts wählen."),
      el("label", { class: "field" }, [
        el("span", { class: "lab" }, "Kopplungscode"),
        codeInput
      ]),
      el("div", { class: "lab", style: "font-size:.85rem;color:var(--fg-dim);margin-bottom:.5rem" }, "Rolle"),
      el("div", { class: "roles" }, roleBtns),
      errBox,
      submitBtn
    ]);

    app.appendChild(el("div", { class: "screen" }, [ el("div", { class: "center" }, card) ]));
    refresh();
  }

  // ── Customer display ───────────────────────────────────────────────
  function renderDisplay() {
    stopDisplayTimer();
    clear(app);

    var head  = el("div", { class: "display-head" }, "Ihr Einkauf");
    var items = el("div", { class: "display-items" });
    var totalV = el("span", { class: "tv" }, fmtEur("0.00"));
    var total = el("div", { class: "display-total" }, [
      el("span", { class: "tl" }, "Gesamt"),
      totalV
    ]);

    var wrap = el("div", { class: "display-wrap" }, [head, items, total]);
    app.appendChild(topbar());
    app.appendChild(wrap);

    function paint(cart) {
      clear(items);
      var lines = (cart && cart.items) || [];
      if (!lines.length) {
        items.appendChild(el("div", { class: "display-empty" }, "Noch keine Artikel"));
      } else {
        lines.forEach(function (it) {
          var qty = it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1);
          var name = it.name || it.title || it.sku || "Artikel";
          var line = it.lineEur != null ? it.lineEur
                   : (it.totalEur != null ? it.totalEur
                   : (it.priceEur != null ? it.priceEur : it.price));
          items.appendChild(el("div", { class: "display-line" }, [
            el("span", { class: "qty" }, String(qty) + "×"),
            el("span", { class: "nm" }, String(name)),
            el("span", { class: "ln" }, fmtEur(line))
          ]));
        });
      }
      totalV.textContent = fmtEur(cart && cart.totalEur);
    }

    function tick() { getCart().then(paint).catch(function () { /* keep last frame */ }); }
    tick();
    displayTimer = setInterval(tick, 1000);
  }

  // ── Cashier (Zweitkasse) ───────────────────────────────────────────
  function renderCashier() {
    stopDisplayTimer();
    clear(app);
    app.appendChild(topbar());

    var statusMsg = el("div", { class: "state-msg" }, "Katalog wird geladen…");
    var listBox = el("div", { class: "list" });
    var all = [];

    var search = el("input", {
      class: "search", type: "search", placeholder: "Artikel suchen…",
      "aria-label": "Artikel suchen",
      oninput: function (e) { paint(e.target.value.trim().toLowerCase()); }
    });

    function paint(q) {
      clear(listBox);
      var rows = all.filter(function (p) {
        if (!q) return true;
        return (String(p.name || "") + " " + String(p.sku || "")).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 100);
      if (!rows.length) {
        listBox.appendChild(el("div", { class: "state-msg" }, "Keine Treffer."));
        return;
      }
      rows.forEach(function (p) {
        listBox.appendChild(el("div", { class: "row" }, [
          el("div", { class: "meta" }, [
            el("div", { class: "nm" }, String(p.name || "Ohne Namen")),
            el("div", { class: "sku" }, p.sku ? ("SKU " + String(p.sku)) : "—")
          ]),
          el("span", { class: "price" }, fmtEur(p.priceEur != null ? p.priceEur : p.price)),
          el("button", { class: "add", title: "Hinzufügen (folgt)",
            onclick: function () {
              // TODO(phase): wire 'add to cart' through the mother so this
              // companion can ring up via the proxy + publish the cart.
              // For now this is an intentionally inert stub.
              alert("Hinzufügen folgt: Warenkorb wird in der nächsten Phase über die Hauptkasse synchronisiert.");
            }
          }, "+")
        ]));
      });
    }

    app.appendChild(el("div", { class: "pad" }, [
      search,
      el("div", { class: "hint" }, [
        "Nur-Lesen-Katalog. ",
        el("span", { class: "badge-soft" }, "Hinzufügen folgt")
      ]),
      statusMsg,
      listBox
    ]));

    proxy("products")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        all = normalizeProducts(data);
        statusMsg.remove();
        paint("");
      })
      .catch(function (err) {
        statusMsg.textContent = "Katalog konnte nicht geladen werden. (" + (err.message || "Fehler") + ")";
      });
  }

  // ── Warehouse (Lager) — SKU lookup ─────────────────────────────────
  function renderWarehouse() {
    stopDisplayTimer();
    clear(app);
    app.appendChild(topbar());

    var resultBox = el("div", {});
    var busy = false;

    var search = el("input", {
      class: "search", type: "search", placeholder: "SKU oder Artikelname…",
      "aria-label": "SKU oder Artikelname",
      onkeydown: function (e) { if (e.key === "Enter") run(e.target.value.trim()); }
    });

    function run(q) {
      if (!q || busy) return;
      busy = true;
      clear(resultBox);
      resultBox.appendChild(el("div", { class: "state-msg" }, "Suche…"));
      proxy("products?search=" + encodeURIComponent(q))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          busy = false;
          var rows = normalizeProducts(data).filter(function (p) {
            var hay = (String(p.name || "") + " " + String(p.sku || "")).toLowerCase();
            return hay.indexOf(q.toLowerCase()) >= 0;
          }).slice(0, 50);
          clear(resultBox);
          if (!rows.length) {
            resultBox.appendChild(el("div", { class: "state-msg" }, "Kein Artikel gefunden."));
            return;
          }
          rows.forEach(function (p) {
            resultBox.appendChild(el("div", { class: "skuhit" }, [
              kv("Artikel", p.name || "—"),
              kv("SKU", p.sku || "—"),
              kv("Lagerort", p.location || p.bin || "—"),
              kv("Bestand", p.stock != null ? String(p.stock) : (p.qty != null ? String(p.qty) : "—")),
              kv("Status", p.state || p.status || "—"),
              kv("Preis", fmtEur(p.priceEur != null ? p.priceEur : p.price))
            ]));
          });
        })
        .catch(function (err) {
          busy = false;
          clear(resultBox);
          resultBox.appendChild(el("div", { class: "state-msg" }, "Suche fehlgeschlagen. (" + (err.message || "Fehler") + ")"));
        });
    }

    function kv(k, v) {
      return el("div", { class: "kv" }, [
        el("span", { class: "k" }, k),
        el("span", { class: "v" }, String(v))
      ]);
    }

    app.appendChild(el("div", { class: "pad" }, [
      search,
      el("div", { class: "hint" }, "SKU oder Name eingeben und Enter drücken."),
      resultBox
    ]));
  }

  // Normalize various possible product list shapes from the cloud.
  function normalizeProducts(data) {
    var arr = Array.isArray(data) ? data
            : (data && Array.isArray(data.items)) ? data.items
            : (data && Array.isArray(data.products)) ? data.products
            : (data && Array.isArray(data.data)) ? data.data
            : [];
    return arr.map(function (p) {
      return {
        name: p.name || p.title || p.productName,
        sku: p.sku || p.id || p.productId,
        priceEur: p.priceEur,
        price: p.price != null ? p.price : (p.priceCents != null ? p.priceCents / 100 : null),
        location: p.location || p.storageLocation || p.bin,
        bin: p.bin,
        stock: p.stock != null ? p.stock : p.quantity,
        qty: p.qty,
        state: p.state,
        status: p.status
      };
    });
  }

  // ── Router ─────────────────────────────────────────────────────────
  function render() {
    if (!token || !role || !ROLES[role]) { renderPairing(); return; }
    if (role === "display")   { renderDisplay();   return; }
    if (role === "cashier")   { renderCashier();   return; }
    if (role === "warehouse") { renderWarehouse(); return; }
    renderPairing();
  }

  render();
})();
