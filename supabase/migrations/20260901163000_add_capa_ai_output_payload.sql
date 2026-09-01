begin;

alter table public.capa_ai_outputs
  add column output_payload jsonb;

alter table public.capa_ai_outputs
  add constraint capa_ai_outputs_payload_object
  check (
    output_payload is null
    or jsonb_typeof(output_payload) = 'object'
  );

commit;
