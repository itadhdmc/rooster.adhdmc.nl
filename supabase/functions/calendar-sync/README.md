# Edge Function: `calendar-sync`

Automatische, server-side synchronisatie van de planning met Google Agenda.
Maakt het agenda-item aan zodra een dienst wordt goedgekeurd en verwijdert het
weer bij verwijderen/afkeuren — **ook als de student de app niet open heeft**.

## Hoe het werkt

```
admin keurt dienst goed
   → assignments-rij wijzigt (status='approved')
      → Database Webhook POST → deze Edge Function
         → haalt verse access-token op via opgeslagen refresh-token
            → maakt/verwijdert event in Google Agenda
               → schrijft google_calendar_event_id terug
```

## Eenmalige setup

### 1. Vereiste migraties
Pas `0006_google_tokens.sql` toe (tabel voor de refresh-tokens).

### 2. Google OAuth-client
Gebruik **dezelfde** OAuth-client als de login. `client_secret` is nodig voor
de server-side token-refresh. De login vraagt al om offline toegang
(`access_type=offline`, `prompt=consent` in `src/lib/auth.ts`), dus Google
geeft een refresh-token af.

> ⚠️ **Belangrijk:** de scope `calendar.events` is een *sensitive scope*. Voor
> productiegebruik buiten je eigen Workspace-domein eist Google een
> app-verificatie. Binnen `adhdmc.nl` (interne app) is dit meestal geen
> probleem — controleer de OAuth consent screen-instellingen.

### 3. Secrets zetten
```bash
supabase secrets set GOOGLE_CLIENT_ID=...     --project-ref <ref>
supabase secrets set GOOGLE_CLIENT_SECRET=... --project-ref <ref>
# Gedeeld geheim om de webhook-endpoint af te schermen (verzin een lange
# willekeurige string, bijv. via: openssl rand -hex 32):
supabase secrets set WEBHOOK_SECRET=...       --project-ref <ref>
# SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn automatisch beschikbaar.
```

### 4. Functie deployen
```bash
supabase functions deploy calendar-sync --project-ref <ref>
```

### 5. Database Webhook koppelen
Supabase Dashboard → **Database → Webhooks → Create a new hook**:
- Table: `assignments`
- Events: `Insert`, `Update`, `Delete`
- Type: **Supabase Edge Functions** → `calendar-sync`
- HTTP Headers: voeg `x-webhook-secret` toe met dezelfde waarde als de
  `WEBHOOK_SECRET` secret. De functie weigert dan alle aanroepen zonder
  dit geheim. (Zonder ingestelde `WEBHOOK_SECRET` accepteert de functie
  alles — alleen voor de overgangsfase.)

## Testen
1. Log één keer in als student (zodat de refresh-token wordt opgeslagen in
   `google_tokens`).
2. Keur als admin een dienst goed.
3. Controleer de functie-logs (`supabase functions logs calendar-sync`) en de
   Google Agenda van de student.
4. Keur een **ruil** goed (`execute_shift_swap`) en controleer dat de afspraak
   in beide agenda's naar de nieuwe datum schuift.
5. Verwijder een goedgekeurde toewijzing en controleer dat de afspraak
   verdwijnt.

## Uitrollen op een bestaande omgeving

Zolang deze functie **niet** draait, wordt de agenda alleen bijgewerkt in de
browser van de medewerker zelf (zie hieronder). Een ruil, afmelding of
roosterwijziging die de admin doorvoert, komt dan pas in de agenda zodra die
medewerker Mijn rooster opent. Wie dat niet doet, houdt de oude afspraak
inclusief de herinnering die wij zelf instellen (mail 24 uur vooraf) — en komt
dus opdagen voor een dienst die hij heeft weggeruild.

Volgorde bij het aanzetten:

1. Migratie `0006_google_tokens.sql` toegepast? (Zie stap 1 hierboven.)
2. Secrets zetten (stap 3) — begin met `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET` en `WEBHOOK_SECRET`.
3. Functie deployen (stap 4).
4. Database Webhook aanmaken (stap 5) — mét de `x-webhook-secret` header.
5. **Iedereen één keer opnieuw laten inloggen.** De refresh-token wordt alleen
   opgeslagen bij een verse consent-login (`AuthCallback.tsx` schrijft
   `provider_refresh_token` naar `google_tokens`). Wie een lopende sessie heeft,
   staat nog niet in die tabel en wordt door de functie overgeslagen met
   `skipped: no google token for user`. Uitloggen + opnieuw inloggen volstaat.
6. Controleer na een dag in de logs of er nog `skipped: no google token for
   user` voorbijkomt; die mensen moeten nog opnieuw inloggen.

Controleren wie er al klaar voor is:

```sql
SELECT p.full_name, p.email, (g.user_id IS NOT NULL) AS heeft_refresh_token
FROM profiles p
LEFT JOIN google_tokens g ON g.user_id = p.id
WHERE p.active
ORDER BY heeft_refresh_token, p.full_name;
```

## Verhouding tot de client-side sync

`src/pages/MijnRooster.tsx` legt bij élke keer laden de agenda van deze en
volgende maand gelijk aan het rooster (`reconcileEvents` in
`src/lib/calendar.ts`): afspraken van diensten die je niet meer hebt gaan weg,
geruilde diensten schuiven naar de juiste dag, ontbrekende diensten komen erbij.
Omdat het agenda-id vast is per toewijzing (`adhdmc<assignment-uuid>`) botsen
client en Edge Function niet: beide schrijven naar hetzelfde item.

Die client-sync blijft nodig als vangnet — hij werkt ook voor mensen zonder
opgeslagen refresh-token — maar hij draait alleen als de medewerker de app
opent. Alleen de Edge Function werkt zonder dat iemand inlogt.

## Nog te doen / aandachtspunten
- **Tijdwijziging van een dienst** wordt nog niet doorgevoerd in bestaande
  events (alleen aanmaken/verwijderen en afwijkende werktijden). Eventueel een
  webhook op `shifts` toevoegen die de bijbehorende events update. De
  client-side reconcile vangt dit wél op.
- ~~**Ruil goedgekeurd** (`execute_shift_swap`)~~ ✅ Dekt de functie: de RPC zet
  `google_calendar_event_id` op NULL, de webhook vuurt, en omdat het agenda-id
  vast is geeft Google 409 op het opnieuw aanmaken waarna het item wordt
  bijgewerkt naar de nieuwe datum.
- ~~Beveilig de webhook-endpoint met een gedeeld geheim.~~ ✅ Gedaan: zet
  `WEBHOOK_SECRET` en de bijbehorende `x-webhook-secret` header (zie boven).
