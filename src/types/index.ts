export type Role = 'student' | 'admin'
export type ShiftType = 'ochtend' | 'middag'
export type AssignmentStatus = 'pending' | 'approved'
export type Attendance = 'gewerkt' | 'ziek' | 'afwezig'

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
    assignment_id: string
    status: AssignmentStatus
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
  status: AssignmentStatus
  attendance: Attendance
  // Afwijkende werktijden voor deze persoon; null = standaardtijden van de dienst.
  custom_start_time: string | null
  custom_end_time: string | null
}

export type SwapStatus = 'pending' | 'employee_approved' | 'admin_approved' | 'rejected'

export interface SwapDetail {
  id: string
  requester_id: string
  requester_name: string
  target_user_id: string
  target_name: string
  requester_assignment_id: string
  target_assignment_id: string
  status: SwapStatus
  created_at: string
  req_shift_date: string
  req_shift_type: string
  req_start_time: string
  tgt_shift_date: string
  tgt_shift_type: string
  tgt_start_time: string
}

export interface SwappableAssignment {
  assignment_id: string
  user_id: string
  full_name: string
  shift_date: string
  shift_type: string
  start_time: string
  end_time: string
  duration_hours: number
}

export type NotificationType =
  | 'shift_approved'
  | 'shift_rejected'
  | 'admin_pending'
  | 'spot_available'
  | 'swap_request'
  | 'swap_approved'
  | 'swap_rejected'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  read: boolean
  created_at: string
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
