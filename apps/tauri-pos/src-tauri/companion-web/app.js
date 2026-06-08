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
  var LS_TOKEN   = "w14.companion.token";
  var LS_ROLE    = "w14.companion.role";
  var LS_PRINTER = "w14.companion.printer"; // label-printer settings (local).

  var ROLES = {
    warehouse: { label: "Lager",         ico: "📦", desc: "Bestand, Etiketten & Produkte" },
    cashier:   { label: "Zweitkasse",    ico: "💳", desc: "Zweiter Kassenplatz" },
    display:   { label: "Kundenanzeige", ico: "🖥️", desc: "Live-Warenkorb für Kunden" }
  };

  // Item types offered in the quick-add form (mirrors the cloud ItemType enum).
  var ITEM_TYPES = [
    ["gold_jewelry",     "Goldschmuck"],
    ["gold_coin",        "Goldmünze"],
    ["gold_bar",         "Goldbarren"],
    ["silver_jewelry",   "Silberschmuck"],
    ["silver_coin",      "Silbermünze"],
    ["silver_bar",       "Silberbarren"],
    ["platinum_jewelry", "Platinschmuck"],
    ["platinum_coin",    "Platinmünze"],
    ["platinum_bar",     "Platinbarren"],
    ["antique",          "Antiquität"],
    ["watch",            "Uhr"],
    ["other",            "Sonstiges"]
  ];
  var CONDITIONS = [
    ["NEW",              "Neu"],
    ["USED_EXCELLENT",   "Gebraucht – sehr gut"],
    ["USED_GOOD",        "Gebraucht – gut"],
    ["USED_FAIR",        "Gebraucht – akzeptabel"],
    ["ANTIQUE_RESTORED", "Antik – restauriert"],
    ["ANTIQUE_AS_FOUND", "Antik – im Fundzustand"]
  ];
  // Tax treatment codes accepted by the cloud (kept minimal + labelled).
  var TAX_CODES = [
    ["DIFF_25A",  "Differenzbesteuerung §25a"],
    ["REGULAR",   "Regelbesteuerung 19 %"],
    ["EXEMPT_25C","Steuerbefreit §25c (Anlagegold)"]
  ];

  // ── State ──────────────────────────────────────────────────────────
  var token = localStorage.getItem(LS_TOKEN) || "";
  var role  = localStorage.getItem(LS_ROLE)  || "";
  var displayTimer = null;     // GET /cart poll fallback interval.
  var displaySocket = null;    // live customer-display WebSocket (/ws).
  var displayReconnect = null; // pending socket-reconnect timer.
  var whTab = "scan"; // active warehouse tool tab.

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
  // Normalise a German-comma money string to a dot-decimal the cloud accepts.
  // Mirrors apps/tauri-pos/src/lib/decimal.ts (normalizeDecimal) — strips
  // grouping dots, turns the comma into the decimal point, keeps 2 places.
  function normalizeDecimal(raw) {
    if (raw == null) return "";
    var s = String(raw).trim();
    if (!s) return "";
    if (s.indexOf(",") >= 0) {
      // German style: dots are thousands separators, comma is the decimal.
      s = s.replace(/\./g, "").replace(",", ".");
    }
    return s;
  }
  // A money input is valid iff it normalises to `\d+(\.\d{1,2})?`.
  function isMoney(raw) {
    var s = normalizeDecimal(raw);
    return /^\d{1,16}(\.\d{1,2})?$/.test(s);
  }
  function stopDisplayTimer() { if (displayTimer) { clearInterval(displayTimer); displayTimer = null; } }
  function compact(loc) {
    var parts = [loc.locationStorageUnit, loc.locationDrawer, loc.locationPosition]
      .filter(function (x) { return x; });
    return parts.length ? parts.join(" · ") : "—";
  }

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
  // POST/PUT JSON through the proxy. Resolves to the parsed body on 2xx;
  // rejects with a German message (with the cloud's STEP_UP hint surfaced)
  // otherwise — the companion cannot perform a step-up challenge itself.
  function proxyJson(path, method, payload) {
    return proxy(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* non-JSON */ }
        if (r.ok) return data || {};
        var code = data && data.error && data.error.code;
        if (r.status === 403 && code === "STEP_UP_REQUIRED") {
          throw new Error("Diese Aktion erfordert eine Freigabe an der Hauptkasse (Step-up). Bitte am Hauptgerät bestätigen.");
        }
        var msg = (data && data.error && data.error.message) ||
                  "Vorgang fehlgeschlagen (" + r.status + ").";
        throw new Error(msg);
      });
    });
  }

  // ── Session ────────────────────────────────────────────────────────
  function logout() {
    stopDisplayTimer();
    stopDisplaySocket();
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

  // ── Pairing screen (2 steps: code → BIG role tiles) ────────────────
  function renderPairing() {
    stopDisplayTimer();
    stopDisplaySocket();
    clear(app);

    var step = "code";        // "code" | "role"
    var codeVal = "";
    var chosen = "";
    var busy = false;

    var screen = el("div", { class: "screen" });
    var center = el("div", { class: "center" });
    screen.appendChild(center);
    app.appendChild(screen);

    function showCode() {
      step = "code";
      clear(center);
      var errBox = el("div", { class: "err" });
      var nextBtn;

      var codeInput = el("input", {
        class: "code-input", type: "text", inputmode: "numeric",
        autocomplete: "one-time-code", maxlength: "6",
        placeholder: "000000", "aria-label": "6-stelliger Kopplungscode",
        oninput: function (e) {
          codeVal = e.target.value.replace(/\D/g, "").slice(0, 6);
          e.target.value = codeVal;
          errBox.textContent = "";
          nextBtn.disabled = codeVal.length !== 6;
        }
      });
      codeInput.value = codeVal;

      nextBtn = el("button", { class: "btn-primary", type: "button",
        onclick: function () { if (codeVal.length === 6) showRole(); }
      }, "Weiter");
      nextBtn.disabled = codeVal.length !== 6;

      center.appendChild(el("div", { class: "card" }, [
        el("h1", {}, "Mit der Hauptkasse koppeln"),
        el("p", { class: "sub" }, "Geben Sie den 6-stelligen Code ein, der auf der Hauptkasse angezeigt wird."),
        el("label", { class: "field" }, [
          el("span", { class: "lab" }, "Kopplungscode"),
          codeInput
        ]),
        errBox,
        nextBtn
      ]));
      setTimeout(function () { try { codeInput.focus(); } catch (e) {} }, 0);
    }

    function showRole() {
      step = "role";
      chosen = "";
      clear(center);
      var errBox = el("div", { class: "err" });

      var tiles = Object.keys(ROLES).map(function (key) {
        var m = ROLES[key];
        return el("button", {
          class: "role-tile", type: "button",
          "aria-label": m.label + " — " + m.desc,
          onclick: function () { if (!busy) doPair(key); }
        }, [
          el("span", { class: "ico" }, m.ico),
          el("span", { class: "rt" }, m.label),
          el("span", { class: "rd" }, m.desc)
        ]);
      });

      function doPair(key) {
        chosen = key;
        busy = true;
        errBox.textContent = "Wird gekoppelt…";
        errBox.style.color = "var(--fg-dim)";
        pair(codeVal, chosen).then(function (res) {
          token = res.token; role = res.role;
          localStorage.setItem(LS_TOKEN, token);
          localStorage.setItem(LS_ROLE, role);
          render();
        }).catch(function (err) {
          busy = false;
          errBox.style.color = "var(--danger)";
          errBox.textContent = err.message || "Kopplung fehlgeschlagen.";
          // A bad/expired code means returning to step 1 for a fresh code.
          if (/Code|abgelaufen|ungültig/i.test(err.message || "")) {
            codeVal = "";
            setTimeout(showCode, 1200);
          }
        });
      }

      center.appendChild(el("div", { class: "card wide" }, [
        el("h1", {}, "Rolle dieses Geräts wählen"),
        el("p", { class: "sub" }, "Tippen Sie auf die Aufgabe, für die dieses Gerät verwendet wird."),
        el("div", { class: "role-grid" }, tiles),
        errBox,
        el("button", { class: "btn-ghost", type: "button", style: "margin-top:.5rem",
          onclick: function () { if (!busy) showCode(); }
        }, "Zurück")
      ]));
    }

    showCode();
  }

  // ── Customer display ───────────────────────────────────────────────
  // LIVE via WebSocket (GET /ws?token=…): the mother broadcasts the cart on
  // every change, so the display re-renders on push with no polling lag. The
  // 1 s GET /cart poll is kept ONLY as a fallback that arms when the socket
  // drops (and disarms again once it reconnects).
  function renderDisplay() {
    stopDisplayTimer();
    stopDisplaySocket();
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
                   : (it.lineTotalEur != null ? it.lineTotalEur
                   : (it.totalEur != null ? it.totalEur
                   : (it.priceEur != null ? it.priceEur : it.price)));
          items.appendChild(el("div", { class: "display-line" }, [
            el("span", { class: "qty" }, String(qty) + "×"),
            el("span", { class: "nm" }, String(name)),
            el("span", { class: "ln" }, fmtEur(line))
          ]));
        });
      }
      totalV.textContent = fmtEur(cart && cart.totalEur);
    }

    // The poll fallback — only runs while the socket is NOT open.
    function startPoll() {
      if (displayTimer) return;
      function tick() { getCart().then(paint).catch(function () { /* keep last frame */ }); }
      tick();
      displayTimer = setInterval(tick, 1000);
    }
    function stopPoll() { stopDisplayTimer(); }

    // Open the realtime socket; on drop, fall back to polling and retry the
    // socket with a gentle backoff.
    connectDisplaySocket(paint, startPoll, stopPoll);
  }

  // Build the ws:// URL for /ws on the same origin the SPA was served from,
  // carrying the companion token as a query param (browsers can't set custom
  // headers on a WebSocket handshake).
  function wsUrl() {
    var scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return scheme + "//" + location.host + "/ws?token=" + encodeURIComponent(token);
  }

  function stopDisplaySocket() {
    if (displayReconnect) { clearTimeout(displayReconnect); displayReconnect = null; }
    if (displaySocket) {
      try { displaySocket.onclose = null; displaySocket.close(); } catch (e) {}
      displaySocket = null;
    }
  }

  // Connect (and keep reconnecting) the display feed. `onCart` paints a frame;
  // `armPoll`/`disarmPoll` toggle the GET /cart fallback so the display never
  // goes dark even if WebSockets are blocked on this network.
  function connectDisplaySocket(onCart, armPoll, disarmPoll) {
    if (!token) { armPoll(); return; }
    var ws;
    try { ws = new WebSocket(wsUrl()); }
    catch (e) { armPoll(); scheduleReconnect(onCart, armPoll, disarmPoll); return; }
    displaySocket = ws;

    ws.onopen = function () {
      // Socket is live → stop the poll; the server sends the snapshot on connect.
      disarmPoll();
    };
    ws.onmessage = function (ev) {
      var cart = null;
      try { cart = JSON.parse(ev.data); } catch (e) { return; }
      onCart(cart);
    };
    ws.onerror = function () { /* surfaced as a close — handled there */ };
    ws.onclose = function (ev) {
      if (displaySocket === ws) displaySocket = null;
      // 1008 = policy violation (our auth/role reject) → token is stale: log out.
      if (ev && ev.code === 1008) { logout(); return; }
      // Otherwise fall back to polling and try to re-establish the socket.
      armPoll();
      scheduleReconnect(onCart, armPoll, disarmPoll);
    };
  }

  function scheduleReconnect(onCart, armPoll, disarmPoll) {
    if (displayReconnect) return;
    displayReconnect = setTimeout(function () {
      displayReconnect = null;
      // Only reconnect if we're still on the display screen with a token.
      if (role === "display" && token) {
        connectDisplaySocket(onCart, armPoll, disarmPoll);
      }
    }, 3000);
  }

  // ── Money in integer cents (mirrors lib/cart-math toCents/fromCents) ─
  // Parse a Decimal/comma money STRING to integer cents. Returns null when the
  // input isn't a clean money value (so a bad catalog price can't poison the
  // running total). No floats touch the running total — everything is bigint-
  // free integer cents accumulated in a Number that stays exact under 2^53.
  function priceToCents(raw) {
    var s = normalizeDecimal(raw);
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split(".");
    var whole = parseInt(parts[0], 10);
    var frac = parts[1] ? (parts[1] + "00").slice(0, 2) : "00";
    return whole * 100 + parseInt(frac, 10);
  }
  // Integer cents → Decimal string "12.50" (dot decimal, for fmtEur + parity).
  function centsToDecimal(cents) {
    var sign = cents < 0 ? "-" : "";
    var a = Math.abs(cents);
    var whole = Math.floor(a / 100);
    var frac = a % 100;
    return sign + whole + "." + (frac < 10 ? "0" + frac : String(frac));
  }

  // ── Cashier (Zweitkasse) ───────────────────────────────────────────
  // A REAL client-side ring-up: tap catalog rows to build a cart (line list +
  // running total in integer cents), adjust quantities, remove lines. The cart
  // lives only on this companion. The "Bezahlen (bar)" button does NOT post a
  // fiscal transaction itself — the cloud finalize requires an inventory
  // reservation session + VAT split + TSE signature flow that only the mother
  // performs, and posting a partial/guessed body would create a malformed
  // GoBD/KassenSichV record. Instead it hands the order off to the Hauptkasse.
  function renderCashier() {
    stopDisplayTimer();
    stopDisplaySocket();
    clear(app);
    app.appendChild(topbar());

    var statusMsg = el("div", { class: "state-msg" }, "Katalog wird geladen…");
    var listBox = el("div", { class: "list" });
    var all = [];

    // cart line: { id, sku, name, unitCents, qty }
    var cart = [];
    var cartBox = el("div", {});

    var search = el("input", {
      class: "search", type: "search", placeholder: "Artikel suchen…",
      "aria-label": "Artikel suchen",
      oninput: function (e) { paint(e.target.value.trim().toLowerCase()); }
    });

    function addToCart(p) {
      var unit = priceToCents(p.priceEur != null ? p.priceEur : p.price);
      if (unit == null) { alert("Dieser Artikel hat keinen gültigen Preis und kann nicht hinzugefügt werden."); return; }
      var key = p.id || p.sku || p.name;
      var existing = cart.filter(function (l) { return l.key === key; })[0];
      if (existing) { existing.qty += 1; }
      else { cart.push({ key: key, id: p.id || null, sku: p.sku || "", name: p.name || "Artikel", unitCents: unit, qty: 1 }); }
      paintCart();
    }

    function setQty(line, qty) {
      if (qty <= 0) { cart = cart.filter(function (l) { return l !== line; }); }
      else { line.qty = qty; }
      paintCart();
    }

    function cartTotalCents() {
      return cart.reduce(function (sum, l) { return sum + l.unitCents * l.qty; }, 0);
    }

    function paintCart() {
      clear(cartBox);
      var count = cart.reduce(function (n, l) { return n + l.qty; }, 0);

      var lines = el("div", { class: "cart-list" });
      if (!cart.length) {
        lines.appendChild(el("div", { class: "cart-empty" }, "Noch keine Artikel im Warenkorb."));
      } else {
        cart.forEach(function (l) {
          lines.appendChild(el("div", { class: "cart-row" }, [
            el("div", { class: "meta" }, [
              el("div", { class: "nm" }, String(l.name)),
              el("div", { class: "sub" }, (l.sku ? "SKU " + l.sku + " · " : "") + fmtEur(centsToDecimal(l.unitCents)) + " / Stück")
            ]),
            el("div", { class: "qty-ctrl" }, [
              el("button", { type: "button", "aria-label": "Weniger", onclick: function () { setQty(l, l.qty - 1); } }, "−"),
              el("span", { class: "q" }, String(l.qty)),
              el("button", { type: "button", "aria-label": "Mehr", onclick: function () { setQty(l, l.qty + 1); } }, "+")
            ]),
            el("span", { class: "ln" }, fmtEur(centsToDecimal(l.unitCents * l.qty))),
            el("button", { class: "rm", type: "button", "aria-label": "Entfernen",
              onclick: function () { setQty(l, 0); } }, "×")
          ]));
        });
      }

      var payBtn = el("button", { class: "btn-primary", type: "button",
        onclick: handoffToMother }, "Bezahlen (bar) – an Hauptkasse");
      payBtn.disabled = !cart.length;

      cartBox.appendChild(el("div", { class: "cartwrap" }, [
        el("div", { class: "cart-head" }, [
          el("span", { class: "t" }, "Warenkorb"),
          el("span", { class: "c" }, count + (count === 1 ? " Artikel" : " Artikel"))
        ]),
        lines,
        el("div", { class: "cart-total" }, [
          el("span", { class: "tl" }, "Gesamt"),
          el("span", { class: "tv" }, fmtEur(centsToDecimal(cartTotalCents())))
        ]),
        el("div", { class: "btn-row" }, [ payBtn ]),
        el("div", { class: "scan-help" },
          "Der Abschluss erfolgt an der Hauptkasse: Reservierung, Steueraufteilung und " +
          "TSE-Signatur (KassenSichV) werden dort fiskalisch erzeugt. So entsteht nie ein " +
          "unvollständiger Kassenbeleg auf diesem Gerät.")
      ]));
    }

    // Hand the finished order to the Hauptkasse for fiscal finalize. We do NOT
    // POST /transactions/finalize from here: that body needs a per-line
    // reservationSessionId (POST /api/inventory/reserve — not in the cashier
    // allow-list), a VAT split, and a TSE signature the mother owns. Posting a
    // guessed/partial body would write a malformed GoBD record. This is an
    // honest hand-off; the real cross-device cart push is a later phase.
    function handoffToMother() {
      if (!cart.length) return;
      var count = cart.reduce(function (n, l) { return n + l.qty; }, 0);
      var total = fmtEur(centsToDecimal(cartTotalCents()));
      alert(
        "Warenkorb bereit für die Hauptkasse.\n\n" +
        count + " Artikel · Gesamt " + total + "\n\n" +
        "Bitte den Abschluss (bar) an der Hauptkasse durchführen — " +
        "Reservierung, Steuer und TSE-Signatur werden dort fiskalisch erzeugt. " +
        "Die automatische Übergabe an die Hauptkasse folgt in einer späteren Phase."
      );
    }

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
          el("button", { class: "add", title: "In den Warenkorb", "aria-label": "Hinzufügen",
            onclick: function () { addToCart(p); }
          }, "+")
        ]));
      });
    }

    app.appendChild(el("div", { class: "pad" }, [
      search,
      el("div", { class: "hint" }, "Auf „+“ tippen, um einen Artikel in den Warenkorb zu legen."),
      statusMsg,
      listBox,
      cartBox
    ]));

    paintCart();

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

  // ── Warehouse (Lager) — tabbed tools ───────────────────────────────
  function renderWarehouse() {
    stopDisplayTimer();
    stopDisplaySocket();
    clear(app);
    app.appendChild(topbar());

    var TABS = [
      ["scan",    "Scannen"],
      ["stock",   "Bestand"],
      ["add",     "Neu"],
      ["printer", "Drucker"]
    ];
    var bodyBox = el("div", {});

    function drawTabs() {
      var bar = el("div", { class: "tabs" }, TABS.map(function (t) {
        return el("button", {
          class: "tab", type: "button",
          "aria-selected": t[0] === whTab ? "true" : "false",
          onclick: function () { whTab = t[0]; mount(); }
        }, t[1]);
      }));
      return bar;
    }

    var tabsEl = drawTabs();
    app.appendChild(tabsEl);
    app.appendChild(bodyBox);

    function mount() {
      // Refresh the tab selection state.
      var newTabs = drawTabs();
      tabsEl.replaceWith(newTabs);
      tabsEl = newTabs;
      clear(bodyBox);
      if (whTab === "scan")    bodyBox.appendChild(whScan());
      else if (whTab === "stock") bodyBox.appendChild(whStock());
      else if (whTab === "add")   bodyBox.appendChild(whAdd());
      else if (whTab === "printer") bodyBox.appendChild(whPrinter());
    }
    mount();
  }

  // Warehouse · Scannen — one big, unambiguous scan-to-lookup field.
  function whScan() {
    var resultBox = el("div", {});
    var busy = false;

    var scanInput = el("input", {
      class: "scan-input", type: "text", inputmode: "text",
      autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
      placeholder: "Barcode scannen oder SKU eingeben",
      "aria-label": "Barcode oder SKU scannen",
      onkeydown: function (e) {
        // Most USB/Bluetooth scanners send Enter after the code.
        if (e.key === "Enter") { e.preventDefault(); lookup(e.target.value.trim()); }
      }
    });

    function reset() { scanInput.value = ""; try { scanInput.focus(); } catch (e) {} }

    function lookup(code) {
      if (!code || busy) return;
      busy = true;
      clear(resultBox);
      resultBox.appendChild(el("div", { class: "state-msg" }, "Suche " + code + " …"));
      // Exact barcode match first (scanner semantics), then fall back to a
      // free-text `q` lookup so a typed SKU/name also resolves.
      proxy("products?barcode=" + encodeURIComponent(code))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var rows = normalizeProducts(data);
          if (rows.length) return rows;
          return proxy("products?q=" + encodeURIComponent(code))
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(normalizeProducts);
        })
        .then(function (rows) {
          busy = false;
          clear(resultBox);
          if (!rows.length) {
            resultBox.appendChild(el("div", { class: "notice bad" },
              "Kein Artikel zu „" + code + "“ gefunden."));
          } else {
            rows.slice(0, 25).forEach(function (p) {
              resultBox.appendChild(productCard(p, function () { mountStockWith(p); }));
            });
          }
          reset();
        })
        .catch(function (err) {
          busy = false;
          clear(resultBox);
          resultBox.appendChild(el("div", { class: "notice bad" },
            "Suche fehlgeschlagen. (" + (err.message || "Fehler") + ")"));
        });
    }

    // When an edit/bin action is requested from a scan hit, jump to the
    // Bestand tab pre-loaded with that product.
    function mountStockWith(p) {
      whTab = "stock";
      renderWarehouse();
      // Defer until the stock tab is mounted, then open the detail.
      setTimeout(function () {
        if (window.__whOpenProduct) window.__whOpenProduct(p);
      }, 0);
    }

    var pad = el("div", { class: "pad" }, [
      el("div", { class: "scanwrap" }, [
        el("div", { class: "scan-label" }, [ el("span", { class: "ico" }, "📷"), "Artikel scannen" ]),
        scanInput,
        el("div", { class: "scan-help" },
          "Cursor steht im Feld. Scannen Sie den Barcode (Enter wird automatisch gesendet) " +
          "oder tippen Sie eine SKU ein und drücken Enter."),
        el("button", { class: "btn-primary inline", type: "button", style: "width:100%",
          onclick: function () { lookup(scanInput.value.trim()); } }, "Nachschlagen")
      ]),
      el("div", { style: "margin-top:1.25rem" }, resultBox)
    ]);
    setTimeout(reset, 0);
    return pad;
  }

  // Warehouse · Bestand — SKU/name search + per-item detail with bin edit.
  function whStock() {
    var resultBox = el("div", {});
    var detailBox = el("div", {});
    var busy = false;

    var search = el("input", {
      class: "search", type: "search", placeholder: "SKU oder Artikelname…",
      "aria-label": "SKU oder Artikelname",
      onkeydown: function (e) { if (e.key === "Enter") run(e.target.value.trim()); }
    });

    function run(q) {
      if (!q || busy) return;
      busy = true;
      clear(detailBox);
      clear(resultBox);
      resultBox.appendChild(el("div", { class: "state-msg" }, "Suche…"));
      proxy("products?q=" + encodeURIComponent(q))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          busy = false;
          var rows = normalizeProducts(data).slice(0, 50);
          clear(resultBox);
          if (!rows.length) {
            resultBox.appendChild(el("div", { class: "notice info" }, "Kein Artikel gefunden."));
            return;
          }
          rows.forEach(function (p) {
            resultBox.appendChild(productCard(p, function () { openDetail(p); }));
          });
        })
        .catch(function (err) {
          busy = false;
          clear(resultBox);
          resultBox.appendChild(el("div", { class: "notice bad" },
            "Suche fehlgeschlagen. (" + (err.message || "Fehler") + ")"));
        });
    }

    // Detail panel: rename / re-price / publish + bin (Lagerort) change.
    function openDetail(p) {
      clear(resultBox);
      clear(detailBox);
      detailBox.appendChild(productDetail(p, function () {
        // After a save, re-search so the list reflects the change.
        run(p.sku || p.name || "");
      }));
      try { detailBox.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    }

    // Allow the Scannen tab to hand us a product directly.
    window.__whOpenProduct = openDetail;

    var pad = el("div", { class: "pad" }, [
      search,
      el("div", { class: "hint" }, "SKU oder Name eingeben und Enter drücken."),
      detailBox,
      resultBox
    ]);
    return pad;
  }

  // Warehouse · Neu — quick add-a-product form (POST /api/products).
  function whAdd() {
    var msg = el("div", {});
    var busy = false;

    function field(labelTxt, node, required) {
      return el("div", { class: "fl" }, [
        el("span", { class: "lab" }, required
          ? [labelTxt + " ", el("span", { class: "req" }, "*")]
          : labelTxt),
        node
      ]);
    }
    function selectOf(pairs) {
      return el("select", { class: "sel" }, pairs.map(function (p) {
        return el("option", { value: p[0] }, p[1]);
      }));
    }

    var skuI   = el("input", { class: "inp", type: "text", autocapitalize: "characters", placeholder: "z. B. RING-0042" });
    var barI   = el("input", { class: "inp", type: "text", placeholder: "Optional — Barcode" });
    var nameI  = el("input", { class: "inp", type: "text", placeholder: "Artikelbezeichnung" });
    var typeS  = selectOf(ITEM_TYPES);
    var condS  = selectOf(CONDITIONS);
    var taxS   = selectOf(TAX_CODES);
    var acqI   = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "0,00" });
    var listI  = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "0,00" });
    var wgtI   = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "Optional — Gramm" });
    var unitI  = el("input", { class: "inp", type: "text", placeholder: "z. B. Tresor 1" });
    var drwI   = el("input", { class: "inp", type: "text", placeholder: "z. B. Fach 3" });
    var posI   = el("input", { class: "inp", type: "text", placeholder: "z. B. Box B" });

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: submit }, "Produkt anlegen");

    function setMsg(kind, text) {
      clear(msg);
      msg.appendChild(el("div", { class: "notice " + kind }, text));
    }

    function submit() {
      if (busy) return;
      var sku = skuI.value.trim();
      var name = nameI.value.trim();
      if (!sku)  { setMsg("bad", "Bitte eine SKU vergeben."); return; }
      if (!name) { setMsg("bad", "Bitte eine Bezeichnung eingeben."); return; }
      if (!isMoney(acqI.value))  { setMsg("bad", "Ankaufspreis ist keine gültige Zahl."); return; }
      if (!isMoney(listI.value)) { setMsg("bad", "Verkaufspreis ist keine gültige Zahl."); return; }
      if (wgtI.value.trim() && !isMoney(wgtI.value)) { setMsg("bad", "Gewicht ist keine gültige Zahl."); return; }

      var payload = {
        sku: sku,
        itemType: typeS.value,
        condition: condS.value,
        taxTreatmentCode: taxS.value,
        acquisitionCostEur: normalizeDecimal(acqI.value),
        listPriceEur: normalizeDecimal(listI.value),
        name: name
      };
      if (barI.value.trim())  payload.barcode = barI.value.trim();
      if (wgtI.value.trim())  payload.weightGrams = normalizeDecimal(wgtI.value);
      if (unitI.value.trim()) payload.locationStorageUnit = unitI.value.trim();
      if (drwI.value.trim())  payload.locationDrawer = drwI.value.trim();
      if (posI.value.trim())  payload.locationPosition = posI.value.trim();

      busy = true; saveBtn.disabled = true;
      setMsg("info", "Wird angelegt…");
      proxyJson("products", "POST", payload).then(function (res) {
        busy = false; saveBtn.disabled = false;
        setMsg("ok", "Angelegt: " + (res.sku || sku) + " (Status " + (res.status || "DRAFT") + "). " +
          "Etikett kann im Tab „Drucker“ gedruckt werden.");
        // Reset the identity fields for the next item; keep type/tax defaults.
        skuI.value = ""; barI.value = ""; nameI.value = "";
        acqI.value = ""; listI.value = ""; wgtI.value = "";
        unitI.value = ""; drwI.value = ""; posI.value = "";
        try { skuI.focus(); } catch (e) {}
      }).catch(function (err) {
        busy = false; saveBtn.disabled = false;
        setMsg("bad", err.message || "Anlegen fehlgeschlagen.");
      });
    }

    return el("div", { class: "pad" }, [
      el("div", { class: "form" }, [
        el("div", { class: "sectionhead" }, "Identität"),
        el("div", { class: "form-row two" }, [
          field("SKU", skuI, true),
          field("Barcode", barI, false)
        ]),
        field("Bezeichnung", nameI, true),
        el("div", { class: "sectionhead" }, "Klassifizierung"),
        el("div", { class: "form-row two" }, [
          field("Art", typeS, true),
          field("Zustand", condS, true)
        ]),
        el("div", { class: "sectionhead" }, "Preise & Steuer"),
        el("div", { class: "form-row two" }, [
          field("Ankaufspreis (€)", acqI, true),
          field("Verkaufspreis (€)", listI, true)
        ]),
        el("div", { class: "form-row two" }, [
          field("Steuerart", taxS, true),
          field("Gewicht (g)", wgtI, false)
        ]),
        el("div", { class: "sectionhead" }, "Lagerort"),
        el("div", { class: "form-row three" }, [
          field("Einheit", unitI, false),
          field("Fach", drwI, false),
          field("Position", posI, false)
        ]),
        el("div", { class: "btn-row" }, [ saveBtn ]),
        msg,
        el("div", { class: "scan-help" },
          "Pflichtfelder sind mit * markiert. Der Lagerort kann hier direkt vergeben werden.")
      ])
    ]);
  }

  // Warehouse · Drucker — label-printer connection settings (local config).
  function whPrinter() {
    var saved = loadPrinter();
    var msg = el("div", {});

    var modeS = el("select", { class: "sel" }, [
      el("option", { value: "mother" }, "Über die Hauptkasse drucken"),
      el("option", { value: "network" }, "Netzwerkdrucker (IP)")
    ]);
    modeS.value = saved.mode || "mother";

    var nameI = el("input", { class: "inp", type: "text",
      placeholder: "z. B. Brother QL-820NWB", value: saved.name || "" });
    var ipI   = el("input", { class: "inp", type: "text", inputmode: "decimal",
      placeholder: "192.168.1.50", value: saved.ip || "" });
    var portI = el("input", { class: "inp", type: "text", inputmode: "numeric",
      placeholder: "9100", value: saved.port || "9100" });

    var netBox = el("div", { class: "form-row two" }, [
      el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Drucker-IP"), ipI ]),
      el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Port"), portI ])
    ]);

    function refreshMode() {
      netBox.style.display = modeS.value === "network" ? "" : "none";
    }
    modeS.addEventListener("change", refreshMode);
    refreshMode();

    function setMsg(kind, text) {
      clear(msg);
      msg.appendChild(el("div", { class: "notice " + kind }, text));
    }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: function () {
        var cfg = {
          mode: modeS.value,
          name: nameI.value.trim(),
          ip: ipI.value.trim(),
          port: portI.value.trim() || "9100"
        };
        savePrinter(cfg);
        setMsg("ok", "Etikettendrucker gespeichert.");
      } }, "Speichern");

    var testBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () {
        // Printing itself runs on the mother (the companion has no printer
        // driver and the proxy is cloud-only). This is an honest stub: it
        // confirms the saved target and signals that the actual print job is
        // dispatched to the Hauptkasse in a later phase.
        var cfg = loadPrinter();
        var target = cfg.mode === "network"
          ? ("Netzwerkdrucker " + (cfg.ip || "—") + ":" + (cfg.port || "9100"))
          : "Hauptkasse";
        setMsg("info", "Testdruck an „" + target + "“ vorgemerkt. " +
          "Der eigentliche Druck wird über die Hauptkasse ausgelöst (folgt).");
      } }, "Testdruck");

    return el("div", { class: "pad" }, [
      el("div", { class: "form" }, [
        el("div", { class: "sectionhead" }, "Etikettendrucker"),
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Verbindung"), modeS ]),
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Bezeichnung" ), nameI ]),
        netBox,
        el("div", { class: "btn-row" }, [ saveBtn, testBtn ]),
        msg,
        el("div", { class: "scan-help" },
          "Diese Einstellung gilt für dieses Gerät. Der Etikettendruck wird an die " +
          "Hauptkasse übergeben — ein direkter LAN-Druck folgt in einer späteren Phase.")
      ])
    ]);
  }

  // ── Shared warehouse UI bits ───────────────────────────────────────
  function statusPill(status) {
    var s = String(status || "").toUpperCase();
    if (s === "AVAILABLE") return el("span", { class: "pill av" }, "Verfügbar");
    if (s === "DRAFT")     return el("span", { class: "pill dr" }, "Entwurf");
    if (!s)                return el("span", { class: "pill muted" }, "—");
    return el("span", { class: "pill muted" }, s);
  }

  // A compact product result card with an "Öffnen" affordance.
  function productCard(p, onOpen) {
    return el("div", { class: "skuhit" }, [
      kv("Artikel", p.name || "—"),
      kv("SKU", p.sku || "—"),
      el("div", { class: "kv" }, [
        el("span", { class: "k" }, "Status"),
        el("span", { class: "v" }, statusPill(p.status))
      ]),
      kv("Lagerort", compact(p)),
      kv("Preis", fmtEur(p.priceEur != null ? p.priceEur : p.price)),
      el("div", { class: "actions" }, [
        el("button", { type: "button", onclick: function () { onOpen(); } }, "Öffnen / Bearbeiten")
      ])
    ]);
  }

  // Editable product detail: rename / re-price / publish (PUT) + bin change
  // (POST inventory-adjustment, reason LOCATION_CHANGE).
  function productDetail(p, onSaved) {
    if (!p.id) {
      return el("div", { class: "notice bad" },
        "Diesem Treffer fehlt eine ID — Bearbeiten nicht möglich.");
    }
    var msg = el("div", {});
    var busy = false;

    var nameI = el("input", { class: "inp", type: "text", value: p.name || "" });
    var priceI = el("input", { class: "inp", type: "text", inputmode: "decimal",
      value: (p.priceEur != null ? p.priceEur : (p.price != null ? p.price : "")) });
    var statusS = el("select", { class: "sel" }, [
      el("option", { value: "" }, "Status unverändert"),
      el("option", { value: "AVAILABLE" }, "Verfügbar (veröffentlichen)"),
      el("option", { value: "DRAFT" }, "Entwurf")
    ]);

    var unitI = el("input", { class: "inp", type: "text", value: p.locationStorageUnit || "", placeholder: "Einheit" });
    var drwI  = el("input", { class: "inp", type: "text", value: p.locationDrawer || "", placeholder: "Fach" });
    var posI  = el("input", { class: "inp", type: "text", value: p.locationPosition || "", placeholder: "Position" });
    var binNoteI = el("input", { class: "inp", type: "text", placeholder: "Grund (min. 8 Zeichen)" });

    function setMsg(kind, text) { clear(msg); msg.appendChild(el("div", { class: "notice " + kind }, text)); }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: saveProduct }, "Änderungen speichern");
    var binBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: saveBin }, "Lagerort übernehmen");

    function saveProduct() {
      if (busy) return;
      var body = {};
      var nm = nameI.value.trim();
      if (nm && nm !== (p.name || "")) body.name = nm;
      if (priceI.value.trim()) {
        if (!isMoney(priceI.value)) { setMsg("bad", "Verkaufspreis ist keine gültige Zahl."); return; }
        body.listPriceEur = normalizeDecimal(priceI.value);
      }
      if (statusS.value) body.status = statusS.value;
      if (!Object.keys(body).length) { setMsg("info", "Keine Änderungen."); return; }

      busy = true; saveBtn.disabled = true; setMsg("info", "Wird gespeichert…");
      proxyJson("products/" + encodeURIComponent(p.id), "PUT", body).then(function (res) {
        busy = false; saveBtn.disabled = false;
        var changed = (res.changedFields || []).length;
        setMsg("ok", "Gespeichert" + (changed ? " (" + changed + " Feld(er) geändert)." : "."));
        if (onSaved) setTimeout(onSaved, 700);
      }).catch(function (err) {
        busy = false; saveBtn.disabled = false;
        setMsg("bad", err.message || "Speichern fehlgeschlagen.");
      });
    }

    function saveBin() {
      if (busy) return;
      var note = binNoteI.value.trim();
      if (note.length < 8) { setMsg("bad", "Bitte einen Grund mit mindestens 8 Zeichen angeben."); return; }
      var body = { reason: "LOCATION_CHANGE", notes: note };
      if (unitI.value.trim()) body.locationStorageUnit = unitI.value.trim();
      if (drwI.value.trim())  body.locationDrawer = drwI.value.trim();
      if (posI.value.trim())  body.locationPosition = posI.value.trim();
      if (!body.locationStorageUnit && !body.locationDrawer && !body.locationPosition) {
        setMsg("bad", "Bitte mindestens ein Lagerort-Feld ausfüllen."); return;
      }

      busy = true; binBtn.disabled = true; setMsg("info", "Lagerort wird übernommen…");
      proxyJson("products/" + encodeURIComponent(p.id) + "/inventory-adjustment", "POST", body)
        .then(function () {
          busy = false; binBtn.disabled = false;
          setMsg("ok", "Lagerort aktualisiert.");
          if (onSaved) setTimeout(onSaved, 700);
        }).catch(function (err) {
          busy = false; binBtn.disabled = false;
          setMsg("bad", err.message || "Lagerort-Änderung fehlgeschlagen.");
        });
    }

    return el("div", { class: "skuhit" }, [
      el("div", { class: "sectionhead", style: "margin-top:0" }, "Bearbeiten"),
      kv("SKU", p.sku || "—"),
      el("div", { class: "form", style: "margin-top:.5rem" }, [
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Bezeichnung"), nameI ]),
        el("div", { class: "form-row two" }, [
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Verkaufspreis (€)"), priceI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Status"), statusS ])
        ]),
        el("div", { class: "btn-row" }, [ saveBtn ]),
        el("div", { class: "sectionhead" }, "Lagerort ändern"),
        el("div", { class: "form-row three" }, [
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Einheit"), unitI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Fach"), drwI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Position"), posI ])
        ]),
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Grund (Pflicht)"), binNoteI ]),
        el("div", { class: "btn-row" }, [ binBtn ]),
        msg,
        el("div", { class: "scan-help" },
          "Lagerort-Änderungen werden protokolliert und können eine Freigabe an der Hauptkasse erfordern.")
      ])
    ]);
  }

  function kv(k, v) {
    return el("div", { class: "kv" }, [
      el("span", { class: "k" }, k),
      el("span", { class: "v" }, typeof v === "string" ? v : (v || el("span", {}, "—")))
    ]);
  }

  // ── Local printer config (per device) ──────────────────────────────
  function loadPrinter() {
    try { return JSON.parse(localStorage.getItem(LS_PRINTER) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function savePrinter(cfg) {
    try { localStorage.setItem(LS_PRINTER, JSON.stringify(cfg)); } catch (e) {}
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
        id: p.id || p.productId || null,
        name: p.name || p.title || p.productName,
        sku: p.sku || p.productId,
        barcode: p.barcode,
        priceEur: p.listPriceEur != null ? p.listPriceEur : p.priceEur,
        price: p.price != null ? p.price : (p.priceCents != null ? p.priceCents / 100 : null),
        locationStorageUnit: p.locationStorageUnit || null,
        locationDrawer: p.locationDrawer || null,
        locationPosition: p.locationPosition || null,
        stock: p.stock != null ? p.stock : p.quantity,
        status: p.status,
        condition: p.condition,
        itemType: p.itemType
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
