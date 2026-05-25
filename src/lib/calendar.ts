import { Shift } from '../types'

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TIMEZONE = 'Europe/Amsterdam'

export async function createCalendarEvent(shift: Shift, token: string): Promise<string | null> {
  const title = shift.shift_type === 'ochtend'
    ? 'Ochtenddienst – ADHDMC Zorgadministratie'
    : 'Middagdienst – ADHDMC Zorgadministratie'

  const body = {
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

  try {
    const res = await fetch(CALENDAR_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.id as string
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
    return res.ok || res.status === 404
  } catch {
    return false
  }
}
