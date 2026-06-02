# 📘 ADHDMC Rooster — Volledige handleiding

Een compleet protocol, van begin tot eind, voor het gebruik van het
roostersysteem op **rooster.adhdmc.nl**. Deze handleiding is opgesplitst in
drie delen:

- **Deel A — Voor medewerkers (studenten):** inloggen, inschrijven, je rooster, ruilen.
- **Deel B — Voor beheerders (admins):** periodes, rooster, goedkeuren, uren exporteren.
- **Deel C — Technisch beheer & instellingen:** eenmalige instellingen en onderhoud.

> 💡 **Kernbegrippen in één zin:** een *periode* is een maand. In een periode
> staan *diensten* (ochtend/middag). Een medewerker *meldt zich aan* voor een
> dienst (status **aangemeld**), de admin *keurt goed* (status **ingeroosterd**).
> Alleen ingeroosterde diensten tellen als gewerkt.

---

## Inhoudsopgave

- [Deel A — Voor medewerkers](#deel-a--voor-medewerkers)
  - [A1. Inloggen](#a1-inloggen)
  - [A2. Het dashboard](#a2-het-dashboard)
  - [A3. Inschrijven voor diensten](#a3-inschrijven-voor-diensten)
  - [A4. Mijn rooster bekijken](#a4-mijn-rooster-bekijken)
  - [A5. Synchroniseren met Google Agenda](#a5-synchroniseren-met-google-agenda)
  - [A6. Diensten ruilen met een collega](#a6-diensten-ruilen-met-een-collega)
  - [A7. Inbox / meldingen](#a7-inbox--meldingen)
- [Deel B — Voor beheerders](#deel-b--voor-beheerders)
  - [B1. Het beheerpaneel](#b1-het-beheerpaneel)
  - [B2. Een nieuwe maand (periode) aanmaken](#b2-een-nieuwe-maand-periode-aanmaken)
  - [B3. Het rooster beheren](#b3-het-rooster-beheren)
  - [B4. Aanvragen goedkeuren of afwijzen](#b4-aanvragen-goedkeuren-of-afwijzen)
  - [B5. Zaterdagen toevoegen aan een bestaande maand](#b5-zaterdagen-toevoegen-aan-een-bestaande-maand)
  - [B6. De urenlimiet (16–64 uur per maand)](#b6-de-urenlimiet-1664-uur-per-maand)
  - [B7. Medewerkers beheren](#b7-medewerkers-beheren)
  - [B8. Ruilverzoeken definitief goedkeuren](#b8-ruilverzoeken-definitief-goedkeuren)
  - [B9. Uren exporteren voor de financiële administratie](#b9-uren-exporteren-voor-de-financiële-administratie)
  - [B10. Het rooster publiceren](#b10-het-rooster-publiceren)
- [Deel C — Technisch beheer](#deel-c--technisch-beheer)
- [Veelgestelde vragen & problemen](#veelgestelde-vragen--problemen)
- [De maandelijkse routine in het kort](#de-maandelijkse-routine-in-het-kort)

---

# Deel A — Voor medewerkers

## A1. Inloggen

1. Ga naar **https://rooster.adhdmc.nl**.
2. Klik op **Inloggen met Google**.
3. Kies (of log in op) je **@adhdmc.nl**-account.
4. De eerste keer vraagt Google toestemming voor je agenda — klik op **Toestaan**.
   Dit is nodig om je diensten later in je Google Agenda te kunnen zetten.

> ⚠️ Alleen e-mailadressen die eindigen op **@adhdmc.nl** kunnen inloggen.
> Een privé-Gmail werkt niet.

Na de eerste keer inloggen heb je standaard de rol **medewerker**. Wil je
beheerder worden? Dan moet een bestaande admin dat instellen (zie Deel C).

---

## A2. Het dashboard

Na inloggen kom je op het **Dashboard**. Hier zie je in één oogopslag:

- **Openstaande inschrijving** met eventuele **deadline** — tot wanneer je je
  kunt aanmelden.
- **Aankomende diensten** — je eerstvolgende goedgekeurde diensten.
- **Je uren** deze maand.

Bovenin staat de navigatiebalk met: **Dashboard · Inschrijven · Mijn rooster ·
Inbox** (en voor admins ook **Beheer**).

---

## A3. Inschrijven voor diensten

Dit doe je via **Inschrijven** in de menubalk.

1. Klik op **Inschrijven**.
2. Staat er meer dan één maand open? Kies dan rechtsboven de juiste **maand**.
   De kalender springt dan automatisch naar die maand (de maandnaam staat in
   het oranje label boven de week).
3. Je ziet een **weekrooster** van maandag t/m **zaterdag**, met per dag een
   **Ochtend**- en een **Middag**-rij.
4. Blader met **← Vorige** en **Volgende →** door de weken. Met **Terug naar
   \<maand\>** spring je terug naar het begin van de gekozen maand.
5. Klik bij een dienst op de oranje knop **Aanmelden** om je op te geven.
6. Bedacht je je? Klik op **Afmelden** zolang je aanvraag nog niet is
   goedgekeurd.

**Wat betekenen de kleuren / statussen?**

| Kleur / label | Betekenis |
|---------------|-----------|
| 🟢 groen "Aanmelden" | Plek vrij — je kunt je aanmelden |
| 🟠 amber "Afmelden" | Je hebt je aangemeld, wacht op goedkeuring |
| 🔵 indigo "Ingepland" | Goedgekeurd — je bent ingeroosterd |
| grijs "vol" | Alle plekken bezet |
| — | Geen dienst die dag |

> 💡 **Let op:** aanmelden is *nog geen* zekerheid. De beheerder moet je
> aanmelding eerst **goedkeuren**. Zaterdagdiensten hebben altijd maar **1
> plek**.

---

## A4. Mijn rooster bekijken

Via **Mijn rooster** zie je je **goedgekeurde** diensten.

1. Kies bovenin de **maand**.
2. Je ziet drie tellers: **Ingeroosterd** (aantal diensten), **Totaal uren** en
   **Wacht op goedkeuring**.
3. Daaronder staan je goedgekeurde diensten op datum, met tijd en aantal uren.
4. Diensten die nog niet zijn goedgekeurd staan apart onder **Wacht op
   goedkeuring**.

---

## A5. Synchroniseren met Google Agenda

Je diensten kunnen automatisch in je **Google Agenda** verschijnen.

- Zodra een dienst is goedgekeurd en je opent **Mijn rooster**, worden nieuwe
  diensten **automatisch** toegevoegd (je ziet kort "Synchroniseren met Google
  Agenda").
- Wil je het handmatig doen? Gebruik de knop **Alles synchroniseren**, of het
  agenda-icoontje bij een losse dienst.
- Een groen agenda-icoon betekent: deze dienst staat in je agenda. Klik er
  nogmaals op om hem er weer uit te halen.

Je krijgt automatisch een **herinnering**: een pop-up 1 uur van tevoren en een
e-mail 1 dag van tevoren.

> ⚠️ Zie je de melding **"Google Agenda niet verbonden"**? Log dan even uit en
> opnieuw in. Daarmee vernieuw je de koppeling met Google.

---

## A6. Diensten ruilen met een collega

Kun je een keer niet? Vraag een ruil aan.

1. Ga naar **Mijn rooster**.
2. Klik bij de dienst die je kwijt wil op de knop **Ruil**.
3. Kies in het venster een **dienst van een collega** om mee te ruilen.
4. De collega krijgt een verzoek. Het verloopt in drie stappen:
   1. **Jij** stuurt het verzoek.
   2. **De collega** keurt goed of wijst af (bij **Ruilverzoeken**).
   3. **De beheerder** keurt de ruil definitief goed.
5. Volg de status onder **Ruilverzoeken**:
   - **Inkomende verzoeken** — collega wil met jóu ruilen → Goedkeuren / Afwijzen.
   - **Wacht op admin** — beide eens, beheerder moet nog akkoord.
   - **Verstuurde verzoeken** — jouw openstaande verzoeken → kun je **Annuleren**.

---

## A7. Inbox / meldingen

Onder **Inbox** (belletje in de menubalk) staan je meldingen, bijvoorbeeld:
dienst goedgekeurd of afgewezen, ruilverzoek ontvangen, plek vrijgekomen.

- Een rood stipje = ongelezen.
- Open de Inbox om alles als gelezen te markeren.
- Verwijder losse meldingen met het kruisje, of gebruik **Alles wissen**.

---

# Deel B — Voor beheerders

> Je hebt de rol **admin** nodig. In de menubalk verschijnt dan **Beheer** en een
> rood **Admin**-label.

## B1. Het beheerpaneel

Klik op **Beheer**. Je ziet:

- **Statistieken:** aantal medewerkers, diensten, ingevuld, open plekken.
- **Snelkoppelingen:** Medewerkers · Beschikbaarheid · Rooster.
- **Ruilverzoeken goedkeuren:** ruilen waar beide medewerkers al akkoord zijn.
- **Roosterperiodes:** alle maanden, met per maand knoppen om te beheren,
  exporteren en de status te wisselen.

---

## B2. Een nieuwe maand (periode) aanmaken

1. Klik op **Beheer** → **Nieuwe periode** (oranje knop rechtsboven).
2. Kies **maand** en **jaar**.
3. Stel optioneel een **deadline beschikbaarheid** in (tot wanneer medewerkers
   zich mogen aanmelden).
4. Kies de **diensttypen**:
   - **Ochtenddienst** — 08:30–12:30 (4 uur)
   - **Middagdienst** — 12:00–17:30 (5,5 uur)
5. Stel in hoeveel **studenten per dienst** mogen (geldt voor werkdagen).
6. Laat **Zaterdagen meenemen** aangevinkt staan als je ook op zaterdag wilt
   roosteren. Zaterdagdiensten hebben **altijd maar 1 student**.
7. Onderin zie je hoeveel diensten er worden aangemaakt. Klik op **Periode
   aanmaken**.

Je komt daarna direct in het **Roosterbeheer** van die maand.

> 💡 De inschrijving staat na het aanmaken meteen **open**, zodat medewerkers
> zich kunnen aanmelden.

---

## B3. Het rooster beheren

Open een maand via **Beheer → Beheren →** bij de juiste periode.

- Bovenin: **aantal diensten**, **vol**, en **open plekken**.
- Een **kalender** (ma t/m za). **Klik op een dag** om de diensten van die dag
  te beheren.
- Per dienst zie je wie zich heeft aangemeld (amber) en wie is ingeroosterd
  (groen).

Vanuit de dag-weergave kun je:

- **Goedkeuren** — een aanmelding wordt een vaste plaatsing.
- **Afwijzen** — verwijdert de aanmelding.
- **Verwijderen** — haalt een al goedgekeurde plaatsing weg.
- **Direct toewijzen** — zet zelf een medewerker op een dienst (meteen
  goedgekeurd), zonder dat die zich hoeft aan te melden.

---

## B4. Aanvragen goedkeuren of afwijzen

Snelste manier voor veel aanvragen tegelijk:

1. Open een maand in **Roosterbeheer**.
2. Klik bovenin op de balk **"X aanvragen wacht op goedkeuring"**.
3. In het paneel kun je per aanvraag **Goedkeuren** / **Afwijzen**, of in één
   keer **Alles goedkeuren** per dienst.

> ⚠️ Komt een medewerker met een goedkeuring boven zijn **maandlimiet** uit, dan
> wordt die goedkeuring **geweigerd** met de melding *"Maandlimiet
> overschreden"*. Zie [B6](#b6-de-urenlimiet-1664-uur-per-maand).

---

## B5. Zaterdagen toevoegen aan een bestaande maand

Maanden die zijn aangemaakt **vóór** de zaterdag-functie hebben nog geen
zaterdagdiensten. Toevoegen kan in één klik:

1. Open de maand in **Roosterbeheer**.
2. Staat er bovenin een balk **"X zaterdagen zonder dienst"**? Klik dan op
   **Zaterdagen toevoegen**.
3. De ontbrekende zaterdagen krijgen diensten met **max 1 student**, met
   dezelfde tijden als de rest van de maand. De balk verdwijnt zodra alle
   zaterdagen een dienst hebben.

> 💡 Nieuwe maanden krijgen zaterdagen automatisch (zie B2), dus deze knop is
> alleen nodig voor oudere maanden.

---

## B6. De urenlimiet (16–64 uur per maand)

Het systeem bewaakt automatisch dat een medewerker niet te veel uren krijgt.

- De limiet is **per medewerker** en gebaseerd op het contract:
  **maandmaximum = contract-max-uren × 4**.
  Standaard is dat 16 uur/week → **64 uur per maand**.
- Alleen **goedgekeurde** uren tellen mee. Aanmelden mag dus vrij.
- De grens **blokkeert bij het goedkeuren**: je kunt een medewerker niet boven
  zijn maandmaximum inroosteren. Je krijgt dan de melding *"Maandlimiet
  overschreden"*.

Wil je voor een medewerker een ander maximum? Pas dan zijn **contract-max-uren**
aan bij **Medewerkers** (bijv. 12 uur/week → 48 uur/maand).

> ℹ️ Het *minimum* (richtlijn 16 uur/maand) wordt niet geblokkeerd — iemand
> begint nu eenmaal op 0 uur. Het maximum is de harde grens.

---

## B7. Medewerkers beheren

Via **Beheer → Medewerkers**:

- Bekijk alle medewerkers, hun **rol** en **contracturen**.
- Pas **contract-min/max-uren** aan (bepaalt mede de maandlimiet, zie B6).
- Nodig nieuwe medewerkers uit (pre-registratie op e-mailadres); zodra zij voor
  het eerst inloggen met dat @adhdmc.nl-adres wordt hun account gekoppeld.

---

## B8. Ruilverzoeken definitief goedkeuren

Wanneer twee medewerkers het samen eens zijn over een ruil, komt die bij jou
terecht:

1. Ga naar **Beheer**.
2. Onder **Ruilverzoeken goedkeuren** zie je de ruilen waar **beide medewerkers
   akkoord** zijn.
3. Klik **Goedkeuren** (de diensten worden omgewisseld) of **Afwijzen**.

---

## B9. Uren exporteren voor de financiële administratie

Aan het eind van de maand exporteer je de gewerkte uren:

1. Ga naar **Beheer**.
2. Zoek bij **Roosterperiodes** de juiste maand.
3. Klik op **Uren export**.
4. Er wordt een bestand **`uren-<maand>-<jaar>.csv`** gedownload dat direct in
   **Excel** opent.

Het bestand bevat per medewerker:

| Kolom | Betekenis |
|-------|-----------|
| Naam | Naam van de medewerker |
| E-mail | E-mailadres |
| Gewerkte dagen | Aantal verschillende dagen gewerkt |
| Aantal diensten | Totaal aantal diensten |
| Ochtenddiensten | Aantal ochtenddiensten |
| Middagdiensten | Aantal middagdiensten |
| Totaal uren | Totaal aantal uren |

Onderaan staat een **TOTAAL**-regel over alle medewerkers.

> ⚠️ Alleen **goedgekeurde** diensten tellen mee (= daadwerkelijk gewerkt).
> Exporteer dus pas als alle diensten van de maand zijn goedgekeurd.

---

## B10. Het rooster publiceren

Per periode op het beheerpaneel staan drie schakelaars:

- **Inschrijving** — open/dicht voor aanmelden door medewerkers.
- **2e ronde** — extra inschrijfronde voor overgebleven plekken.
- **Publiceer** — markeert het rooster als definitief/gepubliceerd.

Een typische volgorde: *Inschrijving open* → aanmeldingen goedkeuren →
*Inschrijving dicht* → eventueel *2e ronde* → *Publiceer*.

---

# Deel C — Technisch beheer

> Dit deel is voor de beheerder met toegang tot **Supabase** (de database) en de
> code. Voor dagelijks gebruik is dit niet nodig.

### C1. Iemand beheerder (admin) maken

1. Log in op [supabase.com](https://supabase.com) → open het project.
2. Ga naar **Table Editor → `profiles`**.
3. Zoek de rij van de persoon (op e-mail) en zet **`role`** op `admin`.

Of via **SQL Editor**:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'naam@adhdmc.nl';
```

### C2. De urenlimiet (database-regel)

De maandlimiet wordt afgedwongen door een database-trigger. Deze is al
geïnstalleerd. De broncode staat in
`supabase/migrations/0007_monthly_hours_cap.sql`. Wil je het maandmaximum
anders berekenen dan "contract-max × 4", pas dan de factor in dat bestand aan en
voer het opnieuw uit in de SQL Editor.

### C3. Automatische agenda-synchronisatie (optioneel, server-side)

Er is een Edge Function voorbereid die diensten **server-side** met Google
Agenda synchroniseert (ook als de medewerker niet ingelogd is). Deze moet nog
worden uitgerold. De volledige stappen staan in
`supabase/functions/calendar-sync/README.md`.

### C4. Database in versiebeheer

De schema-opbouw staat in `supabase/migrations/`. Lees `supabase/README.md` voor
welke onderdelen nog uit de live-database gehaald moeten worden.

### C5. Wijzigingen live zetten (deploy)

De website staat op Cloud86 en wordt automatisch bijgewerkt:

```bash
git add .
git commit -m "Beschrijving van de wijziging"
git push origin main
```

Een **GitHub Action** bouwt en publiceert daarna automatisch naar
`rooster.adhdmc.nl`. Een mislukte build (lint/typecheck-fout) blokkeert de
deploy, zodat er nooit een kapotte versie live komt.

---

# Veelgestelde vragen & problemen

**Ik klik op een maand maar ik zie geen diensten.**
Controleer of je in het juiste scherm bent. In **Inschrijven** springt de
kalender automatisch naar de gekozen maand. Zie je toch niks, dan zijn er
mogelijk nog geen diensten aangemaakt voor die maand (zie B2), of staat de
inschrijving dicht.

**Op zaterdag staat "Geen diensten op deze dag".**
De maand is waarschijnlijk aangemaakt vóór de zaterdag-functie. Gebruik de knop
**Zaterdagen toevoegen** (B5).

**Ik kan een medewerker niet goedkeuren ("Maandlimiet overschreden").**
De medewerker zit aan zijn maandmaximum. Verhoog eventueel zijn
contract-max-uren bij **Medewerkers**, of keur een andere dienst goed (B6).

**"Google Agenda niet verbonden".**
Log uit en opnieuw in om de Google-koppeling te vernieuwen (A5).

**Een medewerker kan niet inloggen.**
Het e-mailadres moet eindigen op **@adhdmc.nl**. Privé-Gmail werkt niet (A1).

**Er staat een witte/lege pagina.**
Herlaad de pagina. Blijft het misgaan, mail dan
[ictservicedesk@adhdmc.nl](mailto:ictservicedesk@adhdmc.nl).

---

# De maandelijkse routine in het kort

**Voor de beheerder, elke maand:**

1. **Nieuwe periode aanmaken** voor de komende maand, met deadline (B2).
2. **Inschrijving open** zetten en medewerkers laten aanmelden.
3. Na de deadline: **aanmeldingen goedkeuren** (B4), lettend op de urenlimiet (B6).
4. Eventueel **2e ronde** voor open plekken.
5. **Rooster publiceren** (B10).
6. Gedurende de maand: **ruilverzoeken** afhandelen (B8).
7. Einde van de maand: **uren exporteren** voor de administratie (B9).

**Voor de medewerker, elke maand:**

1. **Aanmelden** voor gewenste diensten vóór de deadline (A3).
2. Wachten op **goedkeuring** (zichtbaar in Mijn rooster en Inbox).
3. Diensten **synchroniseren** met Google Agenda (A5).
4. Niet kunnen? Tijdig een **ruil** aanvragen (A6).

---

*Vragen of problemen? Mail [ictservicedesk@adhdmc.nl](mailto:ictservicedesk@adhdmc.nl).*
