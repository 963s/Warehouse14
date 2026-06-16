# Warehouse 14 — Google Workspace: Support-Adressen + Standard-Signatur

Domain: **warehouse14.de** · Customer-ID: **C037v6xms** · Super-Admin: **admin@warehouse14.de**

> **Wichtig (Sicherheit):** Claude darf sich NICHT anmelden / keine Passwörter eingeben.
> Der eine Schritt, den Basel selbst macht, ist die **GAM-Autorisierung** (Login + Scopes).
> Danach kann Claude alle GAM-Befehle unten ausführen (Token, kein Passwort).

---

## 0. Einmalig: GAM autorisieren (nur Basel)

```bash
~/bin/gam7/gam oauth create
```

Browser öffnet sich → mit **admin@warehouse14.de** anmelden → alle Scopes zulassen.
Danach prüfen:

```bash
~/bin/gam7/gam info domain        # muss Domain-Infos zeigen, keinen 401
```

Falls "API not enabled": in der Google Cloud Console (Projekt des Workspace) die
**Admin SDK API** + **Gmail API** aktivieren, dann `gam oauth create` erneut.

---

## 1. Support-Adressen — KEINE neuen Nutzer, sondern Alias + "Senden als"

Ziel: `support@`, `kontakt@`, `info@` empfangen Mails (landen bei admin@), und
admin@ **und** Roman können beim Schreiben die Absenderadresse wählen.

```bash
GAM=~/bin/gam7/gam

# a) Alias-Adressen (eingehende Mail an diese Adressen → Postfach admin@)
$GAM create alias support@warehouse14.de  user admin@warehouse14.de
$GAM create alias kontakt@warehouse14.de  user admin@warehouse14.de
$GAM create alias info@warehouse14.de     user admin@warehouse14.de

# b) "Senden als" — Absenderauswahl im Gmail-Verfasser (admin + Roman)
for U in admin@warehouse14.de romanalexander77@outlook.de; do
  $GAM user $U add sendas support@warehouse14.de "Warehouse 14 Support" \
       replyto support@warehouse14.de default treatasalias true
done
# Hinweis: Romans Konto muss im Workspace sein (roman@warehouse14.de). Falls er
# extern (outlook.de) ist, stattdessen ihm ein Workspace-Konto/Alias geben.
```

> Alternativ (echtes Team-Postfach): eine **Google-Gruppe** `support@warehouse14.de`
> mit Mitgliedern admin@ + roman@, "extern darf posten" + "Mitglieder posten als Gruppe".

---

## 2. Standard-Signatur ORG-WEIT (auch vom Handy) — Admin-Konsole

GAM kann den org-weiten Footer **nicht** setzen. Das ist die einzige Stelle, die
auf JEDEM Gerät (auch Gmail-App am Handy) automatisch anhängt:

**admin.google.com → Apps → Google Workspace → Gmail → Compliance → "Footer anhängen / Append footer"**
→ Konfigurieren → den HTML-Block aus `email-signature.html` einfügen → Speichern.

- Das Logo muss eine **öffentliche URL** sein (Inline-Bilder gehen hier nicht).
  Optionen für die URL:
  - GitHub-Release-Asset (öffentlich, stabil) — Claude kann das Logo dort anhängen.
  - `https://www.warehouse14.de/assets/warehouse14-logo.png` — sobald die Domain live ist.
- Gilt für **alle** ausgehenden Mails der Domain, inkl. Antworten, inkl. Handy.

## 2b. Web-Gmail-Signatur pro Nutzer (Gürtel + Hosenträger) — via GAM

```bash
$GAM user admin@warehouse14.de signature file ~/Desktop/warehouse14/docs/branding/email-signature.html html
# (gleiches für weitere Nutzer)
```

---

## 3. Was Claude erledigt — sobald GAM autorisiert ist
- [ ] Aliasse support/kontakt/info anlegen (Abschnitt 1a)
- [ ] "Senden als" für admin (+ Roman, wenn Workspace-Konto) (1b)
- [ ] Web-Signatur pro Nutzer setzen (2b)
- [ ] Logo als öffentliches Release-Asset hochladen → URL für den Footer liefern

## 4. Was Basel erledigt (kann ich nicht — Login/Konsole)
- [ ] `gam oauth create` (Abschnitt 0)
- [ ] Admin-Konsole: org-weiten Footer einfügen (Abschnitt 2)
- [ ] Echte **Telefonnummer** + **USt-IdNr.** liefern (in der Signatur stehen Platzhalter)
