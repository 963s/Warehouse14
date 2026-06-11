# 🏪 warehouse14 Online-Shop — نسخة التطوير المستقلة

نسخة كاملة ومستقلة من المتجر الإلكتروني (Next.js 14). طوّرها بحرّية —
لا علاقة لها بالمستودع الرئيسي ولا بالسيرفر؛ أي تعديل هنا لا يلمس شيئاً حيّاً.

## التشغيل (مرة واحدة ثم يومياً)

```bash
cd ~/Desktop/warehouse14-onlineshop
npm install        # أول مرة فقط (~دقيقتان)
npm run dev        # ثم افتح: http://localhost:4311
```

## أوضاع البيانات (ملف `.env.local`)

| الوضع | كيف | متى |
|---|---|---|
| **تجريبي (الافتراضي)** | `NEXT_PUBLIC_DATA_SOURCE=placeholder` | تطوير الواجهة بلا أي باك-إند — يعمل فوراً |
| **حيّ محلي** | `NEXT_PUBLIC_DATA_SOURCE=live` + `NEXT_PUBLIC_API_URL=http://localhost:3001` | عندما يعمل api المحلي على 3001 |

⚠️ **ممنوع** توجيه هذه النسخة إلى الإنتاج (`api.warehouse14.de`).

## أين الأشياء

- `src/app/` — الصفحات (الرئيسية، `/kollektion`، `/termin`، `/artikel/[slug]`…)
- `src/components/` — المكوّنات (hero، البطاقات، أقسام الحركة…)
- `src/lib/storefront-data.ts` — طبقة البيانات الوحيدة (placeholder ↔ live)
- `src/app/globals.css` + `tailwind.config.ts` — الثيم والألوان والحركة
- `Dockerfile` + `docker-compose.storefront.yml` — النشر على السيرفر

## النشر على السيرفر (عند الرضا عن نسختك)

أرسل لي "انشر نسخة سطح المكتب" وأتولّى البناء والنقل والنشر على نفس الرابط —
أو يدوياً: `docker buildx build --platform linux/arm64 -t ghcr.io/963s/warehouse14-storefront:latest --load .`
ثم النقل والتشغيل حسب `docs` المستودع الرئيسي.

> أصل هذه النسخة: فرع `claude/storefront-live-wiring` بتاريخ 2026-06-11
> (آخر commit مصدر: 96af46b). جذر git جديد ومستقل أُنشئ هنا.
