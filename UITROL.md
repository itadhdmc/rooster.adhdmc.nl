# Uitrol-draaiboek: nieuwe klantomgeving

Dit draaiboek zet een **eigen, losse omgeving** op voor een nieuwe
organisatie (white-label, "route A"): eigen database, eigen domein, eigen
huisstijl. Reken op 2–4 uur voor een complete omgeving.

> Voorwaarde: de klant gebruikt **Google Workspace** met een eigen
> e-maildomein (inloggen gaat via Google en het domein wordt server-side
> afgedwongen).

## 1. Supabase-project

1. Maak op [supabase.com](https://supabase.com) een nieuw project aan
   (regio: **West-Europa**, i.v.m. AVG).
2. Voer in de **SQL-editor** alle migraties uit, in volgorde:
   `supabase/migrations/0001…` t/m de hoogste (momenteel `0025`).
   Elke migratie is idempotent opgezet; opnieuw draaien kan geen kwaad.
3. Controleer daarna in Table Editor dat o.a. `profiles`, `shifts`,
   `assignments`, `notifications`, `audit_log` en `app_settings` bestaan
   en dat `app_settings` één rij heeft (id = 1).

## 2. Google-login (OAuth)

1. Maak in Google Cloud Console een **OAuth client** aan voor de klant
   (of gebruik één centrale client met meerdere redirect-URI's).
2. Scopes: `openid email profile` + `https://www.googleapis.com/auth/calendar.events`
   (voor de agenda-synchronisatie).
3. Zet in Supabase → Authentication → Providers → Google de client-id en
   secret; voeg de redirect-URL van Supabase toe in Google Cloud.
4. Site-URL en redirect-URL's in Supabase → Authentication → URL
   Configuration: `https://rooster.<klantdomein>` (+ `/auth/callback`).

## 3. E-mail (Resend)

1. Maak een Resend-account (of voeg een domein toe aan het bestaande):
   verifieer het **afzenderdomein** van de klant (SPF/DKIM).
2. Zet de API-key in de database:
   `INSERT INTO app_config (key, value) VALUES ('resend_api_key', '<key>');`
3. De afzendernaam en het afzenderadres stelt de beheerder later in via
   **Instellingen → E-mail**.

## 4. Agenda-webhook (edge function)

1. Deploy `supabase/functions/calendar-sync` naar het nieuwe project
   (`supabase functions deploy calendar-sync`).
2. Maak de Database Webhook op `assignments` (INSERT/UPDATE/DELETE) met de
   `x-webhook-secret`-header — zie `supabase/functions/calendar-sync/README.md`.

## 5. Frontend + hosting

1. Zet de omgeving-variabelen voor de build:
   - `VITE_SUPABASE_URL` — project-URL van stap 1
   - `VITE_SUPABASE_ANON_KEY` — anon key van stap 1
   - `VITE_ALLOWED_DOMAIN` — e-maildomein van de klant (fallback; de
     echte afdwinging staat in de database)
2. Vervang `public/logo.png` door het logo van de klant.
3. Host de `dist/`-map (elke statische hosting werkt; ADHDMC gebruikt
   Plesk + GitHub Actions met FTP-secrets `FTP_SERVER/USERNAME/PASSWORD/PATH`).
4. Richt het domein in: `rooster.<klantdomein>` → hosting, met TLS.

## 6. Instellingen invullen (in de app)

Log in als de eerste gebruiker en promoveer die tot beheerder:

```sql
UPDATE profiles SET role = 'admin' WHERE email = '<beheerder>@<klantdomein>';
```

Loop daarna **Beheer → Instellingen** langs (de organisatie-status bovenin
laat zien wat er nog mist):

- **Algemeen**: organisatienaam, portal-URL, supportadres
- **Huisstijl**: kleuren + agenda-label (live preview)
- **Rooster**: roosterdagen, capaciteit per weekdag, maandlimiet-factor
- **Diensten**: namen en tijden van de dagdelen + vroeg/laat-varianten
- **Loon & uren**: toeslagdagen + naam, pauzeregel
- **E-mail**: afzendernaam en -adres (moet het geverifieerde Resend-domein zijn)
- **Beveiliging**: het toegestane e-maildomein

## 7. Acceptatietest (15 min)

1. Log in met een tweede (medewerker-)account → domeincheck en profiel.
2. Maak een periode aan → capaciteit per weekdag klopt met de instellingen.
3. Meld aan (bulk), keur goed → melding + e-mail komen aan (afzender klopt).
4. Reservelijst: plaats, promoveer, verwijder → drie mails.
5. Werktijd-preset (vroeg/laat) → zichtbaar in Mijn rooster + agenda-sync.
6. Urenexport (overzicht + detail) → kolommen en pauzeregel kloppen.
7. Logboek: alle bovenstaande acties zijn terug te zien.

## Bekende beperkingen (fase 3)

- **Twee dagdelen** per dag (namen/tijden vrij instelbaar, aantal niet).
- Kalenders tonen **ma–za** (zondag als roosterdag werkt in lijstweergaves,
  maar niet in de weektabellen).
- **Teksten** van meldingen/e-mails zijn Nederlands en niet per klant
  aanpasbaar (afzender en links wél).
- Elke klant = eigen Supabase-project + hosting (geen multi-tenant);
  migraties moeten per omgeving worden bijgehouden.
