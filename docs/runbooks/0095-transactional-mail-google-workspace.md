# Runbook 0095 — turn on transactional mail via Google Workspace

**Status: waiting on Basel.** Everything on the software side is built, deployed and
verified. What is missing is a credential that only a Workspace administrator can
create, so this runbook is the handover.

## Why it is off right now

`SMTP_HOST` is unset on the worker, so `email-outbox-sender` logs its unconfigured
state and leaves every letter `PENDING`. Check the damage at any time:

```sql
SELECT status, count(*), min(created_at) AS oldest FROM email_outbox GROUP BY status;
```

As of 2026-07-22 that is **10 rows, all PENDING, zero SENT**, the oldest from
2026-07-20. Welcome letters and reservation confirmations, including the whole
thirteen language system, are queued and unread.

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

## What Basel does, once

**A. Create the mailbox** (Admin console → Directory → Users), or an alias on an
existing user: `bestellung@warehouse14.de`. It must be able to RECEIVE, because
customers will reply to it. That was a deliberate decision over `noreply@`: someone
holding a three day reservation will ask whether they can collect on Saturday, and
that question has to reach a person.

**B. Enable the relay** (Admin console → Apps → Google Workspace → Gmail → Routing
→ **SMTP relay service** → Configure):

- Name: `warehouse14 transactional`
- Allowed senders: **Only addresses in my domains**
- Authentication: tick **Only accept mail from the specified IP addresses** and add
  `79.76.116.239`, and also tick **Require SMTP Authentication**. Belt and braces:
  the IP allowlist stops anyone else using the relay, the auth stops a spoofed
  source on the same network.
- Encryption: **Require TLS**

**C. Create the credential** for the sending account: enable 2 step verification on
it, then Google Account → Security → App passwords → generate one. Note it once,
Google will not show it again.

**D. Hand over four values** (never paste them into chat, put them in the server
`.env` directly or send them the way you normally handle secrets):

```
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_USER=bestellung@warehouse14.de
SMTP_PASS=<the app password, no spaces>
MAIL_FROM=Warehouse 14 <bestellung@warehouse14.de>
MAIL_REPLY_TO=bestellung@warehouse14.de
```

Port 587 means STARTTLS; the mailer only switches to implicit TLS at 465, so do not
change the port without changing that expectation.

## Applying it

```bash
ssh myserver
sudo nano /opt/warehouse14/.env          # add the six lines above
cd /opt/warehouse14
sudo docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate worker
```

## Verifying it actually sends

The queue is the test. Within one worker tick the ten stuck letters should move:

```bash
ssh myserver "sudo docker exec -i warehouse14-postgres psql -U warehouse14 -d warehouse14 \
  -c \"SELECT status, count(*) FROM email_outbox GROUP BY status;\""
ssh myserver "sudo docker logs warehouse14-worker --since 5m 2>&1 | grep -i 'email outbox'"
```

`SENT` climbing and `PENDING` falling is the proof. If a letter goes `FAILED`, the
reason is in `email_outbox.last_error`, which is the first place to look:

```sql
SELECT template, attempts, last_error FROM email_outbox WHERE status = 'FAILED';
```

Then send one real reservation from the shop app to a private address and read the
letter as a customer would: correct language, correct pickup date, the opening hours
in the signature, and a reply that lands in the Workspace inbox.

## After it works

Move DMARC from `p=none` to `p=quarantine` once the reports at
`admin@warehouse14.de` show clean alignment for a week or two. Do not skip the
observation window: enforcing early can silently bin legitimate mail.
