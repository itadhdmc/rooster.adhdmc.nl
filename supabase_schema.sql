-- ============================================================
-- ADHDMC Zorgadministratie Rooster - Database Schema
-- Uitvoeren in Supabase SQL Editor
-- ============================================================

-- Profielen (gekoppeld aan auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  contract_min_hours INT NOT NULL DEFAULT 4,
  contract_max_hours INT NOT NULL DEFAULT 16,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Roosterperiodes (bijv. juni 2025)
CREATE TABLE roster_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  availability_open BOOLEAN NOT NULL DEFAULT false,
  availability_deadline TIMESTAMPTZ,
  second_round_open BOOLEAN NOT NULL DEFAULT false,
  roster_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month)
);

-- Diensten
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES roster_periods(id) ON DELETE CASCADE NOT NULL,
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('ochtend', 'middag')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  duration_hours NUMERIC(4,2) NOT NULL,
  max_students INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Beschikbaarheid van studenten
CREATE TABLE availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  period_id UUID REFERENCES roster_periods(id) ON DELETE CASCADE NOT NULL,
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('ochtend', 'middag')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_id, shift_date, shift_type)
);

-- Toewijzingen (ingeroosterd)
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE NOT NULL,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  google_calendar_event_id TEXT,
  notified BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (user_id, shift_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

-- Profiles: iedereen mag eigen profiel lezen, admins zien alles
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Roster periods: iedereen leest, alleen admins schrijven
CREATE POLICY "periods_select_all" ON roster_periods FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "periods_write_admin" ON roster_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Shifts: iedereen leest, alleen admins schrijven
CREATE POLICY "shifts_select_all" ON shifts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "shifts_write_admin" ON shifts FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Availability: eigen beschikbaarheid + admins zien alles
CREATE POLICY "availability_select_own" ON availability FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "availability_select_admin" ON availability FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "availability_insert_own" ON availability FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "availability_delete_own" ON availability FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "availability_write_admin" ON availability FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Assignments: eigen assignments + admins
CREATE POLICY "assignments_select_own" ON assignments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "assignments_select_admin" ON assignments FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "assignments_write_admin" ON assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- Trigger: maak profiel aan bij nieuwe gebruiker
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- Handige views
-- ============================================================

-- Overzicht diensten met toegewezen studenten
CREATE VIEW shifts_with_assignments AS
SELECT
  s.*,
  rp.year,
  rp.month,
  COUNT(a.id) AS assigned_count,
  s.max_students - COUNT(a.id) AS open_spots,
  ARRAY_AGG(
    JSON_BUILD_OBJECT(
      'user_id', a.user_id,
      'full_name', p.full_name,
      'email', p.email
    )
  ) FILTER (WHERE a.id IS NOT NULL) AS assigned_students
FROM shifts s
JOIN roster_periods rp ON s.period_id = rp.id
LEFT JOIN assignments a ON s.id = a.shift_id
LEFT JOIN profiles p ON a.user_id = p.id
GROUP BY s.id, rp.year, rp.month;

-- Uren per student per maand
CREATE VIEW student_hours_per_month AS
SELECT
  a.user_id,
  p.full_name,
  p.email,
  rp.year,
  rp.month,
  SUM(s.duration_hours) AS total_hours,
  p.contract_min_hours,
  p.contract_max_hours
FROM assignments a
JOIN shifts s ON a.shift_id = s.id
JOIN roster_periods rp ON s.period_id = rp.id
JOIN profiles p ON a.user_id = p.id
GROUP BY a.user_id, p.full_name, p.email, rp.year, rp.month, p.contract_min_hours, p.contract_max_hours;
