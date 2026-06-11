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

## Verhouding tot de client-side sync
`src/pages/MijnRooster.tsx` synchroniseert nu nog client-side. Zodra deze
functie draait, mag die client-logica vereenvoudigd worden tot alleen een
weergave van de sync-status. Laat hem voorlopig staan als fallback voor
studenten die nog geen opgeslagen refresh-token hebben.

## Nog te doen / aandachtspunten
- **Tijdwijziging van een dienst** wordt nog niet doorgevoerd in bestaande
  events (alleen aanmaken/verwijderen). Eventueel een webhook op `shifts`
  toevoegen die de bijbehorende events update.
- **Ruil goedgekeurd** (`execute_shift_swap`): zorg dat die RPC de
  `assignments` zo wijzigt dat de webhook vuurt (oude event weg, nieuw erbij).
- ~~Beveilig de webhook-endpoint met een gedeeld geheim.~~ ✅ Gedaan: zet
  `WEBHOOK_SECRET` en de bijbehorende `x-webhook-secret` header (zie boven).
```
