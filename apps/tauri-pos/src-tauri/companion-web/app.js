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
  // Tax treatment codes — MUST match the cloud's TaxTreatmentCode union exactly
  // (MARGIN_25A / STANDARD_19 / REDUCED_7 / INVESTMENT_GOLD_25C / REVERSE_CHARGE_13B);
  // any other value makes POST /products 400. Differenzbesteuerung §25a is the
  // default (the common case for a used-goods/gold/antiques dealer).
  var TAX_CODES = [
    ["MARGIN_25A",          "Differenzbesteuerung §25a"],
    ["STANDARD_19",         "Regelbesteuerung 19 %"],
    ["REDUCED_7",           "Ermäßigt 7 %"],
    ["INVESTMENT_GOLD_25C", "Anlagegold §25c (steuerfrei)"],
    ["REVERSE_CHARGE_13B",  "Reverse-Charge §13b"]
  ];

  // Appointment types (cloud enum → German label + tile icon). Mirrors
  // packages/api-client APPOINTMENT_TYPE_LABELS; chip label per design brief.
  var APPT_TYPES = [
    ["VIEWING",      "Besichtigung", "👁"],
    ["BUYBACK_EVAL", "Ankauf",       "🪙"],
    ["CONSULTATION", "Beratung",     "💬"],
    ["PICKUP",       "Abholung",     "📦"]
  ];
  function apptTypeLabel(t) {
    var i;
    for (i = 0; i < APPT_TYPES.length; i++) {
      if (APPT_TYPES[i][0] === t) return APPT_TYPES[i][1];
    }
    return t || "Termin";
  }
  // Appointment status → German label + pill style (av/dr/muted/bad).
  var APPT_STATUS = {
    SCHEDULED:   ["Geplant",           "muted"],
    CONFIRMED:   ["Bestätigt",         "dr"],
    CHECKED_IN:  ["Eingecheckt",       "av"],
    IN_PROGRESS: ["Läuft",             "av"],
    COMPLETED:   ["Abgeschlossen",     "muted"],
    NO_SHOW:     ["Nicht erschienen",  "bad"],
    CANCELLED:   ["Storniert",         "bad"],
    RESCHEDULED: ["Verschoben",        "muted"]
  };

  // ── State ──────────────────────────────────────────────────────────
  var token = localStorage.getItem(LS_TOKEN) || "";
  var role  = localStorage.getItem(LS_ROLE)  || "";
  var displayTimer = null;     // GET /cart poll fallback interval.
  var displaySocket = null;    // live customer-display WebSocket (/ws).
  var displayReconnect = null; // pending socket-reconnect timer.
  var whTab = "scan"; // active warehouse tool tab.
  var snackTimer = null; // active undo-snackbar timer.
  var zkTab = "kasse"; // active Zweitkasse tab (kasse | termine).
  var zkCart = []; // Zweitkasse cart — module scope so a tab switch keeps it.
  var zkPagehideHandler = null; // single live pagehide-release listener.
  var activeCamTeardown = null; // module handle to the live camera teardown (if any).
  var apptDayKey = ""; // selected Termine day (YYYY-MM-DD local), set lazily.
  var apptTimer = null; // 60s Termine refresh interval (visible-tab only).
  var apptVisHandler = null; // visibilitychange hook for the Termine poll.
  var custNames = {}; // in-memory customer-id → name cache (NEVER persisted).
  var sessionChecked = false; // stored token revalidated against the mother.

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

  // ── Termine helpers ────────────────────────────────────────────────
  // Parse a cloud timestamp. postgres-js returns timestamptz as TEXT like
  // "2026-06-10 09:00:00+00" — Safari/WebKit rejects the space + short offset,
  // so normalise to strict ISO before Date().
  function parseTs(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    s = s.replace(" ", "T");
    if (/[+-]\d\d$/.test(s)) s += ":00";
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  // Local-day key (YYYY-MM-DD) — the Termine strip thinks in shop-local days.
  function dayKeyOf(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function dayKeyToDate(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key) || "");
    if (!m) return new Date();
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  // [fromIso, toIso) UTC bounds of one local day — what GET /appointments wants.
  function dayBoundsIso(key) {
    var d = dayKeyToDate(key);
    var from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return [from.toISOString(), to.toISOString()];
  }
  function fmtTimeHM(d) {
    if (!d) return "—";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }
  var WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  var WEEKDAYS_DE_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  var MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"];
  function fmtDayLong(key) {
    var d = dayKeyToDate(key);
    return WEEKDAYS_DE_LONG[d.getDay()] + ", " + d.getDate() + ". " + MONTHS_DE[d.getMonth()];
  }
  // 60s day-refresh, gated on tab visibility; an extra immediate refresh fires
  // the moment the tab becomes visible again (stale list never greets Basel).
  function startApptPoll(fn) {
    stopApptPoll();
    apptTimer = setInterval(function () {
      if (document.visibilityState === "visible") fn();
    }, 60000);
    apptVisHandler = function () {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", apptVisHandler);
  }
  function stopApptPoll() {
    if (apptTimer) { clearInterval(apptTimer); apptTimer = null; }
    if (apptVisHandler) {
      document.removeEventListener("visibilitychange", apptVisHandler);
      apptVisHandler = null;
    }
  }
  // Tear down any live camera stream + scan loop. A getUserMedia stream is NOT
  // stopped by removing its <video> from the DOM, so a tab/role switch would
  // otherwise leave the camera LED on and the device decoding frames in the
  // background. Each scan/capture path registers its teardown here.
  function stopActiveCamera() {
    if (activeCamTeardown) {
      try { activeCamTeardown(); } catch (e) {}
      activeCamTeardown = null;
    }
  }
  // Release every Zweitkasse reservation hold back to AVAILABLE. POS holds carry
  // NO server-side expiry (the sweeper only frees rows that have one), so if we
  // drop the cart without releasing — logout / role switch — those unique items
  // are stranded RESERVED forever. MUST run while the token is still valid.
  function releaseZkHolds() {
    zkCart.forEach(function (l) {
      if (l && l.id && l.reservationSessionId) {
        proxyJson("inventory/release", "POST", {
          productId: l.id, sessionId: l.reservationSessionId, reason: "pos_cart_cleared"
        }).catch(function () { /* best-effort */ });
      }
    });
  }
  // A horizontally-scrolling tab bar (warehouse has 5 tabs) reveals "more →" via
  // a right-edge fade and brings the active tab into view, so e.g. "Drucker" is
  // never silently off-screen on a 360–390px phone.
  function wireTabOverflow(tabsEl) {
    function sync() {
      var more = tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 4;
      tabsEl.classList.toggle("has-more", more);
    }
    tabsEl.addEventListener("scroll", sync, { passive: true });
    setTimeout(function () {
      var sel = tabsEl.querySelector('[aria-selected="true"]');
      if (sel && sel.scrollIntoView) {
        try { sel.scrollIntoView({ inline: "center", block: "nearest" }); } catch (e) {}
      }
      sync();
    }, 0);
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

  // A styled in-app confirm dialog. Replaces window.confirm(), which renders as a
  // tiny unstyled OS popup on a kiosk tablet (and is suppressed on some WebViews).
  // Two large buttons; the primary is danger-styled when destructive.
  function confirmSheet(opts) {
    var onConfirm = opts.onConfirm || function () {};
    var sheet;
    function close() { try { sheet.remove(); } catch (e) {} }
    var confirmBtn = el("button", {
      class: "btn-primary inline" + (opts.danger ? " danger" : ""), type: "button",
      onclick: function () { close(); onConfirm(); } }, opts.confirmLabel || "Bestätigen");
    var cancelBtn = el("button", { class: "btn-ghost", type: "button", onclick: close },
      opts.cancelLabel || "Abbrechen");
    sheet = el("div", { class: "sheet", role: "alertdialog", "aria-label": opts.title || "Bestätigen" }, [
      el("div", { class: "sheet-head" }, [
        el("span", { class: "t" }, opts.title || "Bestätigen"),
        el("button", { class: "x", type: "button", "aria-label": "Schließen", onclick: close }, "×")
      ]),
      el("div", { class: "sheet-body" }, [
        el("div", { class: "form" }, [
          opts.body ? el("div", { class: "notice info" }, opts.body) : null,
          el("div", { class: "btn-row" }, [ cancelBtn, confirmBtn ])
        ])
      ])
    ]);
    document.body.appendChild(sheet);
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
    stopApptPoll();
    stopActiveCamera();
    // Free held stock + drop the pagehide listener BEFORE the token is cleared,
    // otherwise the reservations are stranded and a stale listener lingers.
    releaseZkHolds();
    if (zkPagehideHandler) {
      try { window.removeEventListener("pagehide", zkPagehideHandler); } catch (e) {}
      zkPagehideHandler = null;
    }
    token = ""; role = "";
    sessionChecked = false;
    zkCart = [];
    custNames = {};
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_ROLE);
    render();
  }

  // ── Silent reconnect (stored token → straight to the role home) ────
  // On load with a stored token we do NOT show the pairing QR flow again.
  // Instead: a calm "Verbindung wird wiederhergestellt…" state while the token
  // is revalidated against the mother (GET /cart — cheap, any-role). Network
  // trouble keeps retrying quietly; ONLY a definitive 401/403 (token rejected/
  // expired) surfaces the re-pair CTA.
  function renderReconnect() {
    stopDisplayTimer();
    stopDisplaySocket();
    stopApptPoll();
    clear(app);

    var attempts = 0;
    var alive = true;
    var statusLine = el("p", { class: "sub", role: "status", "aria-live": "polite" },
      "Die Kopplung mit der Hauptkasse wird geprüft…");
    var hintBox = el("div", {});
    var card = el("div", { class: "card" }, [
      el("div", { class: "reconnect-dot", "aria-hidden": "true" }),
      el("h1", {}, "Verbindung wird wiederhergestellt…"),
      statusLine,
      hintBox
    ]);
    app.appendChild(el("div", { class: "screen" }, [
      el("div", { class: "center" }, card)
    ]));

    function showRejected() {
      if (!alive) return;
      alive = false;
      clear(card);
      card.appendChild(el("h1", {}, "Kopplung abgelaufen"));
      card.appendChild(el("p", { class: "sub" },
        "Die Hauptkasse erkennt dieses Gerät nicht mehr. Bitte koppeln Sie es neu — " +
        "den Code finden Sie an der Hauptkasse unter Einstellungen → Geräte koppeln."));
      card.appendChild(el("button", { class: "btn-primary", type: "button",
        onclick: function () { logout(); } }, "Neu koppeln"));
    }

    function retry() {
      if (!alive) return;
      attempts += 1;
      statusLine.textContent = "Hauptkasse nicht erreichbar — neuer Versuch…";
      if (attempts === 3) {
        clear(hintBox);
        hintBox.appendChild(el("div", { class: "notice info" },
          "Stellen Sie sicher, dass die Hauptkasse eingeschaltet ist und dieses Gerät " +
          "im selben WLAN bleibt. Die Verbindung wird automatisch wiederhergestellt."));
      }
      setTimeout(attempt, 3000);
    }

    function attempt() {
      if (!alive || !token) return;
      fetch("/cart", { headers: { "X-Companion-Token": token } })
        .then(function (r) {
          if (!alive) return;
          if (r.ok) { alive = false; sessionChecked = true; render(); return; }
          if (r.status === 401 || r.status === 403) { showRejected(); return; }
          retry();
        })
        .catch(function () { retry(); });
    }

    attempt();
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
          var warn = (role === "cashier" && zkCart.length)
            ? ("Der aktuelle Warenkorb (" + zkCart.length + " Artikel) wird freigegeben und geleert. " +
               "Zum Fortfahren brauchen Sie den Kopplungscode der Hauptkasse.")
            : "Dieses Gerät wird abgemeldet. Zum Fortfahren brauchen Sie den Kopplungscode der Hauptkasse.";
          confirmSheet({
            title: "Rolle wechseln?", body: warn,
            confirmLabel: "Rolle wechseln", danger: true, onConfirm: logout
          });
        } }, "Rolle wechseln")
    ]);
  }

  // ── Pairing screen (2 steps: code → BIG role tiles) ────────────────
  function renderPairing() {
    stopDisplayTimer();
    stopDisplaySocket();
    stopApptPoll();
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
          sessionChecked = true; // freshly minted by the mother — no re-check.
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
    stopApptPoll();
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

  // ── Cart VAT math (PORT of apps/tauri-pos/src/lib/cart-math.ts) ─────
  // The cloud's finalize route RE-VALIDATES every number with Decimal.js
  // (transaction-math.ts), so a wrong client total returns 400 — never wrong
  // money. We mirror the exact bigint-cents rules here so the body we send
  // matches: HALF_EVEN rounding, VAT decomposed out of the gross line total.
  //
  // JS Number is safe for these magnitudes (cents stay well below 2^53 for any
  // realistic shop total), but we use only integer arithmetic + an explicit
  // banker's-rounding helper so the result is bit-identical to the server.
  //
  //   STANDARD_19          vat = round(total*19/119)        subtotal = total-vat
  //   REDUCED_7            vat = round(total*7/107)         subtotal = total-vat
  //   MARGIN_25A           margin = max(0, total-cost); vat = round(margin*19/119)
  //   INVESTMENT_GOLD_25C  vat = 0                          subtotal = total
  //   REVERSE_CHARGE_13B   subtotal = round(total*100/119); vat = 0; total := subtotal
  function roundHalfEvenInt(num, den) {
    // num, den are non-negative integers here (line totals/costs are ≥ 0).
    var q = Math.floor(num / den);
    var r = num - q * den;
    var twice = r * 2;
    if (twice < den) return q;
    if (twice > den) return q + 1;
    return q % 2 === 0 ? q : q + 1; // tie → even
  }
  // Compute the per-line tax breakdown in integer cents from a gross line total.
  // Returns the exact field set the finalize line item needs.
  function computeLineMathCents(taxCode, lineTotalCents, acqCostCents) {
    var total = lineTotalCents;
    var cost = acqCostCents || 0;
    switch (taxCode) {
      case "STANDARD_19": {
        var vat19 = roundHalfEvenInt(total * 19, 119);
        return { totalC: total, vatC: vat19, subtotalC: total - vat19,
          marginC: null, appliedVatRate: "0.1900", acqSnapshotC: null };
      }
      case "REDUCED_7": {
        var vat7 = roundHalfEvenInt(total * 7, 107);
        return { totalC: total, vatC: vat7, subtotalC: total - vat7,
          marginC: null, appliedVatRate: "0.0700", acqSnapshotC: null };
      }
      case "MARGIN_25A": {
        var rawMargin = total - cost;
        var margin = rawMargin < 0 ? 0 : rawMargin;
        var vatM = roundHalfEvenInt(margin * 19, 119);
        return { totalC: total, vatC: vatM, subtotalC: total - vatM,
          marginC: margin, appliedVatRate: null, acqSnapshotC: cost };
      }
      case "INVESTMENT_GOLD_25C":
        return { totalC: total, vatC: 0, subtotalC: total,
          marginC: null, appliedVatRate: null, acqSnapshotC: null };
      case "REVERSE_CHARGE_13B": {
        var sub13 = roundHalfEvenInt(total * 100, 119);
        return { totalC: sub13, vatC: 0, subtotalC: sub13,
          marginC: null, appliedVatRate: "0.0000", acqSnapshotC: null };
      }
      default:
        return { totalC: total, vatC: 0, subtotalC: total,
          marginC: null, appliedVatRate: null, acqSnapshotC: null };
    }
  }
  // Mirror cart-math.classifyCartProductTax — pick the treatment code from the
  // product row when the cloud did not already hand us one. Kept deliberately
  // conservative: anything we cannot positively classify falls to STANDARD_19,
  // which the server then re-validates against the item's own snapshot.
  var TAX_CODE_VALUES = {
    MARGIN_25A: true, INVESTMENT_GOLD_25C: true, STANDARD_19: true,
    REDUCED_7: true, MIXED: true, REVERSE_CHARGE_13B: true
  };
  function classifyCartProductTaxJs(p) {
    var itemType = String(p.itemType || "");
    var purity = p.finenessDecimal != null ? parseFloat(String(p.finenessDecimal)) : 0;
    if (!isFinite(purity)) purity = 0;
    var yearMinted = (typeof p.yearMintedFrom === "number") ? p.yearMintedFrom
      : (p.yearMintedFrom != null ? parseInt(p.yearMintedFrom, 10) : null);

    if (itemType === "gold_bar" && purity >= 0.995) return "INVESTMENT_GOLD_25C";
    if (itemType === "gold_coin" && purity >= 0.9 &&
        typeof yearMinted === "number" && yearMinted >= 1800) {
      return "INVESTMENT_GOLD_25C";
    }
    var isSecondHand = (p.acquiredFromCustomerId != null) || p.isCommission === true;
    var secondHandTypes = {
      gold_jewelry: 1, gold_coin: 1, silver_jewelry: 1, silver_coin: 1,
      platinum_jewelry: 1, platinum_coin: 1, antique: 1, watch: 1
    };
    if (isSecondHand && secondHandTypes[itemType]) return "MARGIN_25A";
    return "STANDARD_19";
  }
  // Resolve the treatment code for a fetched product row: prefer an explicit
  // cloud-provided code (taxTreatmentCode), else classify locally.
  function resolveTaxCode(p) {
    var raw = p.taxTreatmentCode || p.taxTreatmentCodeApplied || null;
    if (raw && TAX_CODE_VALUES[raw]) return raw;
    return classifyCartProductTaxJs(p);
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
    stopApptPoll();
    clear(app);
    app.appendChild(topbar());

    // Two tools on the Zweitkasse: the ring-up Kasse + a READ-ONLY Termine
    // day view (status changes + booking stay on the Lager device/mother).
    var ZK_TABS = [
      ["kasse",   "Kasse"],
      ["termine", "Termine"]
    ];
    var bodyBox = el("div", {});

    function drawTabs() {
      return el("div", { class: "tabs", role: "tablist" }, ZK_TABS.map(function (t) {
        return el("button", {
          class: "tab", type: "button", role: "tab",
          "aria-selected": t[0] === zkTab ? "true" : "false",
          onclick: function () { zkTab = t[0]; mount(); }
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
      stopApptPoll();
      stopActiveCamera();
      clear(bodyBox);
      if (zkTab === "termine") bodyBox.appendChild(terminePane(true));
      else bodyBox.appendChild(zkKassePane());
    }
    mount();
  }

  // The Zweitkasse ring-up pane. The cart lives in module scope (zkCart) so a
  // Termine peek never wipes a half-built sale. This is a REAL till: each add
  // takes an inventory reservation (so the same unique item can't be double-
  // sold), each line carries the cloud's own taxTreatmentCode +
  // acquisitionCostEur (fetched from products/<id>), and Bezahlen posts a
  // genuine CASH-only finalize. The server re-validates ALL VAT math, so a
  // wrong client total returns 400 — never wrong money.
  function zkKassePane() {
    var statusMsg = el("div", { class: "state-msg" }, "Katalog wird geladen…");
    var listBox = el("div", { class: "list" });
    var all = [];
    var stopCam = null; // active live-scan teardown (if any).
    var addingKey = null; // product id currently being reserved (guards taps).

    // Each cart line is a UNIQUE item → qty is always 1.
    //   { key, id, sku, name, unitCents, taxCode, acqCostCents,
    //     reservationSessionId }
    var cart = zkCart;
    var cartBox = el("div", {});
    var bottomBar = el("div", {}); // thumb-zone Bezahlen bar (fixed).

    var search = el("input", {
      class: "search", type: "search", placeholder: "Artikel suchen oder Barcode scannen…",
      "aria-label": "Artikel suchen",
      oninput: function (e) { paint(e.target.value.trim().toLowerCase()); }
    });

    // Release every held line back to AVAILABLE — best-effort (used on tab
    // teardown / page hide; the server auto-releases stale holds anyway).
    function releaseAll(reason) {
      cart.forEach(function (l) {
        if (l.id && l.reservationSessionId) {
          proxyJson("inventory/release", "POST", {
            productId: l.id, sessionId: l.reservationSessionId,
            reason: reason || "pos_cart_cleared"
          }).catch(function () { /* best-effort */ });
        }
      });
    }
    // Arm a one-shot pagehide release so a closed tab never strands a hold.
    // A prior pane's handler (Termine→Kasse re-mount) is cleared first so only
    // one is ever live — module-scoped so re-entry can find it.
    if (zkPagehideHandler) {
      try { window.removeEventListener("pagehide", zkPagehideHandler); } catch (e) {}
    }
    var pagehideHandler = function () { releaseAll("pos_cart_cleared"); };
    zkPagehideHandler = pagehideHandler;
    window.addEventListener("pagehide", pagehideHandler);

    // Reserve a product, then fetch its full record (taxTreatmentCode +
    // acquisitionCostEur live ONLY on products/<id>, not the list) so the
    // finalize line carries the exact fields the server expects.
    function addToCart(p) {
      if (!p.id) {
        scanFeedback(false, "Artikel ohne ID", "Kann nicht reserviert werden.");
        return;
      }
      // Unique stock → a duplicate tap is a no-op toast.
      if (cart.filter(function (l) { return l.key === p.id; })[0]) {
        scanFeedback(true, "Schon im Warenkorb", String(p.name || ""));
        return;
      }
      if (addingKey) return; // a reservation is already in flight.
      addingKey = p.id;
      var sessionId = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID() : fallbackUuid();
      var reserved = false; // did the reserve succeed (→ a hold to clean up)?
      proxyJson("inventory/reserve", "POST", {
        productId: p.id, channel: "POS", sessionId: sessionId
      }).then(function () {
        reserved = true;
        // Reserved — now pull the full record for the fiscal fields.
        return proxy("products/" + encodeURIComponent(p.id))
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
      }).then(function (full) {
        addingKey = null;
        var listEur = full.listPriceEur != null ? full.listPriceEur
          : (p.priceEur != null ? p.priceEur : p.price);
        var unit = priceToCents(listEur);
        if (unit == null || unit <= 0) {
          // Bad price — undo the hold so nothing is stranded.
          proxyJson("inventory/release", "POST", {
            productId: p.id, sessionId: sessionId, reason: "pos_cart_cleared"
          }).catch(function () {});
          scanFeedback(false, "Kein gültiger Preis", "Artikel kann nicht hinzugefügt werden.");
          return;
        }
        var acqCents = priceToCents(full.acquisitionCostEur != null ? full.acquisitionCostEur : "0") || 0;
        var taxCode = (full.taxTreatmentCode && TAX_CODE_VALUES[full.taxTreatmentCode])
          ? full.taxTreatmentCode : resolveTaxCode(full);
        cart.push({
          key: p.id, id: p.id, sku: full.sku || p.sku || "",
          name: full.name || p.name || "Artikel",
          unitCents: unit, taxCode: taxCode, acqCostCents: acqCents,
          reservationSessionId: sessionId
        });
        scanFeedback(true, full.name || p.name || "Hinzugefügt", "Reserviert");
        paintCart();
        paint(search.value.trim().toLowerCase()); // flip the row to "Im Warenkorb ✓"
      }).catch(function (err) {
        addingKey = null;
        // If the reserve SUCCEEDED but enriching the record failed, the hold is
        // live with no cart line → release it so the item is not stranded.
        if (reserved) {
          proxyJson("inventory/release", "POST", {
            productId: p.id, sessionId: sessionId, reason: "pos_cart_cleared"
          }).catch(function () {});
        }
        var msg = err && err.message ? err.message : "";
        // 409 / not reservable → another till/channel already has it.
        if (/nicht mehr verfügbar|not.*available|reserv|409|PRODUCT_NOT_RESERVABLE/i.test(msg)) {
          scanFeedback(false, "Nicht mehr verfügbar",
            "Dieser Artikel ist bereits reserviert oder verkauft.");
        } else {
          scanFeedback(false, "Hinzufügen fehlgeschlagen", msg);
        }
      });
    }

    function removeLine(line) {
      var idx = cart.indexOf(line);
      if (idx < 0) return;
      var removed = cart[idx];
      cart.splice(idx, 1);
      paintCart();
      paint(search.value.trim().toLowerCase()); // row returns to a tappable "+"
      // Release the hold immediately (re-reserve on undo).
      if (removed.id && removed.reservationSessionId) {
        proxyJson("inventory/release", "POST", {
          productId: removed.id, sessionId: removed.reservationSessionId,
          reason: "pos_cart_cleared"
        }).catch(function () {});
      }
      snackbar("Position entfernt: " + removed.name, "Rückgängig", function () {
        // Re-reserve with a FRESH session id (the old hold is gone).
        var sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : fallbackUuid();
        proxyJson("inventory/reserve", "POST", {
          productId: removed.id, channel: "POS", sessionId: sid
        }).then(function () {
          removed.reservationSessionId = sid;
          cart.splice(Math.min(idx, cart.length), 0, removed);
          paintCart();
          paint(search.value.trim().toLowerCase());
        }).catch(function () {
          scanFeedback(false, "Wiederherstellen fehlgeschlagen",
            "Der Artikel ist nicht mehr verfügbar.");
        });
      });
    }

    function cartTotalCents() {
      return cart.reduce(function (sum, l) { return sum + l.unitCents; }, 0);
    }
    function cartCount() { return cart.length; }

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
              el("div", { class: "sub" }, (l.sku ? "SKU " + l.sku + " · " : "") + taxLabelShort(l.taxCode))
            ]),
            el("span", { class: "ln" }, fmtEur(centsToDecimal(l.unitCents))),
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
          "Jeder Artikel ist ein Einzelstück und wird beim Hinzufügen reserviert. " +
          "Mit „Bezahlen“ wird der Barverkauf abgeschlossen — Steuer und die gesetzliche " +
          "Kassensignatur erzeugt die Hauptkasse automatisch.")
      ]));

      paintBottomBar();
    }

    // Fixed thumb-zone bar: running total + Bezahlen (full-amount cash sale).
    function paintBottomBar() {
      clear(bottomBar);
      var empty = !cart.length;
      var payBtn = el("button", { class: "bb-action", type: "button",
        onclick: function () { openBezahlenSheet(); } }, "Bezahlen");
      payBtn.disabled = empty;
      bottomBar.appendChild(el("div", { class: "bottombar" }, [
        el("div", { class: "bb-info" }, [
          el("div", { class: "t" }, fmtEur(centsToDecimal(cartTotalCents()))),
          el("div", { class: "s" }, empty ? "Warenkorb leer" : (cartCount() + " Artikel · Barzahlung"))
        ]),
        payBtn
      ]));
    }

    // Build the finalize body from the cart, mirroring cart-math exactly. The
    // header treatmentCode is the single line's code, or MIXED when lines differ.
    function buildFinalizeBody(idempotencyKey) {
      var items = [];
      var subC = 0, vatC = 0, totC = 0;
      var codes = {};
      cart.forEach(function (l) {
        var m = computeLineMathCents(l.taxCode, l.unitCents, l.acqCostCents);
        codes[l.taxCode] = true;
        subC += m.subtotalC; vatC += m.vatC; totC += m.totalC;
        items.push({
          productId: l.id,
          reservationSessionId: l.reservationSessionId,
          lineSubtotalEur: centsToDecimal(m.subtotalC),
          lineVatEur: centsToDecimal(m.vatC),
          lineTotalEur: centsToDecimal(m.totalC),
          appliedTaxTreatmentCode: l.taxCode,
          appliedVatRate: m.appliedVatRate,
          acquisitionCostEurSnapshot: m.acqSnapshotC != null ? centsToDecimal(m.acqSnapshotC) : null,
          marginEur: m.marginC != null ? centsToDecimal(m.marginC) : null
        });
      });
      var codeList = Object.keys(codes);
      var headerCode = codeList.length === 1 ? codeList[0] : "MIXED";
      return {
        direction: "VERKAUF",
        customerId: null,
        subtotalEur: centsToDecimal(subC),
        vatEur: centsToDecimal(vatC),
        totalEur: centsToDecimal(totC),
        taxTreatmentCode: headerCode,
        items: items,
        payments: [{ paymentMethod: "CASH", amountEur: centsToDecimal(totC) }],
        idempotencyKey: idempotencyKey
      };
    }

    // The Bezahlen sheet: CASH ONLY for v1. ONE idempotencyKey per attempt,
    // REUSED on retry. Clear, German gate messages for the known refusals.
    function openBezahlenSheet() {
      if (!cart.length) return;
      var totalC = cartTotalCents();
      var idempotencyKey = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID() : fallbackUuid();
      var busy = false;
      var msg = el("div", {});
      function setMsg(kind, text) {
        clear(msg);
        if (text) msg.appendChild(el("div", { class: "notice " + kind }, text));
      }

      var payBtn = el("button", { class: "btn-primary inline", type: "button", onclick: doPay },
        "Barzahlung abschließen");
      var closeBtn = el("button", { class: "btn-ghost", type: "button", onclick: close }, "Abbrechen");

      function doPay() {
        if (busy) return;
        busy = true; payBtn.disabled = true; closeBtn.disabled = true;
        setMsg("info", "Verkauf wird abgeschlossen…");
        // SAME idempotencyKey on every retry of this logical sale.
        proxyJson("transactions/finalize", "POST", buildFinalizeBody(idempotencyKey))
          .then(function (res) {
            busy = false;
            window.removeEventListener("pagehide", pagehideHandler);
            scanFeedback(true, "Verkauf abgeschlossen",
              res && res.receiptLocator ? ("Beleg " + res.receiptLocator) : null);
            setMsg("ok", "Verkauf abgeschlossen" +
              (res && res.receiptLocator ? (" — Beleg " + res.receiptLocator + ".") : ".") +
              " Bitte den Bon an der Hauptkasse ausdrucken.");
            // Cart is now SOLD — empty it (no release; the items are gone).
            zkCart.length = 0;
            paintCart();
            // Re-arm pagehide for the next sale.
            window.addEventListener("pagehide", pagehideHandler);
            payBtn.style.display = "none";
            closeBtn.textContent = "Fertig";
            closeBtn.disabled = false;
          })
          .catch(function (err) {
            busy = false; payBtn.disabled = false; closeBtn.disabled = false;
            handleFinalizeError(err);
          });
      }

      // Map the cloud's gate responses to clear German guidance.
      function handleFinalizeError(err) {
        var m = err && err.message ? String(err.message) : "";
        if (/STEP_UP|Step-up|Freigabe an der Hauptkasse/i.test(m)) {
          setMsg("bad", "Hohe Summe — bitte an der Hauptkasse abschließen.");
          scanFeedback(false, "Freigabe nötig", "An der Hauptkasse abschließen.");
          return;
        }
        if (/Identifizierung|§ ?10 GwG|§ ?259|KYC/i.test(m)) {
          setMsg("bad", "Käufer an der Hauptkasse zuordnen (Ausweis-Identifikation erforderlich).");
          scanFeedback(false, "Käufer zuordnen", "An der Hauptkasse identifizieren.");
          return;
        }
        // 409 / not reservable → a line was taken; drop it + refetch the catalog.
        if (/nicht mehr verfügbar|not.*available|reserv|409|PRODUCT_NOT_RESERVABLE/i.test(m)) {
          setMsg("bad", "Ein Artikel ist nicht mehr verfügbar und wurde entfernt. Bitte erneut versuchen.");
          // Drop any line whose hold the server rejected, then refresh stock.
          zkCart.length = 0;
          paintCart();
          reloadCatalog();
          scanFeedback(false, "Artikel entfernt", "Warenkorb geleert.");
          setTimeout(close, 1800);
          return;
        }
        if (/Terminal nicht konfiguriert|Karte/i.test(m)) {
          setMsg("bad", "Kartenzahlung ist hier nicht verfügbar — bitte bar oder an der Hauptkasse.");
          return;
        }
        // Device gate: the proxied finalize carries the mother's Bearer but no
        // device identity, so the cloud may refuse with DEVICE_NOT_AUTHORIZED /
        // a plain 403 until the proxy forwards a paired-device fingerprint
        // (see openItems). Surface a clean, honest block — never a wrong sale.
        if (/auf diesem Gerät nicht erlaubt|DEVICE_NOT_AUTHORIZED|paired.*device|mTLS/i.test(m)) {
          setMsg("bad", "Abschluss auf diesem Gerät nicht möglich — bitte an der Hauptkasse abschließen.");
          scanFeedback(false, "An der Hauptkasse abschließen", "Gerät nicht freigegeben.");
          return;
        }
        // Anything else: surface a clean block (the server re-validated the body).
        setMsg("bad", m || "Abschluss fehlgeschlagen. Bitte an der Hauptkasse abschließen.");
      }

      var sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Bezahlen" }, [
        el("div", { class: "sheet-head" }, [
          el("span", { class: "t" }, "Bezahlen"),
          el("button", { class: "x", type: "button", "aria-label": "Schließen", onclick: close }, "×")
        ]),
        el("div", { class: "sheet-body" }, [
          el("div", { class: "form" }, [
            el("div", { class: "pay-total" }, [
              el("span", { class: "pt-l" }, "Zu zahlen (bar)"),
              el("span", { class: "pt-v" }, fmtEur(centsToDecimal(totalC)))
            ]),
            el("div", { class: "pay-count" }, cartCount() + " Artikel"),
            msg,
            el("div", { class: "btn-row" }, [ closeBtn, payBtn ]),
            el("div", { class: "scan-help" },
              "Nur Barzahlung. Steuer und die gesetzliche Kassensignatur erzeugt die Hauptkasse " +
              "automatisch. Bei hoher Summe oder Ausweispflicht bitte an der Hauptkasse abschließen.")
          ])
        ])
      ]);

      function close() { try { sheet.remove(); } catch (e) {} }
      document.body.appendChild(sheet);
    }

    function reloadCatalog() {
      proxy("products?status=AVAILABLE&limit=200")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) { all = normalizeProducts(data); paint(search.value.trim().toLowerCase()); })
        .catch(function () { /* keep last list */ });
    }

    function paint(q) {
      clear(listBox);
      var inCart = {};
      cart.forEach(function (l) { inCart[l.id] = true; });
      // Keep items that are already in the cart VISIBLE (greyed, "Im Warenkorb")
      // rather than letting them vanish under the thumb — the list never jumps.
      var rows = all.filter(function (p) {
        if (!q) return true;
        return (String(p.name || "") + " " + String(p.sku || "") + " " + String(p.barcode || ""))
          .toLowerCase().indexOf(q) >= 0;
      }).slice(0, 100);
      if (!rows.length) {
        listBox.appendChild(el("div", { class: "state-msg" }, q ? "Keine Treffer." : "Kein verfügbarer Artikel."));
        return;
      }
      rows.forEach(function (p) {
        var held = !!inCart[p.id];
        var right = held
          ? el("span", { class: "incart", title: "Im Warenkorb", "aria-label": "Im Warenkorb" }, "✓")
          : el("button", { class: "add", title: "In den Warenkorb", "aria-label": "Hinzufügen",
              onclick: function () { addToCart(p); } }, "+");
        listBox.appendChild(el("div", { class: held ? "row in-cart" : "row" }, [
          thumbNode(p),
          el("div", { class: "meta" }, [
            el("div", { class: "nm" }, String(p.name || "Ohne Namen")),
            el("div", { class: "sku" }, p.sku ? ("SKU " + String(p.sku)) : "—")
          ]),
          el("span", { class: "price" }, fmtEur(p.priceEur != null ? p.priceEur : p.price)),
          right
        ]));
      });
    }

    // Barcode/scan add — reuse the BarcodeDetector live-scan path from whScan.
    // A detected code is looked up against the catalog (exact barcode/sku, then
    // free text) and the first AVAILABLE match is added straight to the cart.
    var camStage = el("div", { class: "cam-stage", style: "display:none; height:38vh; margin-bottom:1rem" });
    function lookupAndAdd(code) {
      var c = String(code || "").trim();
      if (!c) return;
      var lc = c.toLowerCase();
      var hit = all.filter(function (p) {
        return String(p.barcode || "").toLowerCase() === lc ||
               String(p.sku || "").toLowerCase() === lc;
      })[0] || all.filter(function (p) {
        return (String(p.name || "") + " " + String(p.sku || "")).toLowerCase().indexOf(lc) >= 0;
      })[0];
      if (!hit) {
        scanFeedback(false, "Unbekannter Code", "Kein verfügbarer Artikel zu „" + c + "“.");
        return;
      }
      if (cart.filter(function (l) { return l.key === hit.id; })[0]) {
        scanFeedback(true, "Schon im Warenkorb", String(hit.name || ""));
        return;
      }
      addToCart(hit);
    }
    function startCamScan() {
      if (!("BarcodeDetector" in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        scanFeedback(false, "Kamera-Scan nicht verfügbar",
          "Bitte den Artikel über die Suche hinzufügen.");
        return;
      }
      var video = el("video", { autoplay: "", muted: "", playsinline: "" });
      camStage.style.display = "";
      clear(camStage); camStage.appendChild(video);
      var detector = new window.BarcodeDetector();
      var raf = null, streamRef = null, done = false;
      var teardown = function () {
        done = true;
        if (raf) cancelAnimationFrame(raf);
        try { if (streamRef) streamRef.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        camStage.style.display = "none"; clear(camStage);
        stopCam = null; activeCamTeardown = null;
      };
      var scanFrame = function () {
        if (done) return;
        detector.detect(video).then(function (codes) {
          if (done) return;
          if (codes && codes.length && codes[0].rawValue) {
            var val = String(codes[0].rawValue).trim();
            teardown();
            lookupAndAdd(val);
            return;
          }
          raf = requestAnimationFrame(scanFrame);
        }).catch(function () { if (!done) raf = requestAnimationFrame(scanFrame); });
      };
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(function (stream) {
          streamRef = stream; video.srcObject = stream;
          stopCam = teardown; activeCamTeardown = teardown;
          raf = requestAnimationFrame(scanFrame);
        })
        .catch(function () {
          camStage.style.display = "none";
          scanFeedback(false, "Kamera nicht freigegeben",
            "Bitte Kamerazugriff erlauben oder über die Suche hinzufügen.");
        });
    }
    var camBtn = ("BarcodeDetector" in window)
      ? el("button", { class: "btn-ghost", type: "button", onclick: startCamScan }, "📷 Scannen")
      : null;

    var pane = el("div", {}, [
      el("div", { class: "pad has-bottombar" }, [
        el("div", { class: "zk-searchrow" }, [ search ].concat(camBtn ? [camBtn] : [])),
        el("div", { class: "hint" }, "Artikel suchen oder scannen, dann auf „+“ tippen. Jeder Treffer wird beim Hinzufügen reserviert."),
        camStage,
        statusMsg,
        listBox,
        cartBox
      ]),
      bottomBar
    ]);

    paintCart();
    // status=AVAILABLE + a generous limit so the till sees the live floor stock.
    proxy("products?status=AVAILABLE&limit=200")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        all = normalizeProducts(data);
        statusMsg.remove();
        paint("");
      })
      .catch(function (err) {
        statusMsg.textContent = "Katalog konnte nicht geladen werden. (" + (err.message || "Fehler") + ")";
      });

    return pane;
  }

  // Short German label for a tax treatment code (cart line subtitle).
  function taxLabelShort(code) {
    switch (code) {
      case "MARGIN_25A": return "Differenz §25a";
      case "INVESTMENT_GOLD_25C": return "Anlagegold §25c";
      case "REDUCED_7": return "7 % USt";
      case "REVERSE_CHARGE_13B": return "§13b";
      case "STANDARD_19": return "19 % USt";
      default: return code || "—";
    }
  }
  // RFC4122-ish v4 fallback for the (rare) browser without crypto.randomUUID.
  function fallbackUuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── Warehouse (Lager) — tabbed tools ───────────────────────────────
  function renderWarehouse() {
    stopDisplayTimer();
    stopDisplaySocket();
    stopApptPoll();
    clear(app);
    app.appendChild(topbar());

    var TABS = [
      ["scan",    "Scannen"],
      ["stock",   "Bestand"],
      ["add",     "Neu"],
      ["termine", "Termine"],
      ["printer", "Drucker"]
    ];
    var bodyBox = el("div", {});

    function drawTabs() {
      var bar = el("div", { class: "tabs", role: "tablist" }, TABS.map(function (t) {
        return el("button", {
          class: "tab", type: "button", role: "tab",
          "aria-selected": t[0] === whTab ? "true" : "false",
          onclick: function () { whTab = t[0]; mount(); }
        }, t[1]);
      }));
      wireTabOverflow(bar);
      return bar;
    }

    var tabsEl = drawTabs();
    app.appendChild(tabsEl);
    app.appendChild(bodyBox);

    function mount() {
      var newTabs = drawTabs();
      tabsEl.replaceWith(newTabs);
      tabsEl = newTabs;
      stopApptPoll();
      stopActiveCamera();
      clear(bodyBox);
      if (whTab === "scan")    bodyBox.appendChild(whScan());
      else if (whTab === "stock") bodyBox.appendChild(whStock());
      else if (whTab === "add")   bodyBox.appendChild(whAdd());
      else if (whTab === "termine") bodyBox.appendChild(terminePane(false));
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
        stopCam = null; activeCamTeardown = null;
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
          stopCam = teardown; activeCamTeardown = teardown;
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
    var listBox = el("div", { class: "list" });
    var countBox = el("div", { class: "hint", style: "margin:.25rem 0 1rem" }, "");
    var moreWrap = el("div", { style: "margin-top:1rem" });
    var detailBox = el("div", {});
    var busy = false;
    var dirty = false; // a detail edit happened → reload the list on Back.

    // Status filter chips. "" = Alle. The cloud list endpoint filters by status,
    // pages by limit/offset and returns { items, total, hasMore }.
    var STATUSES = [
      ["", "Alle"], ["AVAILABLE", "Verfügbar"], ["DRAFT", "Entwurf"],
      ["RESERVED", "Reserviert"], ["SOLD", "Verkauft"]
    ];
    var curStatus = "";
    var curQ = "";
    var offset = 0;
    var loaded = 0;
    var total = 0;
    var PAGE = 50;

    var search = el("input", {
      class: "search", type: "search", placeholder: "SKU oder Artikelname…",
      "aria-label": "SKU oder Artikelname",
      onkeydown: function (e) { if (e.key === "Enter") { curQ = e.target.value.trim(); load(true); } }
    });

    var filterEl = el("div", { class: "filterbar", role: "tablist", "aria-label": "Status" });
    function paintFilters() {
      clear(filterEl);
      STATUSES.forEach(function (s) {
        filterEl.appendChild(el("button", { class: "filterchip", type: "button",
          "aria-pressed": s[0] === curStatus ? "true" : "false",
          onclick: function () { if (s[0] !== curStatus) { curStatus = s[0]; load(true); } }
        }, s[1]));
      });
    }

    function buildPath() {
      var qs = ["limit=" + PAGE, "offset=" + offset];
      if (curQ) qs.push("q=" + encodeURIComponent(curQ));
      if (curStatus) qs.push("status=" + encodeURIComponent(curStatus));
      return "products?" + qs.join("&");
    }
    function paintCount() {
      countBox.textContent = total ? (loaded + " von " + total + " Artikeln angezeigt") : "";
    }
    function paintMore(hasMore) {
      clear(moreWrap);
      if (hasMore) {
        moreWrap.appendChild(el("button", { class: "btn-ghost", type: "button", style: "flex:none",
          onclick: function () { offset += PAGE; load(false); } }, "Mehr laden"));
      }
    }

    function load(reset) {
      if (busy) return;
      busy = true;
      paintFilters();
      if (reset) {
        offset = 0; loaded = 0;
        clear(detailBox); resultBox.style.display = "";
        clear(moreWrap); countBox.textContent = "";
        clear(listBox); listBox.appendChild(el("div", { class: "state-msg" }, "Lädt…"));
      }
      proxy(buildPath())
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          busy = false;
          if (reset) clear(listBox);
          var rows = normalizeProducts(data);
          loaded += rows.length;
          total = (data && typeof data.total === "number") ? data.total : loaded;
          rows.forEach(function (p) { listBox.appendChild(inventoryRow(p, function () { openDetail(p); })); });
          if (!loaded) listBox.appendChild(el("div", { class: "notice info" }, "Kein Artikel gefunden."));
          paintCount();
          paintMore(!!(data && data.hasMore));
        })
        .catch(function (err) {
          busy = false;
          if (reset) clear(listBox);
          listBox.appendChild(el("div", { class: "notice bad" },
            "Suche fehlgeschlagen. (" + (err.message || "Fehler") + ")"));
        });
    }

    // Open the editor in place; the list is HIDDEN (not destroyed) so "Zurück"
    // restores it instantly. A save marks the list dirty → reload only on Back.
    function openDetail(p) {
      resultBox.style.display = "none";
      clear(detailBox);
      detailBox.appendChild(productDetail(p,
        function () { dirty = true; },
        function () {
          clear(detailBox);
          resultBox.style.display = "";
          if (dirty) { dirty = false; load(true); }
          try { search.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
        }));
      try { detailBox.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) {}
    }

    window.__whOpenProduct = openDetail;

    resultBox.appendChild(countBox);
    resultBox.appendChild(listBox);
    resultBox.appendChild(moreWrap);
    paintFilters();

    var pad = el("div", { class: "pad" }, [
      search,
      filterEl,
      el("div", { class: "hint" }, "Suchen oder nach Status filtern, dann auf einen Artikel tippen zum Bearbeiten."),
      detailBox,
      resultBox
    ]);
    setTimeout(function () { load(true); }, 0);
    return pad;
  }

  // Warehouse · Neu — CAPTURE-FIRST add: the hot path is just Bezeichnung +
  // Verkaufspreis + Foto + Speichern. Everything else (SKU/Barcode/Art/Zustand/
  // Steuer/Ankauf/Gewicht/Lagerort/Webshop) lives under a collapsed "Mehr"
  // disclosure. Sticky context (type/condition/tax/bin) still carries forward
  // and the per-session batch counter is kept. On a successful create we upload
  // any photo taken inline (isPrimary), or offer "Foto aufnehmen" straightaway.
  function whAdd() {
    var msg = el("div", {});
    var busy = false;
    var batchCount = 0;
    var batchCents = 0;
    var pendingPhotos = []; // JPEG Blobs captured BEFORE the product exists (first = Hauptbild).

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
    var acqI   = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "Optional — 0,00" });
    var listI  = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "0,00" });
    var wgtI   = el("input", { class: "inp", type: "text", inputmode: "decimal", placeholder: "Optional — Gramm" });
    var unitI  = el("input", { class: "inp", type: "text", placeholder: "z. B. Tresor 1" });
    var drwI   = el("input", { class: "inp", type: "text", placeholder: "z. B. Fach 3" });
    var posI   = el("input", { class: "inp", type: "text", placeholder: "z. B. Box B" });
    var pubChk = el("input", { type: "checkbox", id: "wh-pub" });

    // Restore sticky carry-forward context (NOT the item-unique fields).
    if (sticky.itemType) typeS.value = sticky.itemType;
    if (sticky.condition) condS.value = sticky.condition;
    // Only restore a tax code the cloud still accepts — drop a legacy value so
    // the select never lands on an empty/invalid option.
    if (sticky.taxTreatmentCode && TAX_CODE_VALUES[sticky.taxTreatmentCode]) {
      taxS.value = sticky.taxTreatmentCode;
    }
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

    // Foto button: capture an image NOW (held in pendingPhoto) so the operator
    // shoots first and types later; the photo uploads after the product exists.
    var photoStatus = el("div", { class: "scan-help" }, "Noch kein Foto.");
    function paintPhotoStatus() {
      var n = pendingPhotos.length;
      photoStatus.textContent = n === 0 ? "Noch kein Foto."
        : (n === 1 ? "1 Foto bereit — wird beim Anlegen hochgeladen (Hauptbild)."
                   : n + " Fotos bereit — werden beim Anlegen hochgeladen (1. = Hauptbild).");
    }
    var photoBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () {
        // Multi-capture: shoot several angles in one sitting; the first is the
        // Hauptbild. All upload after the product is created.
        openCameraSheet(function (blob) {
          pendingPhotos.push(blob);
          paintPhotoStatus();
        }, { multi: true });
      } }, "📷 Fotos aufnehmen");

    var saveBtn = el("button", { class: "btn-primary inline", type: "button",
      onclick: function () { submit(false); } }, "Speichern & weiter");
    var saveOnceBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () { submit(true); } }, "Speichern & fertig");

    function setMsg(kind, text) {
      clear(msg);
      msg.appendChild(el("div", { class: "notice " + kind }, text));
    }

    // SKU is OPTIONAL (brief §3 EAS: auto-derive). If blank we mint a readable
    // client-side SKU so the operator never has to think one up.
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
      // Ankaufspreis is required by the cloud but optional on the form — default
      // to 0 when the operator skipped the "Mehr" panel (a fast floor-add).
      var acqStr = acqI.value.trim();
      if (acqStr && !isMoney(acqStr)) { setMsg("bad", "Ankaufspreis ist keine gültige Zahl."); return; }
      if (!isMoney(listI.value)) { setMsg("bad", "Verkaufspreis ist keine gültige Zahl."); return; }
      if (wgtI.value.trim() && !isMoney(wgtI.value)) { setMsg("bad", "Gewicht ist keine gültige Zahl."); return; }

      // Guard the tax code: a stale localStorage value (or an empty select) must
      // never reach the cloud as an invalid enum → falls back to §25a.
      var taxCode = TAX_CODE_VALUES[taxS.value] ? taxS.value : "MARGIN_25A";
      var payload = {
        sku: sku,
        itemType: typeS.value,
        condition: condS.value,
        taxTreatmentCode: taxCode,
        acquisitionCostEur: acqStr ? normalizeDecimal(acqStr) : "0",
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
        var newId = res.id || res.productId || null;
        scanFeedback(true, "Angelegt: " + name, "SKU " + (res.sku || sku));
        batchCount += 1; batchCents += (priceToCents(listI.value) || 0); paintBatch();

        // Persist sticky carry-forward for the next item.
        saveSticky({
          itemType: typeS.value, condition: condS.value, taxTreatmentCode: taxCode,
          locationStorageUnit: unitI.value.trim(), locationDrawer: drwI.value.trim(),
          locationPosition: posI.value.trim()
        });

        // Photos: upload every one taken inline (first = Hauptbild), else offer
        // a one-tap multi-capture right after creation.
        if (pendingPhotos.length && newId) {
          var blobs = pendingPhotos; pendingPhotos = [];
          setMsg("info", "Angelegt: " + (res.sku || sku) + " — " + blobs.length + " Foto(s) werden hochgeladen…");
          uploadPhotos(newId, blobs, function (okCount, failCount) {
            if (!failCount) setMsg("ok", "Angelegt: " + (res.sku || sku) + " · " + okCount + " Foto(s) hochgeladen.");
            else setMsg("bad", "Angelegt: " + (res.sku || sku) + " · " + okCount + " Foto(s) ok, " + failCount + " fehlgeschlagen.");
          });
        } else if (newId) {
          clear(msg);
          msg.appendChild(el("div", { class: "notice ok" }, "Angelegt: " + (res.sku || sku) +
            " (Status " + (res.status || "DRAFT") + ")."));
          msg.appendChild(el("div", { class: "btn-row" }, [
            el("button", { class: "btn-ghost", type: "button", onclick: function () {
              var taken = 0;
              openCameraSheet(function (blob2) {
                uploadPhoto(newId, blob2, taken === 0, function (ok, message) {
                  if (ok) { taken++; setMsg("ok", taken + " Foto(s) hochgeladen für " + (res.sku || sku) + "."); }
                  else setMsg("bad", "Foto fehlgeschlagen: " + (message || ""));
                });
              }, { multi: true });
            } }, "📷 Fotos aufnehmen")
          ]));
        } else {
          setMsg("ok", "Angelegt: " + (res.sku || sku) + " (Status " + (res.status || "DRAFT") + ").");
        }

        if (finish) {
          // Reset everything including sticky for a clean finish.
          typeS.selectedIndex = 0; condS.selectedIndex = 0; taxS.selectedIndex = 0;
          unitI.value = ""; drwI.value = ""; posI.value = "";
        }
        // Clear only item-unique fields (brief §3 EAS: N-field → 3-field for 2…n).
        skuI.value = ""; barI.value = ""; nameI.value = "";
        acqI.value = ""; listI.value = ""; wgtI.value = ""; pubChk.checked = false;
        pendingPhotos = []; paintPhotoStatus();
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
      setMsg("info", "Kontext übernommen — Bezeichnung und Preis anpassen, dann speichern.");
      try { nameI.focus(); } catch (e) {}
    }

    // Collapsed "Mehr" disclosure: everything beyond the hot path. Closed by
    // default — one tap reveals the full detail set; sticky carry-forward keeps
    // it usable even while collapsed.
    var moreBody = el("div", { class: "more-body", style: "display:none" }, [
      el("div", { class: "sectionhead" }, "Identität"),
      el("div", { class: "form-row two" }, [
        field("SKU (optional)", skuI, false),
        field("Barcode", barI, false)
      ]),
      el("div", { class: "sectionhead" }, "Klassifizierung"),
      el("div", { class: "form-row two" }, [
        field("Art", typeS, true),
        field("Zustand", condS, true)
      ]),
      el("div", { class: "sectionhead" }, "Ankauf & Steuer"),
      el("div", { class: "form-row two" }, [
        field("Ankaufspreis (€)", acqI, false),
        field("Steuerart", taxS, true)
      ]),
      el("div", { class: "form-row two" }, [
        field("Gewicht (g)", wgtI, false),
        el("div", {})
      ]),
      el("label", { class: "toggle", for: "wh-pub" }, [
        pubChk,
        el("span", { class: "track" }),
        el("span", { class: "tlab" }, "Im Webshop anbieten (nach Freigabe)")
      ]),
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn-ghost", type: "button", onclick: duplicate }, "Letzten duplizieren")
      ])
    ]);
    var moreBtn = el("button", { class: "more-toggle", type: "button",
      "aria-expanded": "false",
      onclick: function () {
        var open = moreBody.style.display === "none";
        moreBody.style.display = open ? "" : "none";
        moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
        moreBtn.textContent = open ? "Weniger ▲" : "Mehr ▾";
      } }, "Mehr ▾");

    paintBatch();

    return el("div", { class: "pad" }, [
      batchStrip,
      el("div", { class: "form" }, [
        field("Bezeichnung", nameI, true),
        field("Verkaufspreis (€)", listI, true),
        el("div", { class: "fl" }, [
          el("span", { class: "lab" }, "Foto"),
          photoBtn,
          photoStatus
        ]),
        el("div", { class: "sectionhead" }, "Lagerort — wo wird der Artikel abgelegt?"),
        el("div", { class: "form-row three" }, [
          field("Einheit", unitI, false),
          field("Fach", drwI, false),
          field("Position", posI, false)
        ]),
        el("div", { class: "btn-row" }, [ saveBtn, saveOnceBtn ]),
        moreBtn,
        moreBody,
        msg,
        el("div", { class: "scan-help" },
          "Schnell-Erfassung: Bezeichnung, Preis, Foto und Lagerort, dann speichern. Lagerort, Art, " +
          "Zustand und Steuerart werden für den nächsten Artikel übernommen. Weitere Felder unter „Mehr“.")
      ])
    ]);
  }

  // Warehouse · Drucker — label-printer connection settings (local config).
  function whPrinter() {
    var saved = loadPrinter();
    var msg = el("div", {});

    var modeS = el("select", { class: "sel" }, [
      el("option", { value: "browser" }, "Über dieses Gerät drucken (Browser)"),
      el("option", { value: "mother" }, "Über die Hauptkasse drucken (demnächst)"),
      el("option", { value: "network" }, "Netzwerkdrucker · IP (demnächst)")
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
        if (modeS.value === "browser") {
          setMsg("ok", "Etikettendrucker gespeichert.");
        } else {
          setMsg("info", "Gespeichert. Direkter LAN-/Hauptkassen-Druck folgt — bis dahin " +
            "werden Etiketten über den Druckdialog dieses Geräts gedruckt.");
        }
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

  // ── Termine — TODAY view + week strip + one-tap status flow ────────
  // Warehouse: full control (status transitions + Neuer Termin). Zweitkasse:
  // the same day view read-only. Data via the mother's proxy:
  //   GET   appointments?from&to            (day window)
  //   GET   appointments/available-slots    (30-min grid → startsAt+staff)
  //   GET   customers?q=                    (booking search)
  //   POST  appointments / PATCH appointments/<id>  (warehouse only)
  function normalizeAppointments(data) {
    var arr = (data && Array.isArray(data.appointments)) ? data.appointments
            : (Array.isArray(data) ? data : []);
    return arr.map(function (a) {
      return {
        id: a.id || null,
        type: a.appointment_type || a.appointmentType || a.type || "",
        status: String(a.status || "SCHEDULED").toUpperCase(),
        startsAt: parseTs(a.starts_at != null ? a.starts_at : a.startsAt),
        endsAt: parseTs(a.ends_at != null ? a.ends_at : a.endsAt),
        customerId: a.customer_id || a.customerId || null,
        // Walk-in contact fields (shared contract, migration 0062) + any
        // server-side customer-name join — all read defensively.
        contactName: a.contact_name || a.contactName || null,
        customerName: a.customer_name || a.customerName || a.customer_full_name || null
      };
    }).filter(function (a) {
      return a.id && a.startsAt && a.status !== "CANCELLED" && a.status !== "RESCHEDULED";
    });
  }

  // Resolve customer display names for a day's cards (in-memory cache only —
  // PII never touches localStorage). Failures cache `null` → calm fallback.
  function resolveCustomerNames(rows, done) {
    var missing = {};
    rows.forEach(function (a) {
      if (a.customerId && custNames[a.customerId] === undefined) missing[a.customerId] = true;
    });
    var ids = Object.keys(missing);
    if (!ids.length) { done(); return; }
    Promise.all(ids.map(function (id) {
      return proxy("customers/" + encodeURIComponent(id))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (d) {
          custNames[id] = (d && (d.fullName || d.full_name)) || null;
        })
        .catch(function () { custNames[id] = null; });
    })).then(function () { done(); }, function () { done(); });
  }

  function apptDisplayName(a) {
    if (a.contactName) return String(a.contactName);
    if (a.customerName) return String(a.customerName);
    if (a.customerId) return custNames[a.customerId] || "Kunde";
    return "Ohne Kundenangabe";
  }

  function terminePane(readOnly) {
    var todayKey = dayKeyOf(new Date());
    if (!apptDayKey) apptDayKey = todayKey;

    var listBox = el("div", {});
    var headBox = el("div", {});
    var stripBox = el("div", {});
    var bbInfoT = el("div", { class: "t" }, "Termine");
    var bbInfoS = el("div", { class: "s" }, "");
    var busy = false;

    function selectDay(key) {
      apptDayKey = key;
      paintStrip();
      paintHead();
      loadDay();
    }

    // Week strip (Mo–So of the selected day's week) + ‹ › week paging.
    function paintStrip() {
      var sel = dayKeyToDate(apptDayKey);
      var dow = (sel.getDay() + 6) % 7; // 0 = Montag.
      var mon = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - dow);
      var chips = [];
      var i;
      for (i = 0; i < 7; i++) {
        (function (d) {
          var key = dayKeyOf(d);
          chips.push(el("button", {
            class: "daychip" + (key === todayKey ? " today" : ""), type: "button",
            "aria-pressed": key === apptDayKey ? "true" : "false",
            "aria-label": fmtDayLong(key),
            onclick: function () { selectDay(key); }
          }, [
            el("span", { class: "dw" }, WEEKDAYS_DE[(d.getDay() + 6) % 7]),
            el("span", { class: "dn" }, String(d.getDate()))
          ]));
        })(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
      }
      function shiftWeek(days) {
        var d = dayKeyToDate(apptDayKey);
        selectDay(dayKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)));
      }
      var strip = el("div", { class: "weekstrip" }, [
        el("button", { class: "wk-nav", type: "button", "aria-label": "Vorherige Woche",
          onclick: function () { shiftWeek(-7); } }, "‹"),
        el("div", { class: "wk-days" }, chips),
        el("button", { class: "wk-nav", type: "button", "aria-label": "Nächste Woche",
          onclick: function () { shiftWeek(7); } }, "›")
      ]);
      clear(stripBox);
      stripBox.appendChild(strip);
    }

    function paintHead() {
      clear(headBox);
      headBox.appendChild(el("div", { class: "day-head" }, [
        el("span", { class: "dh-t" }, fmtDayLong(apptDayKey)),
        apptDayKey !== todayKey
          ? el("button", { class: "dh-today", type: "button",
              onclick: function () { selectDay(todayKey); } }, "Heute")
          : null
      ]));
    }

    function paintCards(rows) {
      clear(listBox);
      if (!rows.length) {
        listBox.appendChild(el("div", { class: "state-msg" },
          "Keine Termine an diesem Tag." + (readOnly ? "" : " Über „Neuer Termin“ einen anlegen.")));
        return;
      }
      var list = el("div", { class: "list" });
      rows.forEach(function (a) { list.appendChild(apptCard(a)); });
      listBox.appendChild(list);
    }

    function loadDay() {
      var bounds = dayBoundsIso(apptDayKey);
      var requestedKey = apptDayKey;
      clear(listBox);
      listBox.appendChild(el("div", { class: "state-msg" }, "Termine werden geladen…"));
      proxy("appointments?from=" + encodeURIComponent(bounds[0]) +
            "&to=" + encodeURIComponent(bounds[1]))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          if (requestedKey !== apptDayKey) return; // day changed mid-flight.
          var rows = normalizeAppointments(data).sort(function (x, y) {
            return x.startsAt - y.startsAt;
          });
          bbInfoT.textContent = rows.length
            ? (rows.length + (rows.length === 1 ? " Termin" : " Termine"))
            : "Keine Termine";
          bbInfoS.textContent = fmtDayLong(apptDayKey);
          paintCards(rows);
          // Names arrive async — repaint once the cache is warm.
          resolveCustomerNames(rows, function () {
            if (requestedKey === apptDayKey) paintCards(rows);
          });
        })
        .catch(function (err) {
          if (requestedKey !== apptDayKey) return;
          clear(listBox);
          listBox.appendChild(el("div", { class: "notice bad" },
            "Termine konnten nicht geladen werden. (" + (err.message || "Fehler") + ")"));
          listBox.appendChild(el("div", { class: "btn-row" }, [
            el("button", { class: "btn-ghost", type: "button", onclick: loadDay }, "Erneut versuchen")
          ]));
        });
    }

    // One appointment card: time + name + type/status chips + one-tap actions.
    function apptCard(a) {
      var statusMeta = APPT_STATUS[a.status] || [a.status, "muted"];
      var who = el("span", { class: "appt-who" }, apptDisplayName(a));
      var timeTxt = fmtTimeHM(a.startsAt) + (a.endsAt ? ("–" + fmtTimeHM(a.endsAt)) : "");

      var kids = [
        el("div", { class: "appt-top" }, [
          el("span", { class: "appt-time" }, timeTxt),
          who
        ]),
        el("div", { class: "appt-sub" }, [
          el("span", { class: "pill dr" }, apptTypeLabel(a.type)),
          el("span", { class: "pill " + statusMeta[1] }, statusMeta[0])
        ])
      ];

      if (!readOnly) {
        var actions = [];
        // The happy chain: Bestätigen → Einchecken → Abschließen (one tap each).
        if (a.status === "SCHEDULED") {
          actions.push(actionBtn("Bestätigen", "primary", "CONFIRMED", null));
        } else if (a.status === "CONFIRMED") {
          actions.push(actionBtn("Einchecken", "primary", "CHECKED_IN", null));
        } else if (a.status === "CHECKED_IN" || a.status === "IN_PROGRESS") {
          actions.push(actionBtn("Abschließen", "primary", "COMPLETED", null));
        }
        // Exceptions: no-show (before check-in) + cancel (confirm-guarded).
        if (a.status === "SCHEDULED" || a.status === "CONFIRMED") {
          actions.push(actionBtn("Nicht erschienen", "", "NO_SHOW", null));
        }
        if (a.status === "SCHEDULED" || a.status === "CONFIRMED" ||
            a.status === "CHECKED_IN" || a.status === "IN_PROGRESS") {
          actions.push(actionBtn("Stornieren", "danger", "CANCELLED",
            "Vom Begleiter-Gerät storniert"));
        }
        if (actions.length) kids.push(el("div", { class: "appt-actions" }, actions));
      }

      function actionBtn(label, cls, status, cancellationReason) {
        return el("button", { class: cls || "", type: "button", onclick: function (e) {
          if (busy) return;
          var btn = e.currentTarget || e.target;
          function apply() {
            var body = { status: status };
            if (cancellationReason) body.cancellationReason = cancellationReason;
            busy = true;
            btn.disabled = true;
            proxyJson("appointments/" + encodeURIComponent(a.id), "PATCH", body)
              .then(function () {
                busy = false;
                var meta = APPT_STATUS[status] || [status, "muted"];
                scanFeedback(true, "Termin aktualisiert",
                  fmtTimeHM(a.startsAt) + " · " + meta[0]);
                loadDay();
              })
              .catch(function (err) {
                busy = false;
                btn.disabled = false;
                scanFeedback(false, "Status nicht geändert", err.message || "");
              });
          }
          if (status === "CANCELLED") {
            confirmSheet({
              title: "Termin stornieren?",
              body: "Termin um " + fmtTimeHM(a.startsAt) + " (" + apptDisplayName(a) + ") wirklich stornieren?",
              confirmLabel: "Stornieren", danger: true, onConfirm: apply
            });
          } else { apply(); }
        } }, label);
      }

      return el("div", { class: "appt-card" }, kids);
    }

    var padKids = [stripBox, headBox, listBox];
    var paneKids = [el("div", { class: "pad" + (readOnly ? "" : " has-bottombar") }, padKids)];
    if (!readOnly) {
      paneKids.push(el("div", { class: "bottombar" }, [
        el("div", { class: "bb-info" }, [bbInfoT, bbInfoS]),
        el("button", { class: "bb-action", type: "button",
          onclick: function () {
            openTerminSheet(apptDayKey, function (createdDayKey) {
              if (createdDayKey) apptDayKey = createdDayKey;
              paintStrip();
              paintHead();
              loadDay();
            });
          } }, "＋ Neuer Termin")
      ]));
    }

    paintStrip();
    paintHead();
    loadDay();
    startApptPoll(loadDay);

    return el("div", {}, paneKids);
  }

  // ── Neuer-Termin sheet: type tiles → 30-min slots → Kunde/Kontakt ──
  function openTerminSheet(defaultDayKey, onCreated) {
    var todayKey = dayKeyOf(new Date());
    var selType = "";
    var selSlot = null;     // { iso, staffUserId, label }
    var selCustomer = null; // { id, name }
    var busy = false;
    var debTimer = null;

    var errBox = el("div", {});
    function setMsg(kind, text) {
      clear(errBox);
      if (text) errBox.appendChild(el("div", { class: "notice " + kind }, text));
    }

    // 1) Type tiles.
    var typeBox = el("div", { class: "typegrid" });
    function paintTypes() {
      clear(typeBox);
      APPT_TYPES.forEach(function (t) {
        typeBox.appendChild(el("button", {
          class: "type-tile", type: "button",
          "aria-pressed": selType === t[0] ? "true" : "false",
          onclick: function () { selType = t[0]; paintTypes(); loadSlots(); }
        }, [
          el("span", { class: "ico" }, t[2]),
          el("span", {}, t[1])
        ]));
      });
    }

    // 2) Date + 30-min slot grid (from the cloud's availability — each slot
    // carries its staffUserId, which the booking POST requires).
    var dateI = el("input", { class: "inp", type: "date", min: todayKey,
      value: (defaultDayKey && defaultDayKey >= todayKey) ? defaultDayKey : todayKey,
      onchange: function () { loadSlots(); } });
    var slotBox = el("div", {});
    function loadSlots() {
      selSlot = null;
      clear(slotBox);
      if (!selType) {
        slotBox.appendChild(el("div", { class: "scan-help" }, "Zuerst eine Termin-Art wählen."));
        return;
      }
      var key = dateI.value || todayKey;
      var bounds = dayBoundsIso(key);
      slotBox.appendChild(el("div", { class: "state-msg" }, "Freie Zeiten werden geladen…"));
      proxy("appointments/available-slots?type=" + encodeURIComponent(selType) +
            "&from=" + encodeURIComponent(bounds[0]) +
            "&to=" + encodeURIComponent(bounds[1]))
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var raw = (data && Array.isArray(data.slots)) ? data.slots : [];
          var now = new Date();
          var seen = {};
          var slots = [];
          raw.forEach(function (s) {
            var d = parseTs(s.slot_starts_at != null ? s.slot_starts_at : s.startsAt);
            var staff = s.staff_user_id || s.staffUserId || null;
            if (!d || !staff || d <= now) return;
            var label = fmtTimeHM(d);
            if (seen[label]) return;
            seen[label] = true;
            slots.push({ iso: d.toISOString(), staffUserId: staff, label: label });
          });
          clear(slotBox);
          if (!slots.length) {
            slotBox.appendChild(el("div", { class: "notice info" },
              "Keine freien Zeiten an diesem Tag. Bitte einen anderen Tag wählen."));
            return;
          }
          var grid = el("div", { class: "slotgrid" });
          slots.forEach(function (s) {
            grid.appendChild(el("button", {
              class: "slot-chip", type: "button",
              "aria-pressed": "false",
              onclick: function (e) {
                selSlot = s;
                var pressed = grid.querySelectorAll('[aria-pressed="true"]');
                var i;
                for (i = 0; i < pressed.length; i++) pressed[i].setAttribute("aria-pressed", "false");
                (e.currentTarget || e.target).setAttribute("aria-pressed", "true");
              }
            }, s.label));
          });
          slotBox.appendChild(grid);
        })
        .catch(function (err) {
          clear(slotBox);
          slotBox.appendChild(el("div", { class: "notice bad" },
            "Freie Zeiten konnten nicht geladen werden. (" + (err.message || "Fehler") + ")"));
        });
    }

    // 3) Customer: live search OR free-text Name+Telefon.
    var custResBox = el("div", {});
    var custPickBox = el("div", {});
    var freeBox = el("div", {});
    var custI = el("input", { class: "inp", type: "search",
      placeholder: "Name, Telefon oder E-Mail suchen…",
      "aria-label": "Kunde suchen",
      oninput: function (e) {
        var q = e.target.value.trim();
        if (debTimer) clearTimeout(debTimer);
        if (q.length < 2) { clear(custResBox); return; }
        debTimer = setTimeout(function () { searchCustomers(q); }, 300);
      } });
    var nameI = el("input", { class: "inp", type: "text", autocomplete: "off",
      placeholder: "Vor- und Nachname" });
    var phoneI = el("input", { class: "inp", type: "tel", autocomplete: "off",
      placeholder: "Optional — Telefonnummer" });

    function searchCustomers(q) {
      proxy("customers?q=" + encodeURIComponent(q) + "&limit=6")
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (data) {
          var items = (data && Array.isArray(data.items)) ? data.items : [];
          clear(custResBox);
          if (!items.length) {
            custResBox.appendChild(el("div", { class: "scan-help" },
              "Kein Kunde gefunden — unten Name und Telefon eintragen."));
            return;
          }
          var list = el("div", { class: "list" });
          items.slice(0, 6).forEach(function (c) {
            var nm = String(c.fullName || "Ohne Namen");
            list.appendChild(el("button", { class: "invrow", type: "button",
              "aria-label": nm + " auswählen",
              onclick: function () {
                selCustomer = { id: c.id, name: nm };
                if (c.id) custNames[c.id] = nm;
                custI.value = "";
                clear(custResBox);
                paintCustPick();
              } }, [
              el("div", { class: "meta" }, [
                el("div", { class: "nm" }, nm),
                el("div", { class: "sub" }, c.customerNumber ? ("Kunde " + c.customerNumber) : "—")
              ])
            ]));
          });
          custResBox.appendChild(list);
        })
        .catch(function () {
          clear(custResBox);
          custResBox.appendChild(el("div", { class: "notice info" },
            "Kundensuche derzeit nicht möglich — Name und Telefon unten eintragen."));
        });
    }

    function paintCustPick() {
      clear(custPickBox);
      if (selCustomer) {
        custPickBox.appendChild(el("div", { class: "custpick" }, [
          el("span", { class: "cp-n" }, selCustomer.name),
          el("button", { class: "cp-x", type: "button", "aria-label": "Kundenauswahl entfernen",
            onclick: function () { selCustomer = null; paintCustPick(); } }, "×")
        ]));
        freeBox.style.display = "none";
      } else {
        freeBox.style.display = "";
      }
    }

    // 4) Note.
    var noteTa = el("textarea", { class: "ta", maxlength: "500",
      placeholder: "Optional — Notiz (z. B. Anlass, mitgebrachte Stücke)" });

    var saveBtn = el("button", { class: "btn-primary inline", type: "button", onclick: submit },
      "Termin anlegen");

    function submit() {
      if (busy) return;
      if (!selType) { setMsg("bad", "Bitte eine Termin-Art wählen."); return; }
      if (!selSlot) { setMsg("bad", "Bitte ein freies Zeitfenster wählen."); return; }
      var freeName = nameI.value.trim();
      var freePhone = phoneI.value.trim();
      if (!selCustomer) {
        if (freeName.length < 2) {
          setMsg("bad", "Bitte einen Kunden wählen oder einen Namen (mind. 2 Zeichen) eintragen.");
          return;
        }
        if (freeName.length > 120) { setMsg("bad", "Der Name ist zu lang (max. 120 Zeichen)."); return; }
        if (freePhone && (freePhone.length < 6 || freePhone.length > 32)) {
          setMsg("bad", "Die Telefonnummer muss 6–32 Zeichen haben."); return;
        }
      }
      var note = noteTa.value.trim().slice(0, 500);

      var payload = {
        type: selType,
        startsAt: selSlot.iso,
        staffUserId: selSlot.staffUserId,
        bookedVia: "pos"
      };
      if (selCustomer) {
        payload.customerId = selCustomer.id;
        if (note) payload.customerNotes = note;
      } else {
        // Walk-in contact: dedicated fields per the shared 0062 contract (the
        // cloud strips unknown keys until that lands) + a notes fallback so
        // the contact is never lost on today's schema.
        payload.contactName = freeName;
        if (freePhone) {
          payload.contactPhone = freePhone;
          payload.customerPhone = freePhone;
        }
        payload.customerNotes = "Termin-Kontakt: " + freeName +
          (freePhone ? (", Tel. " + freePhone) : "") + (note ? (" — " + note) : "");
      }

      busy = true;
      saveBtn.disabled = true;
      setMsg("info", "Termin wird angelegt…");
      proxyJson("appointments", "POST", payload)
        .then(function () {
          busy = false;
          var bookedKey = dateI.value || todayKey;
          scanFeedback(true, "Termin angelegt",
            fmtDayLong(bookedKey) + " · " + selSlot.label + " · " + apptTypeLabel(selType));
          close();
          if (onCreated) onCreated(bookedKey);
        })
        .catch(function (err) {
          busy = false;
          saveBtn.disabled = false;
          var msgTxt = err.message || "Termin konnte nicht angelegt werden.";
          if (/no longer available|nicht mehr verfügbar|conflict/i.test(msgTxt)) {
            msgTxt = "Dieses Zeitfenster ist inzwischen belegt. Bitte eine andere Zeit wählen.";
            loadSlots();
          }
          setMsg("bad", msgTxt);
          scanFeedback(false, "Termin nicht angelegt", msgTxt);
        });
    }

    var sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Neuer Termin" }, [
      el("div", { class: "sheet-head" }, [
        el("span", { class: "t" }, "Neuer Termin"),
        el("button", { class: "x", type: "button", "aria-label": "Schließen", onclick: close }, "×")
      ]),
      el("div", { class: "sheet-body scroll" }, [
        el("div", { class: "form" }, [
          el("div", { class: "sectionhead", style: "margin-top:0" }, "Termin-Art"),
          typeBox,
          el("div", { class: "sectionhead" }, "Tag & Uhrzeit"),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Tag"), dateI ]),
          slotBox,
          el("div", { class: "sectionhead" }, "Kunde"),
          custPickBox,
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Bestandskunde suchen (optional)"), custI ]),
          custResBox,
          freeBox,
          el("div", { class: "sectionhead" }, "Notiz"),
          noteTa,
          errBox,
          el("div", { class: "btn-row" }, [
            el("button", { class: "btn-ghost", type: "button", onclick: close }, "Abbrechen"),
            saveBtn
          ]),
          el("div", { class: "scan-help" },
            "Die freien Zeiten folgen den Öffnungszeiten der Hauptkasse (30-Minuten-Raster). " +
            "Ohne Bestandskunde genügen Name und Telefonnummer.")
        ])
      ])
    ]);

    freeBox.appendChild(el("div", { class: "form-row two" }, [
      el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Name (ohne Kundenkonto)"), nameI ]),
      el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Telefon"), phoneI ])
    ]));

    function close() {
      if (debTimer) clearTimeout(debTimer);
      try { sheet.remove(); } catch (e) {}
    }

    paintTypes();
    paintCustPick();
    loadSlots();
    document.body.appendChild(sheet);
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

  // A product thumbnail node: the real photo (proxied so it rides the mother's
  // Bearer via the GET query-token fallback) with a graceful fall to an item
  // glyph if there is no photo OR the image fails to load.
  function thumbNode(p) {
    var url = photoThumb(p);
    if (!url) return glyphFor(p);
    return el("img", { class: "thumb", src: url, alt: "", referrerpolicy: "no-referrer",
      onerror: function (e) { try { e.target.replaceWith(glyphFor(p)); } catch (x) {} } });
  }

  // ≥56px inventory row: photo (or glyph) + name + SKU + bin + price.
  function inventoryRow(p, onOpen) {
    var thumb = thumbNode(p);
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
  function productDetail(p, onSaved, onBack) {
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
    var binNoteI = el("input", { class: "inp", type: "text", placeholder: "Optional — Notiz" });

    function setMsg(kind, text) { clear(msg); msg.appendChild(el("div", { class: "notice " + kind }, text)); }

    var saveBtn = el("button", { class: "btn-primary inline", type: "button", onclick: saveProduct }, "Änderungen speichern");
    var binBtn = el("button", { class: "btn-ghost", type: "button", onclick: saveBin }, "Umlagern");

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

    // Re-shelve via the dedicated LOCATION-ONLY route (no step-up), so a phone
    // re-shelve actually succeeds — the old inventory-adjustment path is
    // step-up-gated and walled a mobile worker behind the Hauptkasse. The
    // relocate route needs ALL THREE coordinates, so the fields are pre-filled
    // with the current location and a partial edit still sends a complete set.
    function saveBin() {
      if (busy) return;
      var unit = unitI.value.trim(), drw = drwI.value.trim(), pos = posI.value.trim();
      if (!unit || !drw || !pos) {
        setMsg("bad", "Bitte Einheit, Fach und Position angeben.");
        return;
      }
      var body = {
        locationStorageUnit: unit,
        locationDrawer: drw,
        locationPosition: pos
      };
      var note = binNoteI.value.trim();
      if (note) body.notes = note;
      busy = true; binBtn.disabled = true; setMsg("info", "Lagerort wird übernommen…");
      proxyJson("products/" + encodeURIComponent(p.id) + "/relocate", "POST", body)
        .then(function () {
          busy = false; binBtn.disabled = false;
          setMsg("ok", "Lagerort aktualisiert: " + unit + " · " + drw + " · " + pos + ".");
          scanFeedback(true, "Umgelagert", unit + " · " + drw + " · " + pos);
          // Reflect the new location locally so a later edit starts from it.
          p.locationStorageUnit = unit; p.locationDrawer = drw; p.locationPosition = pos;
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
        // Multi-capture: each shot uploads to this product immediately. The
        // server keeps the first-ever photo as Hauptbild; the operator can pick a
        // different one from the grid below.
        openCameraSheet(function (blob) {
          uploadPhoto(p.id, blob, false, function (ok, message) {
            if (ok) { setMsg("ok", "Foto hochgeladen."); refreshPhotos(); }
            else setMsg("bad", message || "Foto-Upload fehlgeschlagen.");
          });
        }, { multi: true });
      } }, "📷 Fotos aufnehmen");

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
      onBack ? el("button", { class: "btn-ghost", type: "button",
        style: "flex:none; align-self:flex-start; margin-bottom:.85rem", onclick: onBack },
        "← Zurück zur Liste") : null,
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

        el("div", { class: "sectionhead" }, "Umlagern"),
        el("div", { class: "form-row three" }, [
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Einheit"), unitI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Fach"), drwI ]),
          el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Position"), posI ])
        ]),
        el("div", { class: "fl" }, [ el("span", { class: "lab" }, "Notiz (optional)"), binNoteI ]),
        el("div", { class: "btn-row" }, [ binBtn ]),
        msg,
        el("div", { class: "scan-help" },
          "Umlagern ändert nur den Lagerort und wird protokolliert — keine Freigabe an der " +
          "Hauptkasse nötig. Menge oder Status ändern bleibt der Hauptkasse vorbehalten.")
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
  // opts.multi === true keeps the sheet open after each "Verwenden" so the
  // operator can shoot SEVERAL angles in one sitting; each fires onCapture and a
  // "Fertig (N)" button closes when done (the caller decides the Hauptbild).
  function openCameraSheet(onCapture, opts) {
    opts = opts || {};
    var multi = !!opts.multi;
    var captureCount = 0;
    var streamRef = null;
    var captured = null; // Blob once shot/picked (already downscaled).
    var primaryChk = el("input", { type: "checkbox", id: "cam-primary", checked: "" });

    var video = el("video", { autoplay: "", muted: "", playsinline: "" });
    var stage = el("div", { class: "cam-stage" }, [ video ]);
    var canvas = document.createElement("canvas");

    var shutter = el("button", { class: "shutter", type: "button", "aria-label": "Foto aufnehmen", onclick: shoot });
    var retakeBtn = el("button", { class: "btn-ghost", type: "button", style: "display:none", onclick: retake }, "Neu aufnehmen");
    var useBtn = el("button", { class: "btn-primary inline", type: "button", style: "display:none", onclick: useShot }, multi ? "Hinzufügen" : "Verwenden");
    var primaryRow = el("label", { class: "toggle", for: "cam-primary", style: "display:none; justify-content:center" }, [
      primaryChk, el("span", { class: "track" }), el("span", { class: "tlab" }, "Als Hauptbild")
    ]);

    // Review-state edit tools: rotate in 90° steps + an optional centre-square
    // crop (the storefront tile shape). Both re-derive from the ORIGINAL frame so
    // repeated taps never compound JPEG loss.
    var origBlob = null, rotation = 0, cropSquare = false;
    var rotateBtn = el("button", { class: "btn-ghost", type: "button",
      onclick: function () { rotation = (rotation + 90) % 360; reEdit(); } }, "↻ Drehen");
    var squareBtn = el("button", { class: "btn-ghost", type: "button", "aria-pressed": "false",
      onclick: function () {
        cropSquare = !cropSquare;
        squareBtn.setAttribute("aria-pressed", cropSquare ? "true" : "false");
        reEdit();
      } }, "✂ Zuschneiden");
    var editRow = el("div", { class: "btn-row", style: "display:none" }, [ rotateBtn, squareBtn ]);

    // In multi mode a "Fertig" button (with a running count) closes the sheet.
    var doneBtn = el("button", { class: "btn-primary inline", type: "button",
      style: multi ? "" : "display:none", onclick: function () { close(); } }, "Fertig");
    var controls = el("div", { class: "cam-controls" }, multi ? [ shutter, doneBtn ] : [ shutter ]);

    // The hub serves http:// (no TLS on the LAN origin), so on iOS/Android
    // getUserMedia is BLOCKED (insecure context). In that case — or wherever the
    // live camera API is missing — we render a native file-input fallback
    // (capture=environment opens the rear camera) so photo capture works TODAY.
    var liveCameraUsable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      (window.isSecureContext !== false);

    var sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Foto aufnehmen" }, [
      el("div", { class: "sheet-head" }, [
        el("span", { class: "t" }, "Foto aufnehmen"),
        el("button", { class: "x", type: "button", "aria-label": "Schließen", onclick: close }, "×")
      ]),
      el("div", { class: "sheet-body" }, [
        stage,
        editRow,
        primaryRow,
        el("div", { class: "btn-row" }, [ retakeBtn, useBtn ]),
        controls
      ])
    ]);
    document.body.appendChild(sheet);

    if (liveCameraUsable) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1920 } } })
        .then(function (stream) { streamRef = stream; video.srcObject = stream; })
        .catch(function () { showFileFallback("Kamerazugriff nicht erlaubt — Foto aus der Galerie/Kamera wählen."); });
    } else {
      // Insecure context or no getUserMedia → straight to the file fallback.
      showFileFallback(window.isSecureContext === false
        ? "Live-Kamera ist über die LAN-Verbindung gesperrt — Foto mit der Telefonkamera aufnehmen."
        : "Live-Kamera auf diesem Gerät nicht verfügbar — Foto wählen.");
    }

    // The native picker (rear camera on phones). Selecting a file downscales it
    // and jumps straight to the review state with the chosen image.
    var fileInput = el("input", {
      type: "file", accept: "image/*", capture: "environment",
      class: "sr-only", id: "cam-file",
      onchange: function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        downscaleToJpeg(f).then(function (blob) {
          captured = blob;
          showReview(blob);
        }).catch(function () {
          // If canvas decode fails, fall back to the raw file as-is.
          captured = f;
          showReview(f);
        });
      }
    });
    function showFileFallback(reason) {
      clear(stage);
      stage.appendChild(el("div", { class: "ph" }, [
        el("div", {}, reason),
        el("label", { class: "btn-primary inline file-pick", for: "cam-file",
          style: "margin-top:1rem; display:inline-flex; align-items:center; justify-content:center" },
          "📷 Foto aufnehmen / wählen"),
        fileInput
      ]));
      shutter.style.display = "none";
    }
    function paintReviewImage() {
      var img = el("img", { alt: "Aufnahme" });
      img.src = URL.createObjectURL(captured);
      clear(stage); stage.appendChild(img);
    }
    function reEdit() {
      if (!origBlob) return;
      transformImage(origBlob, rotation, cropSquare).then(function (b) {
        captured = b; paintReviewImage();
      }).catch(function () { /* keep the current frame on any decode error */ });
    }
    function showReview(blob) {
      origBlob = blob; rotation = 0; cropSquare = false; captured = blob;
      squareBtn.setAttribute("aria-pressed", "false");
      paintReviewImage();
      shutter.style.display = "none";
      retakeBtn.style.display = ""; useBtn.style.display = "";
      primaryRow.style.display = multi ? "none" : ""; editRow.style.display = "";
    }

    function shoot() {
      // Live path: grab the frame, then downscale to the same target as files.
      var w = video.videoWidth || 1280;
      var h = video.videoHeight || 1280;
      var fit = fitWithin(w, h, 1280);
      canvas.width = fit.w; canvas.height = fit.h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, fit.w, fit.h);
      canvas.toBlob(function (blob) {
        if (!blob) return;
        captured = blob;
        showReview(blob);
      }, "image/jpeg", 0.75);
    }
    function retake() {
      captured = null;
      try { fileInput.value = ""; } catch (e) {}
      clear(stage);
      if (liveCameraUsable && streamRef) {
        stage.appendChild(video);
        shutter.style.display = "";
      } else {
        showFileFallback("Neues Foto wählen.");
      }
      retakeBtn.style.display = "none";
      useBtn.style.display = "none"; primaryRow.style.display = "none"; editRow.style.display = "none";
    }
    function useShot() {
      if (!captured) return;
      var blob = captured;
      if (multi) {
        captureCount += 1;
        onCapture(blob, captureCount === 1);
        doneBtn.textContent = "Fertig (" + captureCount + ")";
        retake(); // back to the capture state, ready for the next angle
      } else {
        close();
        onCapture(blob, primaryChk.checked);
      }
    }
    function close() {
      try { if (streamRef) streamRef.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { sheet.remove(); } catch (e) {}
    }
  }

  // Fit (w,h) within a `max` longest-edge box, preserving aspect ratio.
  function fitWithin(w, h, max) {
    w = w || max; h = h || max;
    var longest = Math.max(w, h);
    if (longest <= max) return { w: Math.round(w), h: Math.round(h) };
    var scale = max / longest;
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }
  // Apply review-state edits to an already-downscaled JPEG: rotate in 90° steps
  // and/or crop to the centre square, then re-encode. Derives from the ORIGINAL
  // frame each call (no compounding loss). Result stays ≤1280px so the upload
  // remains small. Resolves to a JPEG Blob; rejects on decode failure.
  function transformImage(blob, rotateDeg, square) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        try {
          var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          var sx = 0, sy = 0, sw = iw, sh = ih;
          if (square) { var s = Math.min(iw, ih); sx = (iw - s) / 2; sy = (ih - s) / 2; sw = s; sh = s; }
          var rot = ((rotateDeg % 360) + 360) % 360;
          var swapped = (rot === 90 || rot === 270);
          var c = document.createElement("canvas");
          c.width = swapped ? sh : sw;
          c.height = swapped ? sw : sh;
          var ctx = c.getContext("2d");
          ctx.translate(c.width / 2, c.height / 2);
          ctx.rotate(rot * Math.PI / 180);
          ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
          c.toBlob(function (out) {
            try { URL.revokeObjectURL(url); } catch (e) {}
            if (out) resolve(out); else reject(new Error("toBlob failed"));
          }, "image/jpeg", 0.8);
        } catch (e) { try { URL.revokeObjectURL(url); } catch (x) {} reject(e); }
      };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} reject(new Error("decode failed")); };
      img.src = url;
    });
  }
  // Decode an image File/Blob, downscale to ≤1280px longest edge, re-encode JPEG
  // q0.75 — keeps the upload well under the hub's 1 MiB body cap (base64 adds
  // ~33%). Resolves to the JPEG Blob; rejects if the image can't be decoded.
  function downscaleToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var fit = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, 1280);
          var c = document.createElement("canvas");
          c.width = fit.w; c.height = fit.h;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, fit.w, fit.h);
          c.toBlob(function (blob) {
            try { URL.revokeObjectURL(url); } catch (e) {}
            if (blob) resolve(blob); else reject(new Error("toBlob failed"));
          }, "image/jpeg", 0.75);
        } catch (e) { try { URL.revokeObjectURL(url); } catch (x) {} reject(e); }
      };
      img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} reject(new Error("decode failed")); };
      img.src = url;
    });
  }

  // Upload several photos to one product IN SEQUENCE (the first becomes the
  // Hauptbild). Sequential keeps each base64 body small and gives the server a
  // deterministic primary. Reports (okCount, failCount) when all are done.
  function uploadPhotos(productId, blobs, onDone) {
    var ok = 0, fail = 0, i = 0;
    (function next() {
      if (i >= blobs.length) { if (onDone) onDone(ok, fail); return; }
      uploadPhoto(productId, blobs[i], i === 0, function (good) {
        if (good) ok++; else fail++;
        i += 1; next();
      });
    })();
  }

  // Upload a captured JPEG via the proxy → POST /api/photos/upload (bytes
  // through the API, no R2 CORS dependency — the durable POS path). On failure
  // we surface the REAL HTTP status text (code + statusText + any cloud message)
  // instead of a generic line, so a 413 body-cap or 415 type is diagnosable on
  // the shop floor. The image was already downscaled (≤1280px JPEG q0.75) so it
  // stays under the hub's 4 MiB body cap even after base64 inflation.
  function uploadPhoto(productId, blob, isPrimary, done) {
    blobToBase64(blob).then(function (b64) {
      var payload = { dataBase64: b64, contentType: "image/jpeg", productId: productId, intent: "product" };
      if (isPrimary) payload.isPrimary = true;
      return proxy("photos/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        if (r.ok) return;
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* non-JSON */ }
        var cloudMsg = data && data.error && data.error.message;
        // Real status text first (e.g. "413 Payload Too Large"), then any cloud detail.
        var statusText = r.status + (r.statusText ? " " + r.statusText : "");
        throw new Error("HTTP " + statusText + (cloudMsg ? " — " + cloudMsg : ""));
      });
    }).then(function () {
      scanFeedback(true, "Foto hochgeladen", null);
      done(true);
    }).catch(function (err) {
      var m = (err && err.message) ? err.message : "Unbekannter Fehler";
      scanFeedback(false, "Foto-Upload fehlgeschlagen", m);
      done(false, m);
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
    if (!w) { snackbar("Bitte Pop-ups erlauben, um das Etikett zu drucken."); return; }
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
    // A restored (not freshly paired) token gets silently revalidated first —
    // straight to the role home on success, re-pair CTA only on real rejection.
    if (!sessionChecked) { renderReconnect(); return; }
    if (role === "display")   { renderDisplay();   return; }
    if (role === "cashier")   { renderCashier();   return; }
    if (role === "warehouse") { renderWarehouse(); return; }
    renderPairing();
  }

  render();
})();
