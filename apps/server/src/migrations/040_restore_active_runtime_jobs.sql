update onboarding_job job
   set archived_at=null,
       archive_reason=null,
       runtime_stopped_at=null,
       state='ACTIVE'::onboarding_job_state,
       lock_version=job.lock_version+1
  from mcp_server server
 where job.server_id=server.id
   and job.release_version='2026.07.20'
   and job.archive_reason='release_2026_07_20_boundary'
   and job.archived_at is not null
   and job.state='CANCELLED'::onboarding_job_state
   and server.enabled is true
   and server.registration_state='ACTIVE'::registration_state
   and server.operational_state='HEALTHY'::operational_state
   and server.active_revision_id is not null;
