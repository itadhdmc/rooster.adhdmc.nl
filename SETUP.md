# ADHDMC Rooster — Setup gids

## 1. Supabase project aanmaken

1. Ga naar [supabase.com](https://supabase.com) en maak een gratis account
2. Maak een nieuw project aan (naam: `adhdmc-rooster`)
3. Ga naar **SQL Editor** en voer het volledige bestand `supabase_schema.sql` uit
4. Ga naar **Authentication → Providers → Google** en schakel in:
   - Vul Client ID en Secret in (van Google Cloud Console — zie stap 2)
   - Zet "Authorized domains" op `adhdmc.nl`
5. Ga naar **Authentication → URL Configuration**:
   - Site URL: `https://rooster.adhdmc.nl`
   - Redirect URLs: `https://rooster.adhdmc.nl/auth/callback`

## 2. Google OAuth instellen

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com)
2. Maak een nieuw project of gebruik het bestaande ADHDMC project
3. Ga naar **APIs & Services → Credentials**
4. Maak een **OAuth 2.0 Client ID** aan (type: Web application)
5. Authorized redirect URIs: voeg toe:
   - `https://[jouw-project].supabase.co/auth/v1/callback`
6. Kopieer Client ID en Client Secret naar Supabase (stap 1)

## 3. Omgevingsvariabelen instellen

Kopieer `.env.example` naar `.env.local`:

```bash
cp .env.example .env.local
```

Vul in:
- `VITE_SUPABASE_URL`: te vinden in Supabase → Settings → API → Project URL
- `VITE_SUPABASE_ANON_KEY`: te vinden in Supabase → Settings → API → anon/public key

## 4. Jezelf admin maken

Na de eerste keer inloggen:
1. Ga naar Supabase → Table Editor → `profiles`
2. Zoek jouw rij (op email)
3. Verander `role` van `student` naar `admin`

Of via SQL Editor:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'm.bourass@adhdmc.nl';
```

## 5. GitHub repository aanmaken

```bash
git init
git add .
git commit -m "Initial commit: ADHDMC Rooster app"
git remote add origin https://github.com/JOUW-USERNAME/adhdmc-rooster.git
git push -u origin main
```

## 6. GitHub Secrets instellen voor automatische deploy

Ga naar je GitHub repo → Settings → Secrets → Actions en voeg toe:

| Secret | Waarde |
|--------|--------|
| `VITE_SUPABASE_URL` | Jouw Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Jouw Supabase anon key |
| `FTP_SERVER` | FTP server van Cloud86 (bijv. `ftp.adhdmc.nl`) |
| `FTP_USERNAME` | FTP gebruikersnaam van Cloud86 |
| `FTP_PASSWORD` | FTP wachtwoord van Cloud86 |
| `FTP_PATH` | Pad op server (bijv. `/rooster.adhdmc.nl/httpdocs/`) |

## 7. Subdomain aanmaken op Cloud86

1. Log in op Cloud86 (Plesk)
2. Klik **Subdomein toevoegen**
3. Naam: `rooster`
4. Documentroot: `/rooster.adhdmc.nl/httpdocs/`
5. Sla op

## 8. Lokaal ontwikkelen

```bash
npm install
npm run dev
```

De app draait dan op `http://localhost:5173`

## Werkstroom daarna

```bash
# Maak een wijziging
git add .
git commit -m "Beschrijving van de wijziging"
git push origin main
# → GitHub Actions bouwt automatisch en deployt naar rooster.adhdmc.nl
```
