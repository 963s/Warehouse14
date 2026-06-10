"use strict";
// Warehouse14 Begleiter — companion SPA logic.
//
// Served as a SEPARATE script (GET /app.js) so the strict CSP can use
// `script-src 'self'` with no `'unsafe-inline'`. All cloud-derived strings
// (product names, SKUs, cart line names) are rendered as textContent only —
// the el() helper has NO innerHTML / `html:` sink, so a malicious product
// name from the cloud can never inject markup into this DOM. The single
// exception is svgEl(): an SVG factory that ONLY ever receives locally-built
// numeric Code128 geometry (never cloud strings) so the no-markup-sink rule
// for cloud data still holds.
//
// Three paired roles, each a single-job surface (design brief §3/§4):
//   warehouse — Lager: scan-to-find · inventory list · add/edit · photo
//               capture+upload · Hauptbild picker · label/barcode print.
//   cashier   — Zweitkasse: client-side ring-up with a thumb-zone Bezahlen bar.
//   display   — Kundenanzeige: total-as-hero mirror over the live WebSocket.
(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────────────────
  var LS_TOKEN   = "w14.companion.token";
  var LS_ROLE    = "w14.companion.role";
  var LS_PRINTER = "w14.companion.printer"; // label-printer settings (local).
  var LS_STICKY  = "w14.companion.sticky";  // carry-forward intake context.

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
  var snackTimer = null; // active undo-snackbar timer.

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
  // SVG element factory (namespaced). ONLY used to draw locally-computed
  // Code128 bar geometry — never receives any cloud-derived string — so the
  // "no markup sink for cloud data" guarantee is preserved.
  function svgEl(tag, attrs, children) {
    var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (var k in attrs) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); }
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c != null) n.appendChild(c);
    });
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

  // ── Multimodal scan/save feedback (design brief: <100ms, distinct OK/FAIL) ─
  // A short Web-Audio chime + a full-screen colour flash + a toast carrying the
  // item name/photo (recognition, not SKU re-reading). Success and failure use
  // DIFFERENT tone + colour + icon so they're unmistakable under shop glare.
  var audioCtx = null;
  function tone(ok) {
    var AC = window.AudioContext || window.webkitAudioContext;
    var beep = function (t0, freq, start, dur) {
      var osc = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(g); g.connect(audioCtx.destination);
      osc.start(t0 + start); osc.stop(t0 + start + dur + 0.02);
    };
    var t0;
    try {
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
      t0 = audioCtx.currentTime;
      if (ok) { beep(t0, 880, 0, 0.10); beep(t0, 1320, 0.07, 0.12); }  // bright two-note up.
      else    { beep(t0, 300, 0, 0.16); beep(t0, 220, 0.12, 0.22); }   // low two-note down.
    } catch (e) { /* audio is best-effort; never block the flow */ }
  }
  function haptic(ok) { try { if (navigator.vibrate) navigator.vibrate(ok ? 18 : [40, 40, 40]); } catch (e) {} }
  // Show the green/red flash + recognition toast. `photoUrl` optional.
  function scanFeedback(ok, title, detail, photoUrl) {
    tone(ok); haptic(ok);
    var existing = document.querySelector(".scanfx");
    if (existing) existing.remove();
    var thumb = photoUrl
      ? el("img", { class: "thumb", src: photoUrl, alt: "", referrerpolicy: "no-referrer" })
      : el("span", { class: "ic" }, ok ? "✓" : "✕");
    var toast = el("div", { class: "toast " + (ok ? "ok" : "bad"), role: "status", "aria-live": "polite" }, [
      thumb,
      el("div", { class: "tx" }, [
        el("div", { class: "tt" }, String(title || (ok ? "Erfasst" : "Nicht gefunden"))),
        detail ? el("div", { class: "td" }, String(detail)) : null
      ])
    ]);
    var fx = el("div", { class: "scanfx flash " + (ok ? "ok" : "bad") }, [toast]);
    document.body.appendChild(fx);
    setTimeout(function () { try { fx.remove(); } catch (e) {} }, ok ? 1500 : 2400);
  }

  // ── Undo snackbar (reversible local ops; never a modal) ────────────
  function snackbar(message, undoLabel, onUndo, ms) {
    var existing = document.querySelector(".snackbar");
    if (existing) existing.remove();
    if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
    var bar = el("div", { class: "snackbar", role: "status", "aria-live": "polite" }, [
      el("span", { class: "msg" }, String(message)),
      onUndo ? el("button", { class: "undo", type: "button", onclick: function () {
        if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
        bar.remove(); onUndo();
      } }, undoLabel || "Rückgängig") : null
    ]);
    document.body.appendChild(bar);
    snackTimer = setTimeout(function () { try { bar.remove(); } catch (e) {} snackTimer = null; }, ms || 7000);
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
  // POST/PUT/PATCH JSON through the proxy. Resolves to the parsed body on 2xx;
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
        if (r.status === 403) {
          throw new Error("Diese Aktion ist auf diesem Gerät nicht erlaubt.");
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
  // "Rolle wechseln" lives in the TOP-RIGHT corner (hard-to-reach zone) so a
  // resting thumb never logs the device out mid-task (brief §3 thumb-zone map).
  function topbar() {
    var meta = ROLES[role];
    var brand = el("span", { class: "brand" }, [
      "Warehouse14 ",
      el("b", {}, "Begleiter")
    ]);
    return el("header", { class: "topbar" }, [
      brand,
      meta ? el("span", { class: "role-pill" }, meta.label) : null,
      el("button", { class: "btn-switch", type: "button",
        "aria-label": "Rolle wechseln und abmelden",
        onclick: function () {
          if (confirm("Rolle wechseln und abmelden?")) logout();
        } }, "Rolle wechseln")
    ]);
  }

  // ── Pairing screen (2 steps: code → BIG role tiles) ────────────────
  function renderPairing() {
    stopDisplayTimer();
    stopDisplaySocket();
    clear(app);

    var codeVal = "";
    var chosen = "";
    var busy = false;

    var screen = el("div", { class: "screen" });
    var center = el("div", { class: "center" });
    screen.appendChild(center);
    app.appendChild(screen);

    function showCode() {
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
  // LIVE via WebSocket (GET /ws): the mother broadcasts the cart on every
  // change, so the display re-renders on push with no polling lag. The 1 s
  // GET /cart poll is kept ONLY as a fallback that arms when the socket drops.
  //
  // Design brief §4: the TOTAL is the hero (largest element), money is calm —
  // line-adds get a single 150–200ms ease-out slide, no bounce/spin; the
  // split-pay Restbetrag mirrors the cashier when present.
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
    // Restbetrag line — hidden unless the mother is mid split-payment.
    var restV = el("span", { class: "rv" }, fmtEur("0.00"));
    var rest = el("div", { class: "display-rest", style: "display:none" }, [
      el("span", { class: "rl" }, "Noch zu zahlen"),
      restV
    ]);

    var wrap = el("div", { class: "display-wrap" }, [head, items, total, rest]);
    app.appendChild(topbar());
    app.appendChild(wrap);

    // Remember which line keys were already on screen so ONLY genuinely new
    // lines get the calm entrance (no whole-list re-animate on every total tick).
    var seen = Object.create(null);

    function lineKey(it, idx) {
      return String(it.id || it.productId || it.sku || it.name || idx);
    }

    function paint(cart) {
      var lines = (cart && cart.items) || [];
      var nextSeen = Object.create(null);
      clear(items);
      if (!lines.length) {
        items.appendChild(el("div", { class: "display-empty" }, "Noch keine Artikel"));
        seen = Object.create(null);
      } else {
        lines.forEach(function (it, idx) {
          var key = lineKey(it, idx);
          nextSeen[key] = true;
          var qty = it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1);
          var name = it.name || it.title || it.sku || "Artikel";
          var line = it.lineEur != null ? it.lineEur
                   : (it.lineTotalEur != null ? it.lineTotalEur
                   : (it.totalEur != null ? it.totalEur
                   : (it.priceEur != null ? it.priceEur : it.price)));
          var cls = "display-line" + (seen[key] ? "" : " fresh");
          items.appendChild(el("div", { class: cls }, [
            el("span", { class: "qty" }, String(qty) + "×"),
            el("span", { class: "nm" }, String(name)),
            el("span", { class: "ln" }, fmtEur(line))
          ]));
        });
        seen = nextSeen;
      }
      totalV.textContent = fmtEur(cart && cart.totalEur);

      // Split-pay mirror: the mother may publish a `remainingEur` / `restEur`
      // while a split tender is open. Show it as a calm secondary hero.
      var remaining = cart && (cart.remainingEur != null ? cart.remainingEur
                    : (cart.restEur != null ? cart.restEur
                    : (cart.amountDueEur != null ? cart.amountDueEur : null)));
      if (remaining != null && parseFloat(String(remaining).replace(",", ".")) > 0) {
        restV.textContent = fmtEur(remaining);
        rest.style.display = "";
      } else {
        rest.style.display = "none";
      }
    }

    function startPoll() {
      if (displayTimer) return;
      function tick() { getCart().then(paint).catch(function () { /* keep last frame */ }); }
      tick();
      displayTimer = setInterval(tick, 1000);
    }
    function stopPoll() { stopDisplayTimer(); }

    connectDisplaySocket(paint, startPoll, stopPoll);
  }

  // Subprotocol prefix that carries the companion token on the /ws handshake.
  var WS_TOKEN_PROTO_PREFIX = "w14.token.";

  function wsUrl() {
    var scheme = location.protocol === "https:" ? "wss:" : "ws:";
    return scheme + "//" + location.host + "/ws";
  }
  function wsProtocols() { return [WS_TOKEN_PROTO_PREFIX + token]; }

  function stopDisplaySocket() {
    if (displayReconnect) { clearTimeout(displayReconnect); displayReconnect = null; }
    if (displaySocket) {
      try { displaySocket.onclose = null; displaySocket.close(); } catch (e) {}
      displaySocket = null;
    }
  }

  function connectDisplaySocket(onCart, armPoll, disarmPoll) {
    if (!token) { armPoll(); return; }
    var ws;
    try { ws = new WebSocket(wsUrl(), wsProtocols()); }
    catch (e) { armPoll(); scheduleReconnect(onCart, armPoll, disarmPoll); return; }
    displaySocket = ws;

    ws.onopen = function () { disarmPoll(); };
    ws.onmessage = function (ev) {
      var cart = null;
      try { cart = JSON.parse(ev.data); } catch (e) { return; }
      onCart(cart);
    };
    ws.onerror = function () { /* surfaced as a close — handled there */ };
    ws.onclose = function (ev) {
      if (displaySocket === ws) displaySocket = null;
      if (ev && ev.code === 1008) { logout(); return; }
      armPoll();
      scheduleReconnect(onCart, armPoll, disarmPoll);
    };
  }

  function scheduleReconnect(onCart, armPoll, disarmPoll) {
    if (displayReconnect) return;
    displayReconnect = setTimeout(function () {
      displayReconnect = null;
      if (role === "display" && token) {
        connectDisplaySocket(onCart, armPoll, disarmPoll);
      }
    }, 3000);
  }

  // ── Money in integer cents (mirrors lib/cart-math toCents/fromCents) ─
  function priceToCents(raw) {
    var s = normalizeDecimal(raw);
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
    var parts = s.split(".");
    var whole = parseInt(parts[0], 10);
    var frac = parts[1] ? (parts[1] + "00").slice(0, 2) : "00";
    return whole * 100 + parseInt(frac, 10);
  }
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
  // lives only on this companion. The "Bezahlen" hand-off does NOT post a
  // fiscal transaction — the cloud finalize needs an inventory reservation +
  // VAT split + TSE signature only the mother performs; posting a partial body
  // would create a malformed GoBD/KassenSichV record. So it hands off cleanly.
  //
  // Brief §3: the Bezahlen control + smart-tender chips live in a fixed
  // thumb-zone bottom bar whose geometry never shifts with cart size.
  function renderCashier() {
    stopDisplayTimer();
    stopDisplaySocket();
    clear(app);
    app.appendChild(topbar());

    var statusMsg = el("div", { class: "state-msg" }, "Katalog wird geladen…");
    var listBox = el("div", { class: "list" });
    var all = [];

    var cart = []; // { key, id, sku, name, unitCents, qty }
    var cartBox = el("div", {});
    var bottomBar = el("div", {}); // thumb-zone Bezahlen bar (fixed).

    var search = el("input", {
      class: "search", type: "search", placeholder: "Artikel suchen…",
      "aria-label": "Artikel suchen",
      oninput: function (e) { paint(e.target.value.trim().toLowerCase()); }
    });

    function addToCart(p) {
      var unit = priceToCents(p.priceEur != null ? p.priceEur : p.price);
      if (unit == null) {
        scanFeedback(false, "Kein gültiger Preis", "Artikel kann nicht hinzugefügt werden.");
        return;
      }
      var key = p.id || p.sku || p.name;
      var existing = cart.filter(function (l) { return l.key === key; })[0];
      if (existing) { existing.qty += 1; }
      else { cart.push({ key: key, id: p.id || null, sku: p.sku || "", name: p.name || "Artikel", unitCents: unit, qty: 1 }); }
      paintCart();
    }

    function setQty(line, qty) {
      if (qty <= 0) { removeLine(line); return; }
      line.qty = qty;
      paintCart();
    }
    function removeLine(line) {
      var idx = cart.indexOf(line);
      if (idx < 0) return;
      var removed = cart[idx];
      cart.splice(idx, 1);
      paintCart();
      snackbar("Position entfernt: " + removed.name, "Rückgängig", function () {
        cart.splice(Math.min(idx, cart.length), 0, removed);
        paintCart();
      });
    }

    function cartTotalCents() {
      return cart.reduce(function (sum, l) { return sum + l.unitCents * l.qty; }, 0);
    }

    function paintCart() {
      clear(cartBox);
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
              onclick: function () { removeLine(l); } }, "×")
          ]));
        });
      }

      cartBox.appendChild(el("div", { class: "cartwrap" }, [
        el("div", { class: "cart-head" }, [
          el("span", { class: "t" }, "Warenkorb"),
          el("span", { class: "c" }, cartCount() + " Artikel")
        ]),
        lines,
        el("div", { class: "scan-help" },
          "Der Abschluss erfolgt an der Hauptkasse: Reservierung, Steueraufteilung und " +
          "TSE-Signatur (KassenSichV) werden dort fiskalisch erzeugt. So entsteht nie ein " +
          "unvollständiger Kassenbeleg auf diesem Gerät.")
      ]));

      paintBottomBar();
    }

    function cartCount() { return cart.reduce(function (n, l) { return n + l.qty; }, 0); }

    // Fixed thumb-zone bar: running total + Bezahlen (full-amount cash hand-off).
    function paintBottomBar() {
      clear(bottomBar);
      var empty = !cart.length;
      var payBtn = el("button", { class: "bb-action", type: "button",
        onclick: handoffToMother }, "Bezahlen");
      payBtn.disabled = empty;
      bottomBar.appendChild(el("div", { class: "bottombar" }, [
        el("div", { class: "bb-info" }, [
          el("div", { class: "t" }, fmtEur(centsToDecimal(cartTotalCents()))),
          el("div", { class: "s" }, empty ? "Warenkorb leer" : (cartCount() + " Artikel · an Hauptkasse"))
        ]),
        payBtn
      ]));
    }

    function handoffToMother() {
      if (!cart.length) return;
      var count = cartCount();
      var total = fmtEur(centsToDecimal(cartTotalCents()));
      alert(
        "Warenkorb bereit für die Hauptkasse.\n\n" +
        count + " Artikel · Gesamt " + total + "\n\n" +
        "Bitte den Abschluss (bar oder Karte) an der Hauptkasse durchführen — " +
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

    app.appendChild(el("div", { class: "pad has-bottombar" }, [
      search,
      el("div", { class: "hint" }, "Auf „+“ tippen, um einen Artikel in den Warenkorb zu legen."),
      statusMsg,
      listBox,
      cartBox
    ]));
    app.appendChild(bottomBar);

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
      return el("div", { class: "tabs", role: "tablist" }, TABS.map(function (t) {
        return el("button", {
          class: "tab", type: "button", role: "tab",
          "aria-selected": t[0] === whTab ? "true" : "false",
          onclick: function () { whTab = t[0]; mount(); }
        }, t[1]);
      }));
    }

    var tabsEl = drawTabs();
    app.appendChild(tabsEl);
    app.appendChild(bodyBox);

    function mount() {
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

  // Warehouse · Scannen — phone-camera barcode scan + manual SKU lookup, then
  // jump straight to the matched item. Multimodal feedback on a match/no-match.
  function whScan() {
    var resultBox = el("div", {});
    var busy = false;
    var stopCam = null; // active live-scan teardown (if any).

    var scanInput = el("input", {
      class: "scan-input", type: "text", inputmode: "text",
      autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
      placeholder: "Barcode scannen oder SKU eingeben",
      "aria-label": "Barcode oder SKU scannen",
      onkeydown: function (e) {
        if (e.key === "Enter") { e.preventDefault(); lookup(e.target.value.trim()); }
      }
    });

    function reset() { scanInput.value = ""; try { scanInput.focus(); } catch (e) {} }

    function lookup(code) {
      if (!code || busy) return;
      busy = true;
      clear(resultBox);
      resultBox.appendChild(el("div", { class: "state-msg" }, "Suche " + code + " …"));
      // Exact barcode match first (scanner semantics), then a free-text fallback.
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
          var first;
          if (!rows.length) {
            scanFeedback(false, "Unbekannter Code", "Kein Artikel zu „" + code + "“.");
            resultBox.appendChild(el("div", { class: "notice bad" },
              "Kein Artikel zu „" + code + "“ gefunden."));
          } else {
            first = rows[0];
            scanFeedback(true, first.name || first.sku || "Artikel",
              first.sku ? ("SKU " + first.sku) : null, photoThumb(first));
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

    function mountStockWith(p) {
      if (stopCam) { try { stopCam(); } catch (e) {} stopCam = null; }
      whTab = "stock";
      renderWarehouse();
      setTimeout(function () { if (window.__whOpenProduct) window.__whOpenProduct(p); }, 0);
    }

    // Live phone-camera scan via the BarcodeDetector API where present (modern
    // mobile Chrome/Edge/Android WebView). Where absent, we fall back cleanly to
    // the always-present manual field (no broken state) — the USB/BT wedge also
    // still works by typing into that field.
    var camStage = el("div", { class: "cam-stage", style: "display:none; height:42vh; margin-bottom:1rem" });
    function startCamScan() {
      if (!("BarcodeDetector" in window)) {
        scanFeedback(false, "Kamera-Scan nicht verfügbar",
          "Bitte den Barcode in das Feld scannen oder die SKU eingeben.");
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      var video = el("video", { autoplay: "", muted: "", playsinline: "" });
      camStage.style.display = "";
      clear(camStage); camStage.appendChild(video);
      var detector = new window.BarcodeDetector();
      var raf = null;
      var streamRef = null;
      var done = false;
      var teardown = function () {
        done = true;
        if (raf) cancelAnimationFrame(raf);
        try { if (streamRef) streamRef.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        camStage.style.display = "none"; clear(camStage);
        stopCam = null;
      };
      var scanFrame = function () {
        if (done) return;
        detector.detect(video).then(function (codes) {
          var val;
          if (done) return;
          if (codes && codes.length && codes[0].rawValue) {
            val = String(codes[0].rawValue).trim();
            teardown();
            lookup(val);
            return;
          }
          raf = requestAnimationFrame(scanFrame);
        }).catch(function () { if (!done) raf = requestAnimationFrame(scanFrame); });
      };
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(function (stream) {
          streamRef = stream; video.srcObject = stream;
          stopCam = teardown;
          raf = requestAnimationFrame(scanFrame);
        })
        .catch(function () {
          camStage.style.display = "none";
          scanFeedback(false, "Kamera nicht freigegeben",
            "Bitte Kamerazugriff erlauben oder den Barcode manuell eingeben.");
        });
    }

    var camBtn = ("BarcodeDetector" in window)
      ? el("button", { class: "btn-ghost", type: "button", onclick: startCamScan }, "📷 Kamera-Scan")
      : null;

    var pad = el("div", { class: "pad" }, [
      el("div", { class: "scanwrap" }, [
        el("div", { class: "scan-label" }, [ el("span", { class: "ico" }, "📷"), "Artikel scannen" ]),
        scanInput,
        el("div", { class: "scan-help" },
          "Cursor steht im Feld. Scannen Sie den Barcode (Enter wird automatisch gesendet), " +
          "tippen Sie eine SKU ein und drücken Enter, oder nutzen Sie die Telefon-Kamera."),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn-primary inline", type: "button",
            onclick: function () { lookup(scanInput.value.trim()); } }, "Nachschlagen")
        ].concat(camBtn ? [camBtn] : []))
      ]),
      camStage,
      el("div", { style: "margin-top:1.25rem" }, resultBox)
    ]);
    setTimeout(reset, 0);
    return pad;
  }

  // Warehouse · Bestand — searchable inventory list (photo + name + price + bin)
  // with a per-item detail: rename / re-price / publish-to-web / status / bin
  // change · Hauptbild picker · photo capture · label print.
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
      if (busy) return;
      busy = true;
      clear(detailBox);
      clear(resultBox);
      resultBox.appendChild(el("div", { class: "state-msg" }, "Suche…"));
      // Empty query → recent inventory (helps Basel browse without typing).
      var path = q ? ("products?q=" + encodeURIComponent(q)) : "products";
      proxy(path)
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          busy = false;
          var rows = normalizeProducts(data).slice(0, 80);
          clear(resultBox);
          if (!rows.length) {
            resultBox.appendChild(el("div", { class: "notice info" }, "Kein Artikel gefunden."));
            return;
          }
          var list = el("div", { class: "list" });
          rows.forEach(function (p) { list.appendChild(inventoryRow(p, function () { openDetail(p); })); });
          resultBox.appendChild(list);
        })
        .catch(function (err) {
          busy = false;
          clear(resultBox);
          resultBox.appendChild(el("div", { class: "notice bad" },
            "Suche fehlgeschlagen. (" + (err.message || "Fehler") + ")"));
        });
    }

    function openDetail(p) {
      clear(resultBox);
      clear(detailBox);
      detailBox.appendChild(productDetail(p, function () { run(p.sku || p.name || ""); }));
      try { detailBox.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    }

    window.__whOpenProduct = openDetail;

    var pad = el("div", { class: "pad" }, [
      search,
      el("div", { class: "hint" }, "SKU oder Name eingeben und Enter — oder leer lassen, um den Bestand zu durchsuchen."),
      detailBox,
      resultBox
    ]);
    // Load an initial page so the list isn't empty on open.
    setTimeout(function () { run(""); }, 0);
    return pad;
  }

  // Warehouse · Neu — quick add-a-product form with EAS repeat-entry: after a
  // save we KEEP the form open and carry sticky context (type/condition/tax/bin)
  // forward, clearing only item-unique fields, plus a live batch count+subtotal.
  function whAdd() {
    var msg = el("div", {});
    var busy = false;
    var batchCount = 0;
    var batchCents = 0;

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

    var sticky = loadSticky();

    var skuI   = el("input", { class: "inp", type: "text", autocapitalize: "characters", placeholder: "leer = automatisch" });
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
    var pubChk = el("input", { type: "checkbox", id: "wh-pub" });

    // Restore sticky carry-forward context (NOT the item-unique fields).
    if (sticky.itemType) typeS.value = sticky.itemType;
    if (sticky.condition) condS.value = sticky.condition;
    if (sticky.taxTreatmentCode) taxS.value = sticky.taxTreatmentCode;
    if (sticky.locationStorageUnit) unitI.value = sticky.locationStorageUnit;
    if (sticky.locationDrawer) drwI.value = sticky.locationDrawer;
    if (sticky.locationPosition) posI.value = sticky.locationPosition;

    var batchStrip = el("div", { class: "batchstrip", style: "display:none" }, []);
    function paintBatch() {
      clear(batchStrip);
      if (!batchCount) { batchStrip.style.display = "none"; return; }
      batchStrip.style.display = "";
      batchStrip.appendChild(el("span", { class: "bl" }, "Diese Sitzung"));
      batchStrip.appendChild(el("span", { class: "bv" },
        batchCount + " Artikel · " + fmtEur(centsToDecimal(batchCents))));
    }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: function () { submit(false); } }, "Anlegen & weiter");
    var saveOnceBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () { submit(true); } }, "Anlegen & fertig");

    function setMsg(kind, text) {
      clear(msg);
      msg.appendChild(el("div", { class: "notice " + kind }, text));
    }

    // SKU is now OPTIONAL on the form (brief §3 EAS: auto-derive). If blank we
    // mint a readable client-side SKU so the operator never has to think one up.
    function autoSku() {
      var d = new Date();
      function p(n) { return (n < 10 ? "0" : "") + n; }
      var stamp = String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
      var rnd = Math.floor(1000 + Math.random() * 9000);
      return "W14-" + stamp + "-" + rnd;
    }

    function submit(finish) {
      if (busy) return;
      var sku = skuI.value.trim() || autoSku();
      var name = nameI.value.trim();
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
      if (pubChk.checked)     payload.listedOnStorefront = true;

      busy = true; saveBtn.disabled = true; saveOnceBtn.disabled = true;
      setMsg("info", "Wird angelegt…");
      proxyJson("products", "POST", payload).then(function (res) {
        busy = false; saveBtn.disabled = false; saveOnceBtn.disabled = false;
        scanFeedback(true, "Angelegt: " + name, "SKU " + (res.sku || sku));
        batchCount += 1; batchCents += (priceToCents(listI.value) || 0); paintBatch();

        // Persist sticky carry-forward for the next item.
        saveSticky({
          itemType: typeS.value, condition: condS.value, taxTreatmentCode: taxS.value,
          locationStorageUnit: unitI.value.trim(), locationDrawer: drwI.value.trim(),
          locationPosition: posI.value.trim()
        });

        if (finish) {
          setMsg("ok", "Angelegt: " + (res.sku || sku) + ". Sitzung beendet (" + batchCount + " Artikel).");
          // Reset everything including sticky for a clean finish.
          typeS.selectedIndex = 0; condS.selectedIndex = 0; taxS.selectedIndex = 0;
          unitI.value = ""; drwI.value = ""; posI.value = "";
        } else {
          setMsg("ok", "Angelegt: " + (res.sku || sku) + " (Status " + (res.status || "DRAFT") + "). " +
            "Bin/Art/Steuer bleiben für den nächsten Artikel erhalten.");
        }
        // Clear only item-unique fields (brief §3 EAS: N-field → 3-field for 2…n).
        skuI.value = ""; barI.value = ""; nameI.value = "";
        acqI.value = ""; listI.value = ""; wgtI.value = ""; pubChk.checked = false;
        try { nameI.focus(); } catch (e) {}
      }).catch(function (err) {
        busy = false; saveBtn.disabled = false; saveOnceBtn.disabled = false;
        setMsg("bad", err.message || "Anlegen fehlgeschlagen.");
        scanFeedback(false, "Anlegen fehlgeschlagen", err.message || "");
      });
    }

    // Explicit Duplizieren: clone the LAST item's identity into the form so the
    // operator changes one value and saves (brief §3).
    function duplicate() {
      var s = loadSticky();
      if (s.itemType) typeS.value = s.itemType;
      if (s.condition) condS.value = s.condition;
      if (s.taxTreatmentCode) taxS.value = s.taxTreatmentCode;
      if (s.locationStorageUnit) unitI.value = s.locationStorageUnit;
      if (s.locationDrawer) drwI.value = s.locationDrawer;
      if (s.locationPosition) posI.value = s.locationPosition;
      setMsg("info", "Kontext übernommen — Bezeichnung und Preise anpassen, dann anlegen.");
      try { nameI.focus(); } catch (e) {}
    }

    paintBatch();

    return el("div", { class: "pad" }, [
      batchStrip,
      el("div", { class: "form" }, [
        el("div", { class: "sectionhead" }, "Identität"),
        el("div", { class: "form-row two" }, [
          field("SKU (optional)", skuI, false),
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
        el("label", { class: "toggle", for: "wh-pub" }, [
          pubChk,
          el("span", { class: "track" }),
          el("span", { class: "tlab" }, "Im Webshop anbieten (nach Freigabe)")
        ]),
        el("div", { class: "btn-row" }, [ saveBtn, saveOnceBtn ]),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn-ghost", type: "button", onclick: duplicate }, "Letzten duplizieren")
        ]),
        msg,
        el("div", { class: "scan-help" },
          "Pflichtfelder sind mit * markiert. Art, Zustand, Steuerart und Lagerort werden " +
          "für den nächsten Artikel übernommen. Foto und Etikett für einen angelegten Artikel " +
          "im Tab „Bestand“ → Artikel öffnen.")
      ])
    ]);
  }

  // Warehouse · Drucker — label-printer connection settings (local config).
  function whPrinter() {
    var saved = loadPrinter();
    var msg = el("div", {});

    var modeS = el("select", { class: "sel" }, [
      el("option", { value: "browser" }, "Über dieses Gerät drucken (Browser)"),
      el("option", { value: "mother" }, "Über die Hauptkasse drucken"),
      el("option", { value: "network" }, "Netzwerkdrucker (IP)")
    ]);
    modeS.value = saved.mode || "browser";

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

    function refreshMode() { netBox.style.display = modeS.value === "network" ? "" : "none"; }
    modeS.addEventListener("change", refreshMode);
    refreshMode();

    function setMsg(kind, text) { clear(msg); msg.appendChild(el("div", { class: "notice " + kind }, text)); }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: function () {
        savePrinter({ mode: modeS.value, name: nameI.value.trim(),
          ip: ipI.value.trim(), port: portI.value.trim() || "9100" });
        setMsg("ok", "Etikettendrucker gespeichert.");
      } }, "Speichern");

    var testBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () {
        var cfg = loadPrinter();
        if ((cfg.mode || "browser") === "browser") {
          // Print a sample label through the browser straight away — works today.
          openLabelSheet({ name: "Testdruck", sku: "W14-TEST-0001", priceEur: "0.00",
            barcode: "W14TEST0001" });
          return;
        }
        var target = cfg.mode === "network"
          ? ("Netzwerkdrucker " + (cfg.ip || "—") + ":" + (cfg.port || "9100"))
          : "Hauptkasse";
        setMsg("info", "Testdruck an „" + target + "“ vorgemerkt. " +
          "Der LAN-/Hauptkassen-Druck folgt in einer späteren Phase.");
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
          "„Über dieses Gerät drucken“ öffnet das Etikett im Druckdialog des Telefons/Tablets " +
          "(funktioniert sofort). Direkter LAN-Druck und Druck über die Hauptkasse folgen.")
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

  // Best-effort primary-photo URL from a normalized product (proxied so the
  // companion never needs a separate cloud origin / token).
  function photoThumb(p) {
    var raw = p.primaryPhotoThumbUrl || p.primaryPhotoUrl || p.thumbUrl || p.imageUrl || null;
    if (!raw) return null;
    return proxyPhotoUrl(raw);
  }
  // Map an api-relative photo URL (`/api/photos/<id>/thumb`) to the proxy so it
  // rides the mother's Bearer. Absolute http(s) URLs are used as-is.
  function proxyPhotoUrl(raw) {
    if (!raw) return null;
    var s = String(raw);
    if (/^https?:\/\//i.test(s)) return s;
    var rel = s.replace(/^\/?api\//, "").replace(/^\//, "");
    return "/api/proxy/" + rel + (rel.indexOf("?") >= 0 ? "&" : "?") + "t=" + encodeURIComponent(token);
  }

  // ≥56px inventory row: photo (or glyph) + name + SKU + bin + price.
  function inventoryRow(p, onOpen) {
    var thumbUrl = photoThumb(p);
    var thumb = thumbUrl
      ? el("img", { class: "thumb", src: thumbUrl, alt: "", referrerpolicy: "no-referrer",
          onerror: function (e) { try { e.target.replaceWith(glyphFor(p)); } catch (x) {} } })
      : glyphFor(p);
    return el("button", { class: "invrow", type: "button",
      "aria-label": (p.name || "Artikel") + ", öffnen", onclick: onOpen }, [
      thumb,
      el("div", { class: "meta" }, [
        el("div", { class: "nm" }, String(p.name || "Ohne Namen")),
        el("div", { class: "sub" }, (p.sku ? "SKU " + p.sku : "—") + " · " + compact(p))
      ]),
      el("div", { class: "right" }, [
        el("div", { class: "price" }, fmtEur(p.priceEur != null ? p.priceEur : p.price)),
        el("div", { class: "bin" }, statusShort(p.status))
      ])
    ]);
  }
  function glyphFor(p) {
    var t = String(p.itemType || "");
    var g = /gold/.test(t) ? "🪙" : /silver/.test(t) ? "⚪" : /platinum/.test(t) ? "⬜"
          : /watch/.test(t) ? "⌚" : /antique/.test(t) ? "🏺" : "📦";
    return el("span", { class: "thumb" }, g);
  }
  function statusShort(status) {
    var s = String(status || "").toUpperCase();
    if (s === "AVAILABLE") return "Verfügbar";
    if (s === "DRAFT") return "Entwurf";
    if (s === "RESERVED") return "Reserviert";
    if (s === "SOLD") return "Verkauft";
    return s || "—";
  }

  // Compact product result card with an "Öffnen" affordance (scan results).
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

  // Editable product detail: rename / re-price / publish-to-web / status (PUT) +
  // bin change (POST inventory-adjustment) + photo capture/upload + Hauptbild
  // picker + label print. Each block is its own calm zone (brief §5c whitespace).
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
    var pubChk = el("input", { type: "checkbox", id: "det-pub-" + p.id });
    if (p.isPublishedToWeb === true || p.listedOnStorefront === true) pubChk.checked = true;
    var pubInitial = pubChk.checked;

    var unitI = el("input", { class: "inp", type: "text", value: p.locationStorageUnit || "", placeholder: "Einheit" });
    var drwI  = el("input", { class: "inp", type: "text", value: p.locationDrawer || "", placeholder: "Fach" });
    var posI  = el("input", { class: "inp", type: "text", value: p.locationPosition || "", placeholder: "Position" });
    var binNoteI = el("input", { class: "inp", type: "text", placeholder: "Grund (min. 8 Zeichen)" });

    function setMsg(kind, text) { clear(msg); msg.appendChild(el("div", { class: "notice " + kind }, text)); }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button", onclick: saveProduct }, "Änderungen speichern");
    var binBtn = el("button", { class: "btn-ghost", type: "button", onclick: saveBin }, "Lagerort übernehmen");

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
      if (pubChk.checked !== pubInitial) body.isPublishedToWeb = pubChk.checked;
      if (!Object.keys(body).length) { setMsg("info", "Keine Änderungen."); return; }

      busy = true; saveBtn.disabled = true; setMsg("info", "Wird gespeichert…");
      proxyJson("products/" + encodeURIComponent(p.id), "PUT", body).then(function (res) {
        busy = false; saveBtn.disabled = false;
        var changed = (res.changedFields || []).length;
        setMsg("ok", "Gespeichert" + (changed ? " (" + changed + " Feld(er) geändert)." : "."));
        pubInitial = pubChk.checked;
        if (onSaved) setTimeout(onSaved, 800);
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
          if (onSaved) setTimeout(onSaved, 800);
        }).catch(function (err) {
          busy = false; binBtn.disabled = false;
          setMsg("bad", err.message || "Lagerort-Änderung fehlgeschlagen.");
        });
    }

    // Photo block: capture/upload + Hauptbild picker, refreshed from the cloud.
    var photoBox = el("div", {});
    function refreshPhotos() {
      clear(photoBox);
      photoBox.appendChild(el("div", { class: "state-msg" }, "Fotos werden geladen…"));
      proxy("products/" + encodeURIComponent(p.id) + "/photos")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var photos = (data && Array.isArray(data.items)) ? data.items : (Array.isArray(data) ? data : []);
          clear(photoBox);
          if (!photos.length) {
            photoBox.appendChild(el("div", { class: "scan-help" }, "Noch keine Fotos. Mit „Foto aufnehmen“ ein Bild hinzufügen."));
            return;
          }
          var grid = el("div", { class: "photogrid" }, photos.map(function (ph) {
            var url = proxyPhotoUrl(ph.thumbUrl || ph.publicUrl);
            var cell = el("button", { class: "photocell", type: "button",
              "aria-pressed": ph.isPrimary ? "true" : "false",
              "aria-label": ph.isPrimary ? "Hauptbild" : "Als Hauptbild wählen",
              onclick: function () { setPrimary(ph.id); } }, [
              url ? el("img", { src: url, alt: "", referrerpolicy: "no-referrer",
                onerror: function (e) { try { e.target.replaceWith(el("span", { class: "ph" }, "🖼️")); } catch (x) {} } })
                : el("span", { class: "ph" }, "🖼️"),
              ph.isPrimary ? el("span", { class: "star" }, "★") : null
            ]);
            return cell;
          }));
          photoBox.appendChild(el("div", { class: "scan-help", style: "margin-bottom:.5rem" },
            "Tippen Sie ein Bild an, um es als Hauptbild zu wählen."));
          photoBox.appendChild(grid);
        })
        .catch(function (err) {
          clear(photoBox);
          photoBox.appendChild(el("div", { class: "notice info" },
            "Fotos konnten nicht geladen werden. (" + (err.message || "Fehler") + ")"));
        });
    }
    function setPrimary(photoId) {
      setMsg("info", "Hauptbild wird gesetzt…");
      proxyJson("photos/" + encodeURIComponent(photoId) + "/primary", "PATCH", {})
        .then(function () { setMsg("ok", "Hauptbild aktualisiert."); refreshPhotos(); })
        .catch(function (err) { setMsg("bad", err.message || "Hauptbild konnte nicht gesetzt werden."); });
    }

    var photoBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () {
        openCameraSheet(function (blob, isPrimary) {
          uploadPhoto(p.id, blob, isPrimary, function (ok, message) {
            if (ok) { setMsg("ok", "Foto hochgeladen."); refreshPhotos(); }
            else setMsg("bad", message || "Foto-Upload fehlgeschlagen.");
          });
        });
      } }, "📷 Foto aufnehmen");

    var labelBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () {
        openLabelSheet({
          name: nameI.value.trim() || p.name || "Artikel",
          sku: p.sku || "",
          priceEur: normalizeDecimal(priceI.value) || (p.priceEur != null ? p.priceEur : p.price),
          barcode: p.barcode || p.sku || ""
        });
      } }, "🏷️ Etikett drucken");

    refreshPhotos();

    return el("div", { class: "skuhit" }, [
      el("div", { class: "sectionhead", style: "margin-top:0" }, "Bearbeiten"),
      kv("SKU", p.sku || "—"),
      el("div", { class: "form", style: "margin-top:.5rem" }, [
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Bezeichnung"), nameI ]),
        el("div", { class: "form-row two" }, [
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Verkaufspreis (€)"), priceI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Status"), statusS ])
        ]),
        el("label", { class: "toggle", for: "det-pub-" + p.id }, [
          pubChk, el("span", { class: "track" }),
          el("span", { class: "tlab" }, "Im Webshop anbieten")
        ]),
        el("div", { class: "btn-row" }, [ saveBtn ]),

        el("div", { class: "sectionhead" }, "Fotos"),
        photoBox,
        el("div", { class: "btn-row" }, [ photoBtn, labelBtn ]),

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

  // ── Camera capture sheet (phone camera → JPEG blob) ────────────────
  // A full-screen sheet: live preview → shutter → review → "Verwenden" with an
  // optional "als Hauptbild" toggle. On Use, hands the blob to `onCapture`.
  function openCameraSheet(onCapture) {
    var streamRef = null;
    var captured = null; // Blob once shot.
    var primaryChk = el("input", { type: "checkbox", id: "cam-primary", checked: "" });

    var video = el("video", { autoplay: "", muted: "", playsinline: "" });
    var stage = el("div", { class: "cam-stage" }, [ video ]);
    var canvas = document.createElement("canvas");

    var shutter = el("button", { class: "shutter", type: "button", "aria-label": "Foto aufnehmen", onclick: shoot });
    var retakeBtn = el("button", { class: "btn-ghost", type: "button", style: "display:none", onclick: retake }, "Neu aufnehmen");
    var useBtn = el("button", { class: "btn-primary inline", type: "button", style: "display:none", onclick: useShot }, "Verwenden");
    var primaryRow = el("label", { class: "toggle", for: "cam-primary", style: "display:none; justify-content:center" }, [
      primaryChk, el("span", { class: "track" }), el("span", { class: "tlab" }, "Als Hauptbild")
    ]);

    var controls = el("div", { class: "cam-controls" }, [ shutter ]);

    var sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Foto aufnehmen" }, [
      el("div", { class: "sheet-head" }, [
        el("span", { class: "t" }, "Foto aufnehmen"),
        el("button", { class: "x", type: "button", "aria-label": "Schließen", onclick: close }, "×")
      ]),
      el("div", { class: "sheet-body" }, [
        stage,
        primaryRow,
        el("div", { class: "btn-row" }, [ retakeBtn, useBtn ]),
        controls
      ])
    ]);
    document.body.appendChild(sheet);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      clear(stage);
      stage.appendChild(el("div", { class: "ph" }, "Kamera auf diesem Gerät nicht verfügbar."));
      shutter.disabled = true;
    } else {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1920 } } })
        .then(function (stream) { streamRef = stream; video.srcObject = stream; })
        .catch(function () {
          clear(stage);
          stage.appendChild(el("div", { class: "ph" }, "Kamerazugriff nicht erlaubt. Bitte in den Einstellungen freigeben."));
          shutter.disabled = true;
        });
    }

    function shoot() {
      var w = video.videoWidth || 1280;
      var h = video.videoHeight || 1280;
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(function (blob) {
        if (!blob) return;
        captured = blob;
        var img = el("img", { alt: "Aufnahme" });
        img.src = URL.createObjectURL(blob);
        clear(stage); stage.appendChild(img);
        shutter.style.display = "none";
        retakeBtn.style.display = ""; useBtn.style.display = "";
        primaryRow.style.display = "";
      }, "image/jpeg", 0.9);
    }
    function retake() {
      captured = null;
      clear(stage); stage.appendChild(video);
      shutter.style.display = ""; retakeBtn.style.display = "none";
      useBtn.style.display = "none"; primaryRow.style.display = "none";
    }
    function useShot() {
      if (!captured) return;
      var blob = captured;
      var isPrimary = primaryChk.checked;
      close();
      onCapture(blob, isPrimary);
    }
    function close() {
      try { if (streamRef) streamRef.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { sheet.remove(); } catch (e) {}
    }
  }

  // Upload a captured JPEG via the proxy → POST /api/photos/upload (bytes
  // through the API, no R2 CORS dependency — the durable POS path).
  function uploadPhoto(productId, blob, isPrimary, done) {
    blobToBase64(blob).then(function (b64) {
      var payload = { dataBase64: b64, contentType: "image/jpeg", productId: productId, intent: "product" };
      if (isPrimary) payload.isPrimary = true;
      return proxyJson("photos/upload", "POST", payload);
    }).then(function () {
      scanFeedback(true, "Foto hochgeladen", null);
      done(true);
    }).catch(function (err) {
      scanFeedback(false, "Foto-Upload fehlgeschlagen", err.message || "");
      done(false, err.message);
    });
  }
  function blobToBase64(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      var binary = "";
      var chunk = 0x8000;
      var i;
      for (i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    });
  }

  // ── Label / barcode (client-side Code128 → browser print) ──────────
  // Template-once thermal layout: shop · name · price · bin · Code128 + SKU.
  // Printing runs through the device's own print dialog (works today on phone
  // /tablet); LAN/mother print is a later phase (see Drucker tab).
  function openLabelSheet(item) {
    var codeText = sanitizeCode(item.barcode || item.sku || "");
    var labelEl = buildLabelCard(item, codeText);

    var sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Etikett" }, [
      el("div", { class: "sheet-head" }, [
        el("span", { class: "t" }, "Etikett"),
        el("button", { class: "x", type: "button", "aria-label": "Schließen",
          onclick: function () { try { sheet.remove(); } catch (e) {} } }, "×")
      ]),
      el("div", { class: "sheet-body" }, [
        el("div", { style: "flex:1; display:grid; place-items:center; overflow:auto" }, [ labelEl ]),
        el("div", { class: "btn-row" }, [
          el("button", { class: "btn-primary inline", type: "button",
            onclick: function () { printLabel(item, codeText); } }, "Drucken")
        ]),
        el("div", { class: "scan-help" },
          "Der Druck öffnet den Druckdialog dieses Geräts. Standardisieren Sie die Etikett-Position " +
          "je Produkttyp, damit spätere Scans zuverlässig sind.")
      ])
    ]);
    document.body.appendChild(sheet);
  }

  // Only the Code128 subset we render: ASCII 32..126. Strip the rest.
  function sanitizeCode(raw) {
    return String(raw || "").replace(/[^\x20-\x7e]/g, "").slice(0, 48) || "W14";
  }

  function buildLabelCard(item, codeText) {
    var price = item.priceEur != null ? item.priceEur : item.price;
    return el("div", { class: "label-card" }, [
      el("div", { class: "lname" }, String(item.name || "Artikel")),
      el("div", { class: "lmeta" }, "Warehouse14 · Schorndorf"),
      el("div", { class: "lprice" }, fmtEur(price)),
      code128Svg(codeText),
      el("div", { class: "lcode" }, codeText)
    ]);
  }

  // Open a clean print window with ONLY the label, so the device print dialog
  // produces a tight thermal-style output. Built with DOM nodes (no innerHTML
  // of any cloud string) then serialized for the print document.
  function printLabel(item, codeText) {
    var w = window.open("", "_blank", "width=420,height=320");
    if (!w) { alert("Bitte Pop-ups erlauben, um das Etikett zu drucken."); return; }
    var card = buildLabelCard(item, codeText);
    var doc = w.document;
    doc.title = "Etikett " + codeText;
    var style = doc.createElement("style");
    style.textContent =
      "@page{size:62mm 30mm;margin:2mm}" +
      "body{margin:0;font-family:system-ui,sans-serif}" +
      ".label-card{color:#000}" +
      ".label-card .lname{font-weight:700;font-size:13px;line-height:1.2}" +
      ".label-card .lmeta{font-size:9px;color:#444;margin-top:1px}" +
      ".label-card .lprice{font-weight:800;font-size:17px;margin:3px 0}" +
      ".label-card svg{display:block;width:100%;height:46px}" +
      ".label-card .lcode{font-family:monospace;font-size:9px;text-align:center;letter-spacing:.1em;margin-top:1px}";
    doc.head.appendChild(style);
    doc.body.appendChild(card);
    // Give the layout a tick, then print.
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) {} }, 250);
  }

  // Minimal Code128-B encoder → an SVG of bars. Pure local geometry; no cloud
  // string is ever interpolated as markup (svgEl sets numeric attributes only).
  function code128Svg(text) {
    var patterns = CODE128_PATTERNS;
    var data = String(text);
    var START_B = 104;
    var STOP = 106;
    var values = [START_B];
    var i;
    var c;
    var j;
    for (i = 0; i < data.length; i++) {
      c = data.charCodeAt(i) - 32; // Code128-B: ASCII 32 → value 0.
      if (c < 0 || c > 94) c = 0;
      values.push(c);
    }
    // Checksum: start + Σ(value_i * position_i), mod 103.
    var sum = START_B;
    for (j = 1; j < values.length; j++) sum += values[j] * j;
    values.push(sum % 103);
    values.push(STOP);

    // Build the module string (each pattern is 6 widths: bar,space,bar,...).
    var modules = [];
    values.forEach(function (v) {
      var pat = patterns[v];
      var k;
      for (k = 0; k < pat.length; k++) modules.push(Number.parseInt(pat[k], 10));
    });
    modules.push(2); // final stop bar.

    var unit = 2;
    var x = 0;
    var h = 46;
    var totalWidth = modules.reduce(function (a, b) { return a + b; }, 0) * unit;
    var rects = [];
    var isBar = true;
    modules.forEach(function (m) {
      var w = m * unit;
      if (isBar) {
        rects.push(svgEl("rect", { x: String(x), y: "0", width: String(w), height: String(h), fill: "#000" }));
      }
      x += w; isBar = !isBar;
    });
    return svgEl("svg", {
      viewBox: "0 0 " + totalWidth + " " + h, width: "100%", height: String(h),
      preserveAspectRatio: "none", role: "img", "aria-label": "Barcode"
    }, rects);
  }

  // Code128 width patterns, indexed by code value 0..106. Each is 6 module
  // widths (bar/space alternating). Standard table (values 0–95 = set B chars,
  // 96–102 = special, 103/104/105 start, 106 stop).
  var CODE128_PATTERNS = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];

  // ── Local config (per device) ──────────────────────────────────────
  function loadPrinter() {
    try { return JSON.parse(localStorage.getItem(LS_PRINTER) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function savePrinter(cfg) {
    try { localStorage.setItem(LS_PRINTER, JSON.stringify(cfg)); } catch (e) {}
  }
  function loadSticky() {
    try { return JSON.parse(localStorage.getItem(LS_STICKY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveSticky(cfg) {
    try { localStorage.setItem(LS_STICKY, JSON.stringify(cfg)); } catch (e) {}
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
        itemType: p.itemType,
        isPublishedToWeb: p.isPublishedToWeb,
        listedOnStorefront: p.listedOnStorefront,
        primaryPhotoThumbUrl: p.primaryPhotoThumbUrl || null,
        primaryPhotoUrl: p.primaryPhotoUrl || null,
        thumbUrl: p.thumbUrl || null,
        imageUrl: p.imageUrl || null
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
