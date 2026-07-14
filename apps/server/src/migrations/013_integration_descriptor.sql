alter table integration_token
  add column if not exists descriptor jsonb,
  add column if not exists legacy_backfill boolean not null default false;

update integration_token
   set descriptor = jsonb_build_object(
         'summary', label,
         'businessPurpose', 'Legacy integration token: ' || label,
         'serviceOwner', 'legacy-unassigned',
         'technicalOwner', 'legacy-unassigned',
         'criticality', 'MEDIUM'
       ),
       legacy_backfill = true
 where descriptor is null
    or jsonb_typeof(descriptor) <> 'object'
    or descriptor = '{}'::jsonb;

alter table integration_token
  alter column descriptor set not null,
  drop constraint if exists integration_token_descriptor_check;

alter table integration_token
  add constraint integration_token_descriptor_check check (
    jsonb_typeof(descriptor) = 'object'
    and descriptor ?& array['summary','businessPurpose','serviceOwner','technicalOwner','criticality']
    and descriptor - array['summary','businessPurpose','serviceOwner','technicalOwner','criticality'] = '{}'::jsonb
    and jsonb_typeof(descriptor->'summary') = 'string'
    and jsonb_typeof(descriptor->'businessPurpose') = 'string'
    and jsonb_typeof(descriptor->'serviceOwner') = 'string'
    and jsonb_typeof(descriptor->'technicalOwner') = 'string'
    and descriptor->>'criticality' in ('LOW','MEDIUM','HIGH','CRITICAL')
  );
