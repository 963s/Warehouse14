# Runbook 0095 — transactional mail via Google Workspace

**Status: LIVE since 2026-07-22, 23:50.** The relay is configured, the worker is
sending, and the ten letters that had been stuck since 2026-07-20 went out in a
single tick: `{"sent":10,"failed":0}`. No password is stored anywhere, and none
can be: Google has disabled app passwords for this tenant, so the authorisation
is this server's IP address.

Keep the rest of this document. It is the record of how the relay was set up and
the first place to look if mail ever stops.

## Checking it is still healthy

```sql
SELECT status, count(*), min(created_at) AS oldest FROM email_outbox GROUP BY status;
```

`PENDING` should be empty or near it. A `PENDING` row older than a couple of
minutes means the worker is not sending, and the reason is almost always that
`SMTP_HOST` is missing from its environment — see "If it stops" at the end.

## Why the relay, and not sending straight from the server

The DNS for `warehouse14.de` is already correct and it decides the architecture:

| record | value |
|---|---|
| MX | `smtp.google.com` |
| SPF | `v=spf1 include:_spf.google.com ~all` |
| DKIM | `google._domainkey` published |
| DMARC | `p=none; rua=mailto:admin@warehouse14.de; fo=1` |

SPF authorises **Google and nobody else**. Mail sent directly from the Oracle host
(`79.76.116.239`) would fail SPF, and with DKIM absent on that path it would fail
DMARC alignment too. Result: the spam folder. Relaying through Google keeps both
SPF and DKIM aligned with no extra DNS work.

`smtp-relay.gmail.com` is the endpoint built for exactly this. It can send as any
address in the domain without occupying a paid seat, allows roughly 10,000 messages
a day, and is not tied to one person's password.

## App passwords are NOT an option here, proven 2026-07-22

Do not try them, and do not let anyone else try them. Three attempts against
`admin@warehouse14.de` returned `5.7.8 Username and Password not accepted`, and
the App passwords page itself answers:

> Die gesuchte Einstellung ist für Ihr Konto nicht verfügbar.

That is Google saying the feature is switched off for this account. Google has
been disabling app passwords by default across Workspace tenants, so this is
policy and not a misconfiguration you can talk your way around. The relay below
is the only path.

Note also what the relay told us before it was configured, which is useful:

```
550 5.7.0 Mail relay denied [79.76.116.239].
Invalid credentials for relay for one of the domains in: warehouse14.de
```

Google names `warehouse14.de`, so the Workspace tenant is real and healthy. The
only missing thing is authorising this server's IP.

## The settings that were applied (done, 2026-07-22)

**A. The mailbox** (Admin console → Directory → Users), or an alias on an
existing user: `bestellung@warehouse14.de`. It must be able to RECEIVE, because
customers will reply to it. That was a deliberate decision over `noreply@`: someone
holding a three day reservation will ask whether they can collect on Saturday, and
that question has to reach a person.

**B. The relay** (Admin console → Apps → Google Workspace → Gmail → Routing
→ **SMTP relay service** → Configure):

- Name: `warehouse14 transactional`
- Allowed senders: **Only addresses in my domains**
- Authentication: tick **Only accept mail from the specified IP addresses** and add
  `79.76.116.239`. **Leave "Require SMTP Authentication" UNTICKED.** Ticking it
  demands exactly the app password Google refuses to issue for this tenant, which
  would put you straight back where you started. The IP allowlist is the
  authorisation, and only this server holds that address.
- Encryption: **Require TLS**

**C. No credential at all.** With IP authorisation there is no password to
create, store or rotate. `SMTP_USER` and `SMTP_PASS` stay empty on purpose. The
mailer was changed on 2026-07-22 to make them optional precisely so this path
works; before that it demanded them and would have refused to send.

## Applying it

Run the script. It TESTS whether Google accepts this server before it writes
anything, so a relay that has not propagated yet fails in your terminal rather
than silently three minutes later:

```bash
sudo /opt/warehouse14/relay-setup.sh bestellung@warehouse14.de
```

Google can take from a few minutes up to about an hour to apply the relay
setting. If the script says the relay refused, wait and run it again.

## Applying it by hand, if you prefer

```bash
sudo nano /opt/warehouse14/.env
```

```
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=Warehouse 14 <bestellung@warehouse14.de>
MAIL_REPLY_TO=bestellung@warehouse14.de
```

`SMTP_USER` and `SMTP_PASS` are empty ON PURPOSE. Then:

```bash
cd /opt/warehouse14
sudo docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate worker
```

## If it stops

The queue is the test, always:

```bash
ssh myserver "sudo docker exec -i warehouse14-postgres psql -U warehouse14 -d warehouse14 \
  -c \"SELECT status, count(*) FROM email_outbox GROUP BY status;\""
ssh myserver "sudo docker logs warehouse14-worker --since 5m 2>&1 | grep -i outbox"
```

A healthy tick logs `{"sent":0}`. If letters are stacking up in `PENDING`, work
down this list:

1. **Is `SMTP_HOST` actually in the worker's environment?**
   `ssh myserver "sudo docker exec warehouse14-worker printenv SMTP_HOST"`.
   Empty means the container is running without the config even though
   `/opt/warehouse14/.env` has it — that is a restart that did not happen, not a
   mail problem. **A restart MUST pass the running image tag**, because compose
   otherwise falls back to `:latest`, which exists in no registry, and dies with
   `manifest unknown` while the old container keeps running:
   ```bash
   ssh myserver "cd /opt/warehouse14 && sudo IMAGE_TAG=\$(sudo docker ps --format '{{.Image}}' | grep warehouse14-worker | sed 's/.*://') docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate worker"
   ```
   This exact trap cost an hour on 2026-07-22 and is now handled inside
   `relay-setup.sh`.
2. **Did Google refuse?** `email_outbox.last_error` carries its answer verbatim:
   ```sql
   SELECT template, attempts, last_error FROM email_outbox WHERE status = 'FAILED';
   ```
   `Mail relay denied` means the server's IP is no longer on the allowlist — check
   whether the Oracle host's address changed and update the relay setting.

## Still open

- **Read one real letter.** Send a reservation from the shop app to a private
  address and check it as a customer would: right language, right pickup date,
  opening hours in the signature, and a reply that lands in the Workspace inbox.
  Nothing verifies rendering except a human reading it.
- **Tighten DMARC.** Move from `p=none` to `p=quarantine` once the reports at
  `admin@warehouse14.de` show clean alignment for a week or two. Do not skip the
  observation window: enforcing early can silently bin legitimate mail.
