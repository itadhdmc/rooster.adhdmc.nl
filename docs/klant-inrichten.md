# Klantomgeving inrichten (model A: één klant = één stack)

Dit is het technische draaiboek. Duur: grofweg een dag als DNS en Google
Workspace meewerken.

ADHDMC blijft een gewone klantomgeving (de eerste). Nieuwe klanten krijgen
dezelfde code, andere secrets.

---

## Architectuur per klant

```
Browser  →  Cloud86 (statische SPA, eigen subdomain)
                ↓  (VITE_SUPABASE_URL van DÉZE klant)
           Supabase-project (EU) — Postgres + Auth + RLS
                ↓
           Resend (mail vanaf hun domein)
           Google Cloud OAuth (hun Workspace, interne app)
```

Geen gedeelde database. Geen `org_id`. Isolatie = aparte projecten.

---

## 0. Blokkers voordat je klant 2 aanmaakt

Deze drie dingen falen nu op een verse installatie. Eerst fixen in de code
(zie “Technische restpunten” onderaan), daarna pas live gaan.

1. **Migraties moeten groen zijn op een leeg project.** `supabase/README.md`
   zegt dat 0002–0005 deels gereconstrueerd zijn. Zonder een geslaagde
   `supabase db push` op een throwaway-project kun je geen klant uitrollen.
2. **`app_settings` default naar ADHDMC.** `handle_new_user` weigert alles
   behalve `@adhdmc.nl` totdat die rij is aangepast. Dat moet in de
   inricht-SQL *vóór* de eerste login.
3. **CI deployt maar één frontend.** `.github/workflows/deploy.yml` heeft
   één set secrets en `VITE_ALLOWED_DOMAIN: adhdmc.nl`. Push naar `main`
   overschrijft anders de verkeerde site, of bakte het verkeerde domein in.

---

## 1. Checklist per nieuwe klant

Kopieer dit blok per klant (intern, niet naar de klant sturen).

```
Klant:                 _______________
Domein:                _______________     (bijv. zorgvoorbeeld.nl)
Portal-URL:            https://rooster._______________
Supabase ref:          _______________     (EU-regio: ________)
Supabase URL:          https://____.supabase.co
Google Cloud project:  _______________
OAuth Client ID:       _______________
Resend-domein:         _______________     (geverifieerd: ja/nee)
Cloud86 subdomain:     _______________
FTP-pad:               _______________
Eerste admin:          _______________
Logo ontvangen:        ja/nee
Huisstijl ingesteld:   ja/nee
VWO getekend:          ja/nee
```

---

## 2. Stappen (volgorde aanhouden)

### A. Supabase

1. Nieuw project, regio **West EU (Frankfurt)** of **North EU (Ierland)**.
2. Noteer Project URL, anon key, service role (service role nooit in de frontend).
3. Auth → Google: Client ID + Secret van stap B.
4. Auth → URL config:
   - Site URL = portal-URL
   - Redirect: `https://<portal>/auth/callback`
   - én `https://<project-ref>.supabase.co/auth/v1/callback` in Google
5. Database-webhooks later (alleen als je calendar-sync aanzet).

Migraties:

```bash
supabase link --project-ref <ref>
supabase db push
```

Daarna meteen instellingen + Resend-key (anders kan niemand inloggen):

```sql
UPDATE app_settings SET
  org_name       = 'Klantnaam',
  portal_url     = 'https://rooster.klant.nl',
  allowed_domain = 'klant.nl',
  support_email  = 'ict@klant.nl',
  mail_from_name = 'Klantnaam Rooster',
  mail_from_email = 'rooster@klant.nl'
WHERE id = 1;

INSERT INTO app_config (key, value)
VALUES ('resend_api_key', 're_...')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### B. Google Cloud (in de Workspace van de klant)

Maak het OAuth-project **bij hen**, type Internal. Dan is geen Google
app-verificatie nodig (die is wél verplicht als jij één externe app voor
alle klanten gebruikt — `calendar.events` is een sensitive scope).

1. APIs: Calendar API aanzetten.
2. OAuth consent: Internal, scopes `openid email profile calendar.events`.
3. Web client: redirect URI van Supabase Auth.
4. Client ID + Secret naar Supabase Auth én (bij calendar-sync) naar
   `supabase secrets`.

Zonder hun Workspace-admin kom je hier niet doorheen. Zet dat in de offerte
als verplichting van de klant.

### C. Resend

1. Domein van de klant verifiëren (DNS: SPF/DKIM).
2. API-key in `app_config` (zie SQL hierboven).
3. `mail_from_email` moet op dat domein liggen.

### D. Frontend

1. Subdomain + SSL op Cloud86 (of hun hoster).
2. `public/logo.png` + `public/logo.svg` van de klant in de build (of later
   upload via storage — staat nog niet in de app).
3. Build met **hun** env:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_ALLOWED_DOMAIN=klant.nl
```

4. FTP naar hun `httpdocs`. `.htaccess` gaat mee uit `public/`.

### E. Eerste admin

1. Beheerder logt één keer in (account moet `@allowed_domain` zijn).
2. Jij in SQL:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'beheerder@klant.nl';
```

3. Zij vullen Instellingen verder aan (kleuren, diensten, toeslagdagen).

### F. CI (niet vergeten)

Per klant een GitHub Environment (`adhdmc`, `klant-x`) met eigen secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ALLOWED_DOMAIN`
- `FTP_SERVER` / `FTP_USERNAME` / `FTP_PASSWORD` / `FTP_PATH`

De workflow moet `VITE_ALLOWED_DOMAIN` uit secrets halen, niet hardcoden.
Deploy naar klant-X alleen via `environment: klant-x` (manual dispatch of
matrix). Nooit één job die alle FTP-doelen met dezelfde build vult.

---

## 3. Wat je níét per klant hoeft te bouwen

- Geen multi-tenant schema.
- Geen Stripe.
- Geen self-serve signup.
- Microsoft-login alleen als die klant het als dealbreaker heeft — dan is
  het een aparte offerte-regel, geen voorwaarde voor model A.

---

## 4. Technische restpunten in de code

Moet vóór of bij de eerste externe klant:

| Punt | Waarom | Waar |
|------|--------|------|
| Migraties op leeg project verifiëren | Anders geen tweede database | `supabase/migrations/`, `supabase/README.md` |
| Provisioning-SQL / seed i.p.v. ADHDMC-defaults | Eerste login faalt anders | `0022_app_settings.sql` |
| CI: environment per klant, domain uit secrets | Voorkomt verkeerde deploy | `deploy.yml` |
| Paginatitel + favicon uit instellingen | Tabblad toont nu “ADHDMC Rooster” | `index.html`, `useSettings` |
| ErrorBoundary: `support_email` | Nu hardcoded ictservicedesk@adhdmc.nl | `ErrorBoundary.tsx` |
| `calendar-sync` leest `calendar_label` | Edge function heeft nog vaste ADHDMC-titels | `supabase/functions/calendar-sync/index.ts` |
| Logo in de deploy van die klant | Bestanden staan niet in git | `public/logo.png` |
| `SETUP.md` herschrijven naar migraties | Die gids wijst nog naar `supabase_schema.sql` | `SETUP.md` |

Mag later (niet nodig om A waar te maken):

- Logo-upload in Instellingen
- Uitnodigingsmail bij `pending_students`
- Aanpasbare mailsjablonen
- Extra diensttypes
- Microsoft SSO
- Event-id prefix `adhdmc` in `calendar.ts` (alleen branding in hun agenda;
  functioneel oké per geïsoleerde Workspace)

---

## 5. Acceptatietest (15 min, per nieuwe omgeving)

1. Log in met een tweede (medewerker-)account → domeincheck en profiel.
2. Maak een periode aan → capaciteit per weekdag klopt met de instellingen.
3. Meld aan (bulk), keur goed → melding + e-mail komen aan (afzender klopt).
4. Reservelijst: plaats, promoveer, verwijder → drie mails.
5. Werktijd-preset (vroeg/laat) → zichtbaar in Mijn rooster + agenda-sync.
6. Urenexport (overzicht + detail) → kolommen en pauzeregel kloppen.
7. Logboek: alle bovenstaande acties zijn terug te zien.

## 6. Functionele beperkingen om in de verkoop te benoemen

- **Twee dagdelen** per dag (namen/tijden vrij instelbaar, aantal niet).
- Kalenders tonen **ma–za**; zondag als roosterdag werkt in lijstweergaves,
  maar niet in de weektabellen.
- **Teksten** van meldingen/e-mails zijn Nederlands en niet per klant
  aanpasbaar (afzender en links wél).
