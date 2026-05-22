export type Role = 'student' | 'admin'
export type ShiftType = 'ochtend' | 'middag'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: Role
  contract_min_hours: number
  contract_max_hours: number
  active: boolean
  created_at: string
}

export interface RosterPeriod {
  id: string
  year: number
  month: number
  availability_open: boolean
  availability_deadline: string | null
  second_round_open: boolean
  roster_published: boolean
  created_at: string
}

export interface Shift {
  id: string
  period_id: string
  shift_date: string
  shift_type: ShiftType
  start_time: string
  end_time: string
  duration_hours: number
  max_students: number
  created_at: string
}

export interface ShiftWithAssignments extends Shift {
  year: number
  month: number
  assigned_count: number
  open_spots: number
  assigned_students: Array<{
    user_id: string
    full_name: string
    email: string
  }> | null
}

export interface Availability {
  id: string
  user_id: string
  period_id: string
  shift_date: string
  shift_type: ShiftType
  submitted_at: string
}

export interface Assignment {
  id: string
  user_id: string
  shift_id: string
  assigned_by: string | null
  assigned_at: string
  google_calendar_event_id: string | null
  notified: boolean
}

export interface StudentHours {
  user_id: string
  full_name: string
  email: string
  year: number
  month: number
  total_hours: number
  contract_min_hours: number
  contract_max_hours: number
}
