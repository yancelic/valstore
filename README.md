# ValStore 🎮

Kişisel Valorant günlük mağaza görüntüleyici. Telefonuna PWA olarak kurulabilir, arkadaşlarınla paylaşabilirsin.

## Özellikler

- 🔒 Davet kodu sistemi — sadece istediğin kişiler erişebilir
- 📱 PWA — telefona "Ana Ekrana Ekle" ile native uygulama gibi çalışır
- 🔑 2FA / MFA desteği
- ⏱️ Yenileme geri sayımı
- 🎨 Tier renkleri (Select, Deluxe, Premium, Ultra, Exclusive)
- 💰 VP fiyatları
- 🔄 Otomatik token yenileme

---

## Kurulum & Deploy (Render.com)

### 1. GitHub'a Yükle

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/KULLANICI/valstore.git
git push -u origin main
```

### 2. Render'a Deploy Et

1. [render.com](https://render.com) → New → Web Service
2. GitHub repo'nu bağla
3. Otomatik olarak `render.yaml` okunur
4. **Environment Variables** kısmında şunları ayarla:

| Key | Value |
|-----|-------|
| `INVITE_CODE` | Arkadaşlarına atacağın gizli kod (örn: `discord2025`) |
| `SESSION_SECRET` | Render tarafından otomatik oluşturulur |

5. **Deploy** → Birkaç dakika sonra `https://valstore.onrender.com` aktif

### 3. Arkadaşlarına Paylaş

Linki ve davet kodunu WhatsApp/Discord'dan at. İlk açılış ~30 saniye sürebilir (ücretsiz tier uyku modundan uyanır). 

**Opsiyonel:** Uyku modunu engellemek için [UptimeRobot](https://uptimerobot.com) ücretsiz ping servisi ile her 14 dakikada bir ping at.

---

## Lokal Geliştirme

```bash
# Bağımlılıkları yükle
npm install

# .env dosyası oluştur
cp .env.example .env
# .env'i düzenle: INVITE_CODE ve SESSION_SECRET'i ayarla

# Geliştirme sunucusu
npm run dev

# → http://localhost:3000
```

---

## Güvenlik

- **Şifren yalnızca Riot sunucularına gönderilir** ve hiçbir yerde saklanmaz
- Sadece `ssid` session cookie'si şifreli olarak tutulur (token yenileme için)
- Tüm trafik HTTPS (Render otomatik sertifika sağlar)
- Rate limiting: 8 login denemesi / 15 dakika
- Session ömrü: 7 gün (ssid geçerli olduğu sürece arka planda yenilenir)

## Teknik Notlar

- **Resmi olmayan API**: Valorant'ın kendi client'ının kullandığı iç endpoint'ler kullanılır
- Sadece okuma (GET) işlemleri yapılır — hesabınıza dokunulmaz
- Skin verileri [valorant-api.com](https://valorant-api.com) üzerinden çekilir (genel, kimlik gerektirmeyen)
- Render ücretsiz tier sunucu yeniden başlatmalarında sessionlar sıfırlanır (kullanıcıların tekrar giriş yapması gerekir)
