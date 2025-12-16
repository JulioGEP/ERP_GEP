-- Campos para gestionar vacaciones y teletrabajo por usuario

CREATE TABLE IF NOT EXISTS public.user_vacation_balances (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    year integer NOT NULL,
    allowance_days integer NOT NULL DEFAULT 24,
    anniversary_days integer NOT NULL DEFAULT 1,
    local_holiday_days integer NOT NULL DEFAULT 2,
    previous_year_days integer NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_vacation_balance_year ON public.user_vacation_balances (user_id, year);

CREATE TABLE IF NOT EXISTS public.user_vacation_days (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date date NOT NULL,
    type varchar(1) NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_vacation_days_user_date ON public.user_vacation_days (user_id, date);
