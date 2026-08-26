-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION IF EXISTS pg_net;

DROP EXTENSION IF EXISTS pg_graphql;

CREATE ROLE supabase_privileged_role;

GRANT supabase_privileged_role TO postgres;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  insert into public.profiles (id, plan)
  values (new.id, 'free');
  return new;
end;
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;

GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;

GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;

CREATE FUNCTION public.refund_daily_usage (
  p_user_id uuid,
  p_date    date
)
  RETURNS integer
  LANGUAGE plpgsql
  AS $function$
declare
  v_count integer;
begin
  update public.usage as u
  set message_count = greatest(u.message_count - 1, 0)
  where u.user_id = p_user_id
    and u.date = p_date
  returning u.message_count into v_count;

  return coalesce(v_count, 0);
end;
$function$;

GRANT ALL ON FUNCTION public.refund_daily_usage(uuid, date) TO anon;

GRANT ALL ON FUNCTION public.refund_daily_usage(uuid, date) TO authenticated;

GRANT ALL ON FUNCTION public.refund_daily_usage(uuid, date) TO service_role;

CREATE FUNCTION public.reserve_daily_usage (
  p_user_id uuid,
  p_date    date,
  p_limit   integer
)
  RETURNS TABLE (
    allowed       boolean,
    message_count integer
  )
  LANGUAGE plpgsql
  AS $function$
declare
  v_count integer;
begin
  loop
    update public.usage as u
    set message_count = u.message_count + 1
    where u.user_id = p_user_id
      and u.date = p_date
      and u.message_count < p_limit
    returning u.message_count into v_count;

    if found then
      return query select true, v_count;
      return;
    end if;

    begin
      insert into public.usage (user_id, date, message_count)
      values (p_user_id, p_date, 1);

      return query select true, 1;
      return;
    exception
      when unique_violation then
        null;
    end;

    select u.message_count
    into v_count
    from public.usage as u
    where u.user_id = p_user_id
      and u.date = p_date;

    if v_count >= p_limit then
      return query select false, v_count;
      return;
    end if;
  end loop;
end;
$function$;

GRANT ALL ON FUNCTION public.reserve_daily_usage(uuid, date, integer) TO anon;

GRANT ALL ON FUNCTION public.reserve_daily_usage(uuid, date, integer) TO authenticated;

GRANT ALL ON FUNCTION public.reserve_daily_usage(uuid, date, integer) TO service_role;

CREATE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;

GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;

GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;

CREATE FUNCTION public.update_updated_at_column()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;

GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;

CREATE TABLE public.auth_events (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id    uuid                     NOT NULL,
  event_type text                     NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.auth_events
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.auth_events
  ADD CONSTRAINT auth_events_event_type_check CHECK (event_type = ANY (ARRAY['login'::text, 'reset_requested'::text, 'reset_completed'::text]));

ALTER TABLE public.auth_events
  ADD CONSTRAINT auth_events_pkey PRIMARY KEY (id);

ALTER TABLE public.auth_events
  ADD CONSTRAINT auth_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.auth_events TO anon;

GRANT ALL ON public.auth_events TO authenticated;

GRANT ALL ON public.auth_events TO service_role;

CREATE POLICY "Users can view their own auth events" ON public.auth_events
  FOR SELECT
  USING ((auth.uid() = user_id));

CREATE TABLE public.conversations (
  id         uuid                     DEFAULT gen_random_uuid() NOT NULL,
  title      text                     DEFAULT 'New Chat'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  user_id    uuid
);

ALTER TABLE public.conversations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.conversations TO anon;

GRANT ALL ON public.conversations TO authenticated;

GRANT ALL ON public.conversations TO service_role;

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can access own conversations" ON public.conversations
  USING ((auth.uid() = user_id));

CREATE POLICY "users can delete own conversations" ON public.conversations
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "users can insert own conversations" ON public.conversations
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "users can update own conversations" ON public.conversations
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "users can view own conversations" ON public.conversations
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE TABLE public.documents (
  id                     uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id                uuid                     NOT NULL,
  conversation_id        uuid,
  file_name              text                     NOT NULL,
  mime_type              text                     NOT NULL,
  size_bytes             bigint                   NOT NULL,
  storage_path           text                     NOT NULL,
  extracted_text         text,
  extraction_status      text                     DEFAULT 'pending'::text NOT NULL,
  openai_file_id         text,
  openai_vector_store_id text,
  created_at             timestamp with time zone DEFAULT now() NOT NULL,
  updated_at             timestamp with time zone DEFAULT now() NOT NULL,
  extraction_error       text
);

ALTER TABLE public.documents
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

GRANT ALL ON public.documents TO anon;

GRANT ALL ON public.documents TO authenticated;

GRANT ALL ON public.documents TO service_role;

CREATE INDEX documents_conversation_id_idx ON public.documents (conversation_id);

CREATE INDEX documents_created_at_idx ON public.documents (created_at DESC);

CREATE INDEX documents_user_id_idx ON public.documents (user_id);

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "Users can delete own documents" ON public.documents
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "Users can insert own documents" ON public.documents
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can update own documents" ON public.documents
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view own documents" ON public.documents
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE TABLE public.message_feedback (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  user_id         uuid                     NOT NULL,
  conversation_id uuid                     NOT NULL,
  message_id      text                     NOT NULL,
  rating          text                     NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.message_feedback
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_pkey PRIMARY KEY (id);

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_rating_check CHECK (rating = ANY (ARRAY['up'::text, 'down'::text]));

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.message_feedback
  ADD CONSTRAINT message_feedback_user_id_message_id_key UNIQUE (user_id, message_id);

GRANT ALL ON public.message_feedback TO anon;

GRANT ALL ON public.message_feedback TO authenticated;

GRANT ALL ON public.message_feedback TO service_role;

CREATE POLICY "Users can insert their own feedback" ON public.message_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can update their own feedback" ON public.message_feedback
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can view their own feedback" ON public.message_feedback
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE TABLE public.messages (
  id              uuid                     DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid                     NOT NULL,
  role            text                     NOT NULL,
  content         text                     NOT NULL,
  created_at      timestamp with time zone DEFAULT now() NOT NULL,
  user_id         uuid,
  image_path      text,
  image_name      text,
  documents       jsonb                    DEFAULT '[]'::jsonb NOT NULL,
  sources         jsonb,
  source_count    integer,
  widget          jsonb
);

ALTER TABLE public.messages
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE public.messages
  ADD CONSTRAINT messages_role_check CHECK (role = ANY (ARRAY['system'::text, 'user'::text, 'assistant'::text]));

ALTER TABLE public.messages
  ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

GRANT ALL ON public.messages TO anon;

GRANT ALL ON public.messages TO authenticated;

GRANT ALL ON public.messages TO service_role;

CREATE INDEX idx_messages_conversation_id_created_at ON public.messages (conversation_id, created_at);

CREATE POLICY "Users can access own messages" ON public.messages
  USING ((auth.uid() = user_id));

CREATE POLICY "users can delete own messages" ON public.messages
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "users can insert own messages" ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "users can update own messages" ON public.messages
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE POLICY "users can view own messages" ON public.messages
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id));

CREATE TABLE public.profiles (
  id                     uuid                     NOT NULL,
  plan                   text                     DEFAULT 'free'::text NOT NULL,
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text,
  current_period_end     timestamp with time zone,
  created_at             timestamp with time zone DEFAULT now(),
  updated_at             timestamp with time zone DEFAULT now(),
  plan_source            text                     DEFAULT 'manual'::text,
  lifetime_pro           boolean                  DEFAULT false
);

ALTER TABLE public.profiles
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

GRANT ALL ON public.profiles TO anon;

GRANT ALL ON public.profiles TO authenticated;

GRANT ALL ON public.profiles TO service_role;

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE
  USING ((auth.uid() = id));

CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT
  USING ((auth.uid() = id));

CREATE TABLE public.usage (
  id            uuid                        DEFAULT gen_random_uuid() NOT NULL,
  user_id       uuid                        NOT NULL,
  date          date                        DEFAULT CURRENT_DATE NOT NULL,
  message_count integer                     DEFAULT 0,
  created_at    timestamp without time zone DEFAULT now()
);

ALTER TABLE public.usage
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usage
  ADD CONSTRAINT usage_pkey PRIMARY KEY (id);

ALTER TABLE public.usage
  ADD CONSTRAINT usage_user_date_unique UNIQUE (user_id, date);

ALTER TABLE public.usage
  ADD CONSTRAINT usage_user_id_date_key UNIQUE (user_id, date);

GRANT ALL ON public.usage TO anon;

GRANT ALL ON public.usage TO authenticated;

GRANT ALL ON public.usage TO service_role;

CREATE POLICY "Users can access own usage" ON public.usage
  USING ((auth.uid() = user_id));
