# Subverwerkers

Bijlage bij de verwerkersovereenkomst voor het roostersysteem
(productnaam: Zorgadministratie Rooster).

Laatst bijgewerkt: 21 augustus 2026.

Deze lijst beschrijft de partijen die de leverancier inschakelt bij het
verwerken van persoonsgegevens van de klant. Elke klantomgeving is
**gescheiden** (eigen database, eigen frontend, eigen Google-project).
Gegevens van klant A staan niet in de omgeving van klant B.

---

## 1. Subverwerkers die persoonsgegevens van eindgebruikers verwerken

| # | Subverwerker | Doel | Categorieën gegevens | Vestiging / regio | Overdracht buiten EER |
|---|--------------|------|----------------------|-------------------|------------------------|
| 1 | **Supabase, Inc.** | Database, authenticatie, realtime meldingen, optioneel Edge Functions (agenda-sync) | Namen, e-mailadressen, rollen, rooster- en dienstgegevens, aanwezigheid, ruilverzoeken, in-app meldingen, Google refresh-tokens | VS; project wordt aangemaakt in een **EU-regio** (Frankfurt of Ierland — vastleggen per klant) | Ja, tenzij het project in de EU staat *en* geen VS-support/logging meeloopt. Standaard: SCC’s van Supabase. Kies bij inrichting altijd een EU-regio. |
| 2 | **Google Ireland Limited** (Google Workspace / Google Cloud / Calendar API) | Inloggen (OAuth) en synchronisatie van diensten naar de Google Agenda van de medewerker | E-mail, naam, OAuth-tokens, agenda-afspraken die het systeem aanmaakt | Ierland / EU, met ondersteuning door Google LLC (VS) | Ja. Grondslag: SCC’s Google Cloud / Workspace. De klant heeft zelf een Google Workspace; dit systeem schrijft alleen naar agenda’s van gebruikers binnen het toegestane domein. |
| 3 | **Resend, Inc.** | Transactionele e-mail (dienst goedgekeurd, reserve, etc.) | Naam, e-mail, dienst-/roostermetadata in de mailtekst | VS | Ja. SCC’s van Resend. Afzenderdomein van de klant wordt bij Resend geverifieerd. |
| 4 | **Cloud86 B.V.** | Hosting van de frontend (statische website, HTTPS) | Geen opslag van persoonsgegevens in een database. De browser van de gebruiker laadt de app; sessies en data lopen daarna naar Supabase. Serverlogs kunnen IP-adressen en User-Agent bevatten. | Nederland | Nee |

---

## 2. Hulpmiddelen van de leverancier (geen eindgebruikersdata van de klant)

Deze partijen zien **geen** roosters of persoonsgegevens van medewerkers van
de klant. Ze staan hier ter volledigheid, omdat ze de broncode en de
uitrol van de leverancier raken.

| Partij | Doel | Wat erin staat |
|--------|------|----------------|
| **GitHub, Inc.** (incl. GitHub Actions) | Broncode, CI/CD, deploy naar Cloud86 | Broncode van het product; build-secrets van de leverancier (Supabase anon-key, FTP). Geen productiedata van de klant. |

---

## 3. Wat er níét in zit

- Geen patiëntendossiers, geen BSN, geen medische gegevens.
- Geen analytics (geen Google Analytics, Mixpanel, etc.).
- Geen foutmonitoring-SaaS (geen Sentry) — tenzij later toegevoegd; dan deze lijst bijwerken.
- Geen gedeelde multi-tenant database: elke klant heeft een eigen Supabase-project.

---

## 4. Soorten persoonsgegevens in het systeem

- Identificatie: naam, e-mailadres (Google Workspace van de klant).
- Autorisatie: rol (`student` / `admin`), contracturen.
- Rooster: diensten, inschrijvingen, goedkeuringen, reserves, ruilverzoeken, aanwezigheid (gewerkt / ziek / afwezig).
- Communicatie: in-app meldingen; e-mails via Resend.
- Koppeling Google Agenda: refresh-token en event-id’s (alleen als de gebruiker toestemming geeft).

Verwerkingsverantwoordelijke: de klant.
Verwerker: [LEVERANCIER].

---

## 5. Wijzigingen

Nieuwe subverwerkers worden aangekondigd volgens de verwerkersovereenkomst
(doorgaans schriftelijk, met bezwaartermijn). Deze bijlage is de actuele lijst.
