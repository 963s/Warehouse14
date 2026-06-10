"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Coins,
  Download,
  Gem,
  MapPin,
  MessagesSquare,
  PackageCheck,
} from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/cn";
import {
  data,
  StorefrontError,
  type AppointmentSlot,
  type AppointmentType,
} from "@/lib/storefront-data";

// ─────────────────────────────────────────────────────────────────────────────
// Static config
// ─────────────────────────────────────────────────────────────────────────────

const TYPES: {
  value: AppointmentType;
  label: string;
  desc: string;
  Icon: typeof Gem;
}[] = [
  {
    value: "VIEWING",
    label: "Besichtigung",
    desc: "Ein Stück aus der Kollektion vor Ort ansehen",
    Icon: Gem,
  },
  {
    value: "BUYBACK_EVAL",
    label: "Goldankauf",
    desc: "Gold, Münzen oder Schmuck bewerten und verkaufen",
    Icon: Coins,
  },
  {
    value: "CONSULTATION",
    label: "Beratung",
    desc: "Persönliches Gespräch zu Anlage und Sammlung",
    Icon: MessagesSquare,
  },
  {
    value: "PICKUP",
    label: "Abholung",
    desc: "Reservierte oder bestellte Stücke abholen",
    Icon: PackageCheck,
  },
];

const WEEKDAYS_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

interface DayOption {
  key: string; // YYYY-MM-DD
  weekday: string;
  dayOfMonth: number;
  month: string;
  isToday: boolean;
  closed: boolean; // Sunday
}

/** Local YYYY-MM-DD (the visitor sits in the shop's timezone). */
function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function buildDays(count: number): DayOption[] {
  const out: DayOption[] = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    out.push({
      key: toDateKey(d),
      weekday: WEEKDAYS_SHORT[d.getDay()],
      dayOfMonth: d.getDate(),
      month: MONTHS_SHORT[d.getMonth()],
      isToday: i === 0,
      closed: d.getDay() === 0, // sonntags geschlossen
    });
  }
  return out;
}

const timeFmt = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

const longDateFmt = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

/** Client-generated .ics for the chosen 30-minute slot. */
function buildIcs(typeLabel: string, startsAt: string, id: string): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//warehouse14//Termin//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${id}@warehouse14.de`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${typeLabel} – warehouse14 Schorndorf`,
    "LOCATION:warehouse14\\, Musterstraße 14\\, 73614 Schorndorf",
    "DESCRIPTION:Ihr Termin bei warehouse14. Wir bestätigen Ihren Termin.",
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// View
// ─────────────────────────────────────────────────────────────────────────────

type SlotsState = "idle" | "loading" | "ready" | "error";

export function TerminView() {
  // Step 1-3 selection
  const [type, setType] = useState<AppointmentType | null>(null);
  const [days, setDays] = useState<DayOption[] | null>(null); // built client-side (no hydration drift)
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [slotsState, setSlotsState] = useState<SlotsState>("idle");
  const [slotsReload, setSlotsReload] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  /** Shown in step 3, e.g. after a 409 (the chosen slot was just taken). */
  const [slotNotice, setSlotNotice] = useState<string | null>(null);

  // Step 4 contact form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Success
  const [booked, setBooked] = useState<{ id: string; type: AppointmentType; startsAt: string } | null>(null);

  // The 14-day strip depends on "today" — build it after mount so the
  // statically prerendered HTML never disagrees with the client clock.
  useEffect(() => {
    const built = buildDays(14);
    setDays(built);
    setDateKey((cur) => cur ?? built.find((d) => !d.closed)?.key ?? built[0].key);
  }, []);

  // Load slots whenever Anliegen + Tag are chosen (and on explicit reload).
  useEffect(() => {
    if (!type || !dateKey) return;
    let cancelled = false;
    setSlotsState("loading");
    setSelectedSlot(null);
    data
      .getAppointmentSlots(dateKey, type)
      .then((res) => {
        if (cancelled) return;
        setSlots(res.slots);
        setSlotsState("ready");
      })
      .catch(() => {
        if (!cancelled) setSlotsState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [type, dateKey, slotsReload]);

  const typeLabel = TYPES.find((t) => t.value === (booked?.type ?? type))?.label ?? "Termin";

  const icsHref = useMemo(() => {
    if (!booked) return null;
    const ics = buildIcs(typeLabel, booked.startsAt, booked.id);
    return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  }, [booked, typeLabel]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!type || !selectedSlot) return;

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setFormError("Bitte geben Sie Ihren Namen an (2 bis 120 Zeichen).");
      return;
    }
    if (trimmedPhone.length < 6 || trimmedPhone.length > 32) {
      setFormError("Bitte geben Sie eine gültige Telefonnummer an (6 bis 32 Zeichen).");
      return;
    }
    if (note.trim().length > 500) {
      setFormError("Ihre Notiz darf höchstens 500 Zeichen lang sein.");
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      const res = await data.bookAppointment({
        type,
        startsAt: selectedSlot,
        name: trimmedName,
        phone: trimmedPhone,
        email: email.trim() || undefined,
        note: note.trim() || undefined,
      });
      setBooked({ id: res.id, type: res.type, startsAt: res.startsAt });
    } catch (err) {
      const status = err instanceof StorefrontError ? err.status : null;
      if (status === 409) {
        // The slot grid reloads (clearing the stale selection), so the honest
        // message lives in step 3 — right where the user picks the new time.
        setSlotNotice(
          "Diese Uhrzeit wurde soeben anderweitig vergeben. Die verfügbaren Zeiten wurden aktualisiert – bitte wählen Sie eine andere Uhrzeit.",
        );
        setSlotsReload((k) => k + 1);
      } else if (status === 429) {
        setFormError(
          "Zu viele Anfragen von Ihrem Anschluss. Bitte versuchen Sie es später erneut oder rufen Sie uns an: +49 (0)7181 000000.",
        );
      } else if (status === 400) {
        setFormError(
          "Ihre Anfrage konnte nicht verarbeitet werden. Bitte prüfen Sie Uhrzeit und Kontaktdaten und versuchen Sie es erneut.",
        );
      } else {
        setFormError(
          "Die Terminanfrage ist fehlgeschlagen. Bitte versuchen Sie es erneut oder rufen Sie uns an: +49 (0)7181 000000.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setBooked(null);
    setSelectedSlot(null);
    setName("");
    setPhone("");
    setEmail("");
    setNote("");
    setFormError(null);
    setSlotsReload((k) => k + 1);
  }

  // ── Success state ───────────────────────────────────────────────────────────
  if (booked) {
    return (
      <PageShell>
        <article className="mx-auto max-w-2xl px-5 py-16 md:py-24">
          <div className="rounded-card border border-rule bg-card p-6 text-center shadow-card md:p-10">
            <CheckCircle2 className="mx-auto h-12 w-12 text-gold" aria-hidden="true" />
            <h1 className="mt-5 font-display text-3xl font-semibold text-ink md:text-4xl">
              Ihre Terminanfrage ist eingegangen
            </h1>
            <p className="mt-4 text-ink-aged leading-relaxed">
              <span className="font-medium text-ink">{typeLabel}</span>
              <br />
              {longDateFmt.format(new Date(booked.startsAt))}
              {", "}
              <span className="tnum">{timeFmt.format(new Date(booked.startsAt))} Uhr</span>
            </p>
            <p className="mt-4 text-ink-aged leading-relaxed">
              Wir bestätigen Ihren Termin. Sie hören telefonisch oder per E-Mail von uns.
            </p>
            <p className="mt-5 flex items-start justify-center gap-2 text-sm text-ink-faded">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
              <span>
                warehouse14 · Musterstraße 14 · 73614 Schorndorf
              </span>
            </p>

            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
              {icsHref && (
                <a
                  href={icsHref}
                  download="warehouse14-termin.ics"
                  className="bg-gold-gradient inline-flex min-h-[44px] items-center justify-center gap-2 rounded-button px-6 py-3 text-sm font-semibold text-[#2b210a] transition-transform duration-fast ease-hover hover:-translate-y-px"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Termin in Kalender speichern (.ics)
                </a>
              )}
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex min-h-[44px] items-center justify-center rounded-button border border-rule px-6 py-3 text-sm font-medium text-ink-aged transition-colors duration-fast ease-hover hover:border-gold hover:text-gold"
              >
                Weiteren Termin anfragen
              </button>
            </div>
          </div>
        </article>
      </PageShell>
    );
  }

  // ── Booking flow ────────────────────────────────────────────────────────────
  return (
    <PageShell>
      <article className="mx-auto max-w-2xl space-y-12 px-5 py-16 md:py-24">
        {/* Seitenheader */}
        <Reveal>
          <header className="space-y-4">
            <h1 className="font-display text-4xl font-semibold text-ink md:text-5xl">
              Termin vereinbaren
            </h1>
            <p className="max-w-xl leading-relaxed text-ink-aged">
              Wählen Sie Anliegen, Tag und Uhrzeit – wir nehmen uns eine halbe
              Stunde Zeit für Sie und bestätigen jeden Termin persönlich.
            </p>
          </header>
        </Reveal>

        {/* 1 · Anliegen */}
        <Reveal delay={0.06}>
          <section aria-labelledby="termin-anliegen">
            <h2 id="termin-anliegen" className="eyebrow mb-4 text-ink-faded">
              1 · Ihr Anliegen
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TYPES.map(({ value, label, desc, Icon }) => {
                const active = type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setType(value);
                      setSlotNotice(null);
                    }}
                    className={cn(
                      "flex min-h-[44px] items-start gap-3 rounded-card border p-4 text-left transition-colors duration-fast ease-hover",
                      active
                        ? "border-gold bg-card shadow-card"
                        : "border-rule bg-card hover:border-gold/60",
                    )}
                  >
                    <Icon
                      className={cn("mt-0.5 h-5 w-5 shrink-0", active ? "text-gold" : "text-ink-faded")}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">{label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-aged">{desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </Reveal>

        {/* 2 · Tag */}
        {type && (
          <section aria-labelledby="termin-tag">
            <h2 id="termin-tag" className="eyebrow mb-4 text-ink-faded">
              2 · Tag wählen
            </h2>
            {days === null ? (
              <p className="text-sm text-ink-faded">Kalender wird geladen …</p>
            ) : (
              <div
                className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2"
                role="group"
                aria-label="Tag wählen (nächste 14 Tage)"
              >
                {days.map((d) => {
                  const active = dateKey === d.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={d.closed}
                      aria-pressed={active}
                      onClick={() => {
                        setDateKey(d.key);
                        setSlotNotice(null);
                      }}
                      className={cn(
                        "flex min-h-[44px] min-w-[64px] shrink-0 flex-col items-center justify-center rounded-card border px-3 py-2 transition-colors duration-fast ease-hover",
                        d.closed
                          ? "cursor-not-allowed border-rule/60 text-ink-faded/60"
                          : active
                            ? "border-gold bg-card shadow-card"
                            : "border-rule bg-card hover:border-gold/60",
                      )}
                    >
                      <span className={cn("text-[0.68rem] font-medium uppercase tracking-wide", active ? "text-gold" : "text-ink-faded")}>
                        {d.isToday ? "Heute" : d.weekday}
                      </span>
                      <span className="tnum text-base font-semibold text-ink">{d.dayOfMonth}</span>
                      <span className="text-[0.68rem] text-ink-faded">
                        {d.closed ? "geschl." : d.month}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 3 · Uhrzeit */}
        {type && dateKey && (
          <section aria-labelledby="termin-uhrzeit">
            <h2 id="termin-uhrzeit" className="eyebrow mb-4 text-ink-faded">
              3 · Uhrzeit wählen
            </h2>

            {slotNotice && (
              <p
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-card border border-rule bg-card p-4 text-sm leading-relaxed text-ink-aged"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-wax-red" aria-hidden="true" />
                {slotNotice}
              </p>
            )}

            {slotsState === "loading" && (
              <p className="text-sm text-ink-faded" role="status">
                Verfügbare Zeiten werden geladen …
              </p>
            )}

            {slotsState === "error" && (
              <div className="flex flex-col items-start gap-3 rounded-card border border-rule bg-card p-4">
                <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-aged">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-wax-red" aria-hidden="true" />
                  Die verfügbaren Zeiten konnten nicht geladen werden.
                </p>
                <button
                  type="button"
                  onClick={() => setSlotsReload((k) => k + 1)}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-button border border-rule px-5 text-sm font-medium text-ink-aged transition-colors duration-fast ease-hover hover:border-gold hover:text-gold"
                >
                  Erneut versuchen
                </button>
              </div>
            )}

            {slotsState === "ready" && slots.length === 0 && (
              <p className="rounded-card border border-rule bg-card p-4 text-sm leading-relaxed text-ink-aged">
                Für diesen Tag sind keine Zeiten verfügbar. Bitte wählen Sie
                einen anderen Tag.
              </p>
            )}

            {slotsState === "ready" && slots.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => {
                  const active = selectedSlot === s.startsAt;
                  return (
                    <button
                      key={s.startsAt}
                      type="button"
                      disabled={!s.available}
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedSlot(s.startsAt);
                        setSlotNotice(null);
                      }}
                      className={cn(
                        "tnum inline-flex min-h-[44px] items-center justify-center rounded-button border text-sm font-medium transition-colors duration-fast ease-hover",
                        !s.available
                          ? "cursor-not-allowed border-rule/60 text-ink-faded/50 line-through"
                          : active
                            ? "border-gold bg-card font-semibold text-gold shadow-card"
                            : "border-rule bg-card text-ink hover:border-gold/60",
                      )}
                    >
                      {timeFmt.format(new Date(s.startsAt))}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 4 · Kontakt */}
        {type && selectedSlot && (
          <section aria-labelledby="termin-kontakt">
            <h2 id="termin-kontakt" className="eyebrow mb-4 text-ink-faded">
              4 · Ihre Kontaktdaten
            </h2>
            <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-card border border-rule bg-card p-5 shadow-card md:p-6">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-ink-aged">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span>
                  {typeLabel} · {longDateFmt.format(new Date(selectedSlot))},{" "}
                  <span className="tnum">{timeFmt.format(new Date(selectedSlot))} Uhr</span>
                </span>
              </p>

              <div className="space-y-1.5">
                <label htmlFor="termin-name" className="block text-sm font-medium text-ink">
                  Name
                </label>
                <input
                  id="termin-name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ihr vollständiger Name"
                  className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="termin-telefon" className="block text-sm font-medium text-ink">
                    Telefon
                  </label>
                  <input
                    id="termin-telefon"
                    name="phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="z. B. 07181 000000"
                    className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="termin-email" className="block text-sm font-medium text-ink">
                    E-Mail <span className="font-normal text-ink-faded">(optional)</span>
                  </label>
                  <input
                    id="termin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ihre@email.de"
                    className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-gold/40"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="termin-notiz" className="block text-sm font-medium text-ink">
                  Notiz <span className="font-normal text-ink-faded">(optional)</span>
                </label>
                <textarea
                  id="termin-notiz"
                  name="note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Worum geht es? Z. B. „Erbschmuck bewerten lassen“"
                  className="w-full resize-none rounded-button border border-rule bg-surface px-4 py-2.5 text-sm text-ink transition-[border-color,box-shadow] placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-gold/40"
                />
              </div>

              {formError && (
                <p role="alert" className="flex items-start gap-2 text-sm leading-relaxed text-wax-red">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="bg-gold-gradient inline-flex min-h-[48px] w-full items-center justify-center rounded-button px-7 py-3 text-sm font-semibold text-[#2b210a] transition-transform duration-fast ease-hover hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {submitting ? "Wird gesendet …" : "Termin anfragen"}
              </button>
              <p className="text-xs leading-relaxed text-ink-faded">
                Ihre Angaben verwenden wir ausschließlich zur Abwicklung dieses
                Termins. Wir bestätigen Ihren Termin persönlich.
              </p>
            </form>
          </section>
        )}
      </article>
    </PageShell>
  );
}
