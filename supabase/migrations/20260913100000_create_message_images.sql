-- Normalize chat message image attachments while retaining legacy messages image columns.

CREATE TABLE public.message_images (
  id           uuid                     DEFAULT gen_random_uuid() NOT NULL,
  message_id   uuid                     NOT NULL,
  storage_path text                     NOT NULL,
  image_name   text                     NOT NULL,
  ordinal      integer                  NOT NULL,
  created_at   timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.message_images
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.message_images
  ADD CONSTRAINT message_images_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;

ALTER TABLE public.message_images
  ADD CONSTRAINT message_images_pkey PRIMARY KEY (id);

ALTER TABLE public.message_images
  ADD CONSTRAINT message_images_ordinal_check CHECK (ordinal > 0);

ALTER TABLE public.message_images
  ADD CONSTRAINT message_images_message_id_ordinal_key UNIQUE (message_id, ordinal);

REVOKE ALL ON public.message_images FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_images TO authenticated;

GRANT ALL ON public.message_images TO service_role;

CREATE POLICY "Users can view own message images" ON public.message_images
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_images.message_id
        AND public.messages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own message images" ON public.message_images
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_images.message_id
        AND public.messages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own message images" ON public.message_images
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_images.message_id
        AND public.messages.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_images.message_id
        AND public.messages.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own message images" ON public.message_images
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages
      WHERE public.messages.id = message_images.message_id
        AND public.messages.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.message_images IS
  'Ordered normalized image attachments for chat messages; legacy messages image columns remain supported.';

COMMENT ON COLUMN public.message_images.ordinal IS
  'One-based display and model-input order within the message.';
