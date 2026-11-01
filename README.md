# Çeviri V2

PDF ders sunularını ve notlarını, görselleri korunarak teknik ve sınav odaklı Türkçe (veya başka dilde) HTML/PDF notlarına çeviren uygulama. Cloudflare üzerinde çalışır: **ceviri.selcukdinc.dev**.

Eski Flask sürümünün (devloop.com.tr/sunu-cevir) mantığı korunmuştur: chapter adından hedef dosya adları, `slide-XX-fig-YY-aciklama.png` görsel adlandırma, iki aşamalı "ön tarama → HTML üretimi" ajan akışı ve HTML → A4 PDF üretimi.

## Roller

| | Misafir | Kullanıcı | Admin |
|---|---|---|---|
| Tarayıcıda PDF analizi, prompt + ajan dosyası + görsel ön analizi | ✓ | ✓ | ✓ |
| PDF yükleyip otomatik çeviri (kredi ile) | | ✓ | ✓ |
| Geçmiş, HTML önizleme, PDF/HTML indirme | | ✓ | ✓ |
| Kullanıcı yönetimi, kredi yükleme, sınırsız plan, ayarlar, kota izleme | | | ✓ |

- Misafir modunda PDF sunucuya hiç gönderilmez.
- Yeni hesaplar **0 kredi** ile açılır. `ADMIN_EMAILS` içindeki e-postayla kayıt olan hesap otomatik admin olur.

## Kredi sistemi

`kredi = iş başı sabit (2) + Σ sayfa ağırlığı`, yukarı yuvarlanır.

| Sayfa türü | Ağırlık |
|---|---|
| Metin sayfası | 1 |
| Görsel/diyagram içeren sayfa | 1,5 |
| Yoğun metinli sayfa (> 3000 karakter) | 2 |

Örnek: 1 sayfalık PDF = 3 kredi, 80 sayfalık yarısı görselli sunu = 102 kredi. Tüm değerler admin panelinden değiştirilebilir.

Akış: tahmin gösterilir → onayda kredi **rezerve** edilir → iş başarılıysa harcanır, başarısızsa iade edilir. Bakiye, `credit_ledger` tablosundaki hareketlerin toplamıdır; admin yüklemeleri not ve admin kimliğiyle kaydedilir.

**Sınırsız plan:** admin, isteğe bağlı bitiş tarihiyle atar. Kredi düşmez ama ücretsiz API kotalarını korumak için günlük sayfa tavanı uygulanır (varsayılan 300, kullanıcı bazında değiştirilebilir).

## Mimari

| Katman | Teknoloji |
|---|---|
| Uygulama | Tek Cloudflare Worker + Static Assets |
| API | Hono (`worker/`) |
| Arayüz | React 19 + Vite + Tailwind CSS 4 (`src/`), açık/koyu tema |
| Veritabanı | D1 (`migrations/`) |
| Dosyalar | R2 (`jobs/<id>/…`) |
| Uzun işler | Cloudflare Workflows (`worker/workflow/translate.ts`) |
| PDF analizi | PDF.js, tarayıcıda (sunucu CPU'su harcanmaz) |
| Çeviri | Gemini (PDF'i doğrudan okur) → Groq → Workers AI yedekleri |
| HTML → PDF | Cloudflare Browser Rendering (Puppeteer) |
| Kimlik | E-posta/şifre (PBKDF2), HttpOnly oturum çerezi; isteğe bağlı Turnstile |

### Çeviri hattı (Workflow adımları)

1. PDF Gemini Files API'ye yüklenir (anahtar yoksa atlanır).
2. **Ön tarama:** Gemini korunacak görselleri ve sayfa üzerindeki konumlarını (bbox) döndürür. Gemini yoksa tarayıcı analizindeki görselli sayfalar kullanılır.
3. Sayfalar 6'şar sayfalık gruplar halinde çevrilir; her grup ayrı, yeniden denenebilir bir adımdır. Bir sağlayıcı kota/hata verirse sıradakine geçilir.
4. Gruplar birleştirilir, HTML temizlenir, görseller tarayıcıda çizilen sayfa görüntülerinden CSS ile kırpılarak yerleştirilir (geniş/dikey/standart yerleşim).
5. Browser Rendering ile A4 PDF üretilir (başarısız olursa iş yine tamamlanır, kullanıcı tarayıcıdan yazdırabilir).
6. Kredi kesinleşir.

## Geliştirme

```bash
npm install
npm run db:migrate:local
npm run dev:local        # Cloudflare hesabı gerekmez, sahte çeviri sağlayıcısı (MOCK_AI=1)
npm test                 # birim testleri
npm run typecheck
```

Gerçek bağlarla (`AI`, `BROWSER`) geliştirmek için `npm run dev` (Cloudflare girişi gerekir) ve `.dev.vars.example` dosyasını `.dev.vars` olarak kopyalayın.

## İlk kurulum ve deploy

`selcukdinc.dev` zonunun bulunduğu Cloudflare hesabında:

```bash
npx wrangler login
npx wrangler d1 create ceviri            # çıkan database_id'yi wrangler.jsonc'ye yazın
npx wrangler r2 bucket create ceviri-files
npx wrangler d1 migrations apply ceviri --remote
npx wrangler secret put GEMINI_API_KEY   # https://aistudio.google.com/apikey
npx wrangler secret put GROQ_API_KEY     # isteğe bağlı, https://console.groq.com/keys
npm run deploy
```

`wrangler.jsonc` içindeki `routes` ayarı `ceviri.selcukdinc.dev` alt alan adını Worker'a otomatik bağlar. Ardından siteye `ADMIN_EMAILS` içindeki e-postayla kayıt olun.

İsteğe bağlı:
- **Turnstile** (kayıtta robot koruması): Cloudflare panelinden site oluşturun, `wrangler secret put TURNSTILE_SECRET` ve `wrangler secret put TURNSTILE_SITE_KEY`.
- **Workflows, Browser Rendering ve Workers AI** Free planda sınırlı kotalarla çalışır. Uzun PDF'lerde CPU süresi ve tarayıcı kotası için **Workers Paid ($5/ay)** önerilir.

### GitHub Actions ile otomatik deploy

`.github/workflows/deploy.yml` her PR'da tip kontrolü, test ve build çalıştırır. `main`'e her push'ta deploy etmesi için repo ayarlarında:

- Secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1, R2, Workers Routes düzenleme yetkili), `CLOUDFLARE_ACCOUNT_ID`
- Variables: `DEPLOY_ENABLED` = `true`

## Klasör yapısı

```
shared/      istemci ve sunucunun ortak kodu (kredi hesabı, prompt üretimi, tipler)
worker/      Hono API, oturum/RBAC, kredi defteri, çeviri sağlayıcıları, Workflow, PDF üretimi
src/         React arayüzü (misafir aracı, panel, iş detayı, admin)
migrations/  D1 şeması
tests/       birim testleri
```
