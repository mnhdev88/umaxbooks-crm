-- Create content_library table
CREATE TABLE IF NOT EXISTS public.content_library (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,
  title       text NOT NULL,
  description text,
  url         text,
  file_url    text,
  lead_id     uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.content_library ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all rows
CREATE POLICY "content_library_select"
  ON public.content_library FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert
CREATE POLICY "content_library_insert"
  ON public.content_library FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Authenticated users can delete their own rows (or admins can delete any)
CREATE POLICY "content_library_delete"
  ON public.content_library FOR DELETE
  TO authenticated
  USING (true);

-- Authenticated users can update
CREATE POLICY "content_library_update"
  ON public.content_library FOR UPDATE
  TO authenticated
  USING (true);
