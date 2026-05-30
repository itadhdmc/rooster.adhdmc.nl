// ============================================================
// Edge Function: calendar-sync
// ============================================================
// Houdt Google Agenda automatisch in sync met de planning, zonder
// dat de student ingelogd hoeft te zijn. Wordt aangeroepen door een
// Supabase Database Webhook op de tabel `assignments` (INSERT/UPDATE/
// DELETE). Zie supabase/functions/calendar-sync/README.md.
//
// Logica:
//   - assignment wordt 'approved' en heeft nog geen event  -> event aanmaken
//   - assignment verwijderd, of niet langer 'approved'      -> event verwijderen
//
// Benodigde secrets (supabase secrets set ...):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Automatisch aanwezig in de functie-omgeving:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TIMEZONE = 'Europe/Amsterdam'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

interface Shift {
  shift_date: string
  shift_type: 'ochtend' | 'middag'
  start_time: string
  end_time: string
  duration_hours: number
}

interface AssignmentRow {
  id: string
  user_id: string
  shift_id: string
  status: string
  google_calendar_event_id: string | null
}

// Webhook-payload van Supabase (https://supabase.com/docs/guides/database/webhooks)
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: AssignmentRow | null
  old_record: AssignmentRow | null
}

Deno.serve(async (req) => {
  try {
    const payload = (await req.json()) as WebhookPayload
    if (payload.table !== 'assignments') {
      return json({ skipped: 'not assignments table' })
    }

    const newRow = payload.record
    const oldRow = payload.old_record

    // Bepaal of er een event hoort te bestaan na deze wijziging.
    const shouldExist = !!newRow && newRow.status === 'approved'
    const existingEventId = oldRow?.google_calendar_event_id ?? newRow?.google_calendar_event_id ?? null
    const userId = newRow?.user_id ?? oldRow?.user_id
    if (!userId) return json({ skipped: 'no user' })

    // Geval 1: moet bestaan maar er is nog geen event -> aanmaken
    if (shouldExist && newRow && !newRow.google_calendar_event_id) {
      const shift = await getShift(newRow.shift_id)
      if (!shift) return json({ error: 'shift not found' }, 404)
      const token = await getAccessToken(userId)
      if (!token) return json({ skipped: 'no google token for user' })

      const eventId = await createEvent(shift, token)
      if (eventId) {
        await admin.from('assignments')
          .update({ google_calendar_event_id: eventId })
          .eq('id', newRow.id)
      }
      return json({ action: 'created', eventId })
    }

    // Geval 2: zou niet (meer) moeten bestaan, maar er is nog een event -> verwijderen
    if (!shouldExist && existingEventId) {
      const token = await getAccessToken(userId)
      if (!token) return json({ skipped: 'no google token for user' })

      await deleteEvent(existingEventId, token)
      if (newRow) {
        await admin.from('assignments')
          .update({ google_calendar_event_id: null })
          .eq('id', newRow.id)
      }
      return json({ action: 'deleted' })
    }

    return json({ action: 'noop' })
  } catch (err) {
    console.error('calendar-sync fout:', err)
    return json({ error: String(err) }, 500)
  }
})

async function getShift(shiftId: string): Promise<Shift | null> {
  const { data } = await admin
    .from('shifts')
    .select('shift_date, shift_type, start_time, end_time, duration_hours')
    .eq('id', shiftId)
    .single()
  return (data as Shift) ?? null
}

// Wissel de opgeslagen refresh-token in voor een verse access-token.
async function getAccessToken(userId: string): Promise<string | null> {
  const { data } = await admin
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .single()
  if (!data?.refresh_token) return null

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    console.error('token refresh mislukt:', await res.text())
    return null
  }
  const tok = await res.json()
  return tok.access_token as string
}

async function createEvent(shift: Shift, token: string): Promise<string | null> {
  const title = shift.shift_type === 'ochtend'
    ? 'Ochtenddienst – ADHDMC Zorgadministratie'
    : 'Middagdienst – ADHDMC Zorgadministratie'

  const res = await fetch(CALENDAR_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: title,
      description: `Dienst zorgadministratie\nTijd: ${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)} (${shift.duration_hours}u)`,
      start: { dateTime: `${shift.shift_date}T${shift.start_time}`, timeZone: TIMEZONE },
      end: { dateTime: `${shift.shift_date}T${shift.end_time}`, timeZone: TIMEZONE },
      colorId: shift.shift_type === 'ochtend' ? '5' : '3',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 1440 },
        ],
      },
    }),
  })
  if (!res.ok) {
    console.error('event aanmaken mislukt:', await res.text())
    return null
  }
  const data = await res.json()
  return data.id as string
}

async function deleteEvent(eventId: string, token: string): Promise<void> {
  const res = await fetch(`${CALENDAR_API}/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error('event verwijderen mislukt:', await res.text())
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
