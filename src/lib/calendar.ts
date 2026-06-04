import { Shift } from '../types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TIMEZONE = 'Europe/Amsterdam'

// Vast, herleidbaar agenda-id per toewijzing. Hierdoor maakt opnieuw
// synchroniseren NOOIT een duplicaat: Google weigert een tweede afspraak met
// hetzelfde id (HTTP 409). Toegestane tekens zijn a-v en 0-9, dus de hex van
// een UUID (zonder streepjes) past precies.
export function eventIdFor(assignmentId: string): string {
  return 'adhdmc' + assignmentId.replace(/-/g, '')
}

function eventBody(shift: Shift) {
  const title = shift.shift_type === 'ochtend'
    ? 'Ochtenddienst – ADHDMC Zorgadministratie'
    : 'Middagdienst – ADHDMC Zorgadministratie'

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
export async function createCalendarEvent(shift: Shift, token: string, assignmentId: string): Promise<string | null> {
  const id = eventIdFor(assignmentId)
  try {
    const res = await fetch(CALENDAR_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...eventBody(shift) }),
    })
    if (res.ok) return id
    // 409 = bestaat al → geen duplicaat. Werk hem bij zodat de tijden kloppen.
    if (res.status === 409) {
      await fetch(`${CALENDAR_API}/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody(shift)),
      })
      return id
    }
    return null
  } catch {
    return null
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

// Ruimt dubbele ADHDMC-afspraken in een maand op en houdt precies één afspraak
// per toewijzing over. Lost bestaande duplicaten op die vóór deze fix zijn
// ontstaan. Geeft het aantal verwijderde duplicaten terug.
export async function repairMonthEvents(
  token: string,
  approved: { id: string; shift: Shift }[],
  year: number,
  month: number,
): Promise<number> {
  const expectedIds = new Set(approved.map(a => eventIdFor(a.id)))
  const mm = String(month).padStart(2, '0')
  const nextY = month === 12 ? year + 1 : year
  const nextM = month === 12 ? 1 : month + 1
  const nmm = String(nextM).padStart(2, '0')
  const timeMin = `${year}-${mm}-01T00:00:00Z`
  const timeMax = `${nextY}-${nmm}-01T00:00:00Z`

  let removed = 0
  try {
    const url = `${CALENDAR_API}?timeMin=${timeMin}&timeMax=${timeMax}&q=Zorgadministratie&singleEvents=true&maxResults=2500`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      for (const item of (data.items || [])) {
        const summary: string = item.summary || ''
        if (!summary.includes('ADHDMC Zorgadministratie')) continue
        // Alles wat niet het verwachte (vaste) id heeft is een duplicaat.
        if (!expectedIds.has(item.id)) {
          await deleteCalendarEvent(item.id, token)
          removed++
        }
      }
    }
  } catch {
    // negeren — we maken hieronder hoe dan ook de juiste afspraken aan
  }

  // Zorg dat elke toewijzing precies één afspraak heeft (met vast id).
  for (const a of approved) {
    await createCalendarEvent(a.shift, token, a.id)
  }
  return removed
}
