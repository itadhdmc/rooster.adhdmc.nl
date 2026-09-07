import { Shift } from '../types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TIMEZONE = 'Europe/Amsterdam'

// Historisch label: bestaande agenda-items zijn hiermee aangemaakt, dus de
// opruimlogica blijft dit altijd herkennen — ook als het label is aangepast.
const LEGACY_LABEL = 'ADHDMC Zorgadministratie'

// Vast, herleidbaar agenda-id per toewijzing. Hierdoor maakt opnieuw
// synchroniseren NOOIT een duplicaat: Google weigert een tweede afspraak met
// hetzelfde id (HTTP 409). Toegestane tekens zijn a-v en 0-9, dus de hex van
// een UUID (zonder streepjes) past precies.
export function eventIdFor(assignmentId: string): string {
  return 'adhdmc' + assignmentId.replace(/-/g, '')
}

function eventBody(shift: Shift, label: string) {
  const title = shift.shift_type === 'ochtend'
    ? `Ochtenddienst – ${label}`
    : `Middagdienst – ${label}`

  return {
    summary: title,
    description: `Dienst zorgadministratie\nTijd: ${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)} (${shift.duration_hours}u)`,
    start: { dateTime: `${shift.shift_date}T${shift.start_time}`, timeZone: TIMEZONE },
    end:   { dateTime: `${shift.shift_date}T${shift.end_time}`,   timeZone: TIMEZONE },
    colorId: shift.shift_type === 'ochtend' ? '5' : '3',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'email', minutes: 1440 },
      ],
    },
  }
}

// Maakt (of werkt bij) precies één agenda-afspraak voor een toewijzing.
// Geeft het vaste agenda-id terug, of null bij een fout.
export async function createCalendarEvent(shift: Shift, token: string, assignmentId: string, label: string = LEGACY_LABEL): Promise<string | null> {
  const id = eventIdFor(assignmentId)
  try {
    const res = await fetch(CALENDAR_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...eventBody(shift, label) }),
    })
    if (res.ok) return id
    // 409 = bestaat al → geen duplicaat. Werk hem bij zodat de tijden kloppen;
    // ook een geruilde dienst schuift zo naar de nieuwe datum.
    if (res.status === 409) {
      return await updateCalendarEvent(shift, token, id, label) ? id : null
    }
    return null
  } catch {
    return null
  }
}

// Zet een bestaande afspraak op de actuele dienst (datum, tijden, titel).
export async function updateCalendarEvent(shift: Shift, token: string, eventId: string, label: string = LEGACY_LABEL): Promise<boolean> {
  try {
    const res = await fetch(`${CALENDAR_API}/${eventId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody(shift, label)),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteCalendarEvent(eventId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${CALENDAR_API}/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok || res.status === 404 || res.status === 410
  } catch {
    return false
  }
}

interface CalendarItem {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

export interface SyncItem {
  id: string      // assignment-id
  shift: Shift    // effectieve dienst (incl. afwijkende werktijden)
}

export interface ReconcileResult {
  removed: number   // opgeruimde afspraken van diensten die je niet meer hebt
  written: number   // aangemaakte of verplaatste afspraken
  synced: string[]  // assignment-id's met een kloppende afspraak in de agenda
}

// Google geeft de tijd terug als '2026-09-07T08:30:00+02:00'; wij vergelijken
// alleen de lokale kalendertijd (datum + uur:minuut).
function localStamp(dateTime?: string): string {
  return dateTime ? dateTime.slice(0, 16) : ''
}

function isUpToDate(item: CalendarItem, shift: Shift, label: string): boolean {
  return item.summary === eventBody(shift, label).summary
    && localStamp(item.start?.dateTime) === `${shift.shift_date}T${shift.start_time.slice(0, 5)}`
    && localStamp(item.end?.dateTime)   === `${shift.shift_date}T${shift.end_time.slice(0, 5)}`
}

async function listEvents(token: string, timeMin: string, timeMax: string): Promise<CalendarItem[]> {
  try {
    const url = `${CALENDAR_API}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`
      + `&timeZone=${encodeURIComponent(TIMEZONE)}&singleEvents=true&maxResults=2500`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.items || []) as CalendarItem[]
  } catch {
    return []
  }
}

// Legt de agenda binnen een periode gelijk aan het rooster:
//   - afspraak van een dienst die je niet meer hebt (afgemeld, weggeruild,
//     door de admin verwijderd)      -> weg
//   - afspraak op een oude datum/tijd (ruil, aangepaste werktijden) -> verplaatst
//   - ontbrekende afspraak binnen de periode                        -> aangemaakt
//   - dubbele ADHDMC-afspraak zonder vast id                        -> weg
// `approved` bevat ALLE goedgekeurde toewijzingen van de gebruiker (ook buiten
// de periode), zodat een dienst die naar een andere maand is geruild niet als
// wees wordt aangezien maar netjes wordt verplaatst.
// `from` en `until` zijn dagen als 'YYYY-MM-DD'; `until` valt er net buiten.
export async function reconcileEvents(
  token: string,
  approved: SyncItem[],
  from: string,
  until: string,
  label: string = LEGACY_LABEL,
): Promise<ReconcileResult> {
  const timeMin = new Date(`${from}T00:00:00`).toISOString()
  const timeMax = new Date(`${until}T00:00:00`).toISOString()
  const expected = new Map(approved.map(a => [eventIdFor(a.id), a]))
  const seen = new Set<string>()
  const result: ReconcileResult = { removed: 0, written: 0, synced: [] }

  for (const item of await listEvents(token, timeMin, timeMax)) {
    const summary = item.summary || ''
    if (!summary.includes(label) && !summary.includes(LEGACY_LABEL)) continue

    const want = expected.get(item.id)
    // Onbekend id of geen bijbehorende dienst meer -> opruimen.
    if (!want) {
      if (await deleteCalendarEvent(item.id, token)) result.removed++
      continue
    }
    seen.add(item.id)
    if (isUpToDate(item, want.shift, label)) {
      result.synced.push(want.id)
    } else if (await updateCalendarEvent(want.shift, token, item.id, label)) {
      result.written++
      result.synced.push(want.id)
    }
  }

  // Diensten binnen de periode die (nog) geen afspraak hebben. Staat de
  // afspraak nog op een oude datum buiten de periode, dan geeft Google 409 en
  // schuift `createCalendarEvent` hem alsnog naar de juiste dag.
  for (const a of approved) {
    const id = eventIdFor(a.id)
    if (seen.has(id)) continue
    if (a.shift.shift_date < from || a.shift.shift_date >= until) continue
    if (await createCalendarEvent(a.shift, token, a.id, label)) {
      result.written++
      result.synced.push(a.id)
    }
  }

  return result
}
