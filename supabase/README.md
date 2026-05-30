# Supabase — database in versiebeheer

De live Supabase-database is lange tijd de enige bron van waarheid geweest.
Deze map zet de database terug in git, zodat hij reproduceerbaar is.

## Mappen

- `migrations/` — de schema-geschiedenis, op volgorde van nummer.

## Status van de reconstructie

| Migratie | Inhoud | Betrouwbaarheid |
|----------|--------|-----------------|
| `0001_initial_schema.sql` | Oorspronkelijke tabellen, RLS, trigger, views | ✅ exacte kopie van origineel |
| `0002_assignments_status.sql` | `status`-kolom op `assignments` | 🟡 afgeleid uit code |
| `0003_notifications.sql` | `notifications`-tabel + RLS | 🟡 afgeleid uit code |
| `0004_shift_swaps.sql` | `shift_swaps`-tabel + RLS | 🟡 afgeleid uit code |
| `0005_TODO_dump_from_live.sql` | RPC's, `pending_students`, bijgewerkte view | ❌ **moet uit live-DB gedumpt** |

🟡 = gereconstrueerd uit hoe de frontend de tabel gebruikt. Kolommen en
policies kunnen in details afwijken van de live-database — **verifieer ze**.

## ⚠️ Belangrijk

Voer deze migraties **niet blind** uit op de live-database: die bevat de
objecten al. Ze zijn bedoeld om:

1. de database vanaf nul opnieuw op te bouwen (test/staging), en
2. wijzigingen voortaan via git te laten lopen.

## Wat jij nog moet doen

1. Dump de live-definities (zie de queries onderaan `0005_...sql`) en vul dat
   bestand. Verifieer meteen de 🟡-migraties tegen de live-DB.
2. Installeer de Supabase CLI om dit makkelijk te houden:
   `brew install supabase/tap/supabase`
3. Koppel het project: `supabase link --project-ref <ref>` en voortaan
   `supabase db diff` / `supabase migration new <naam>` voor wijzigingen.
