CREATE TABLE public_check_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_check_attempts_created_idx ON public_check_attempts (created_at, ip_hash);
ALTER TABLE public_check_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_check_attempts FORCE ROW LEVEL SECURITY;
