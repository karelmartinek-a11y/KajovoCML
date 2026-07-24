CREATE TABLE public.dashboard_visual_node (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration_token_id uuid,
    component_id uuid,
    principal_id uuid,
    lifecycle_phase text NOT NULL,
    label text NOT NULL,
    token_fingerprint text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    handed_off_at timestamp with time zone,
    deleted_at timestamp with time zone,
    lock_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT dashboard_visual_node_pkey PRIMARY KEY (id),
    CONSTRAINT dashboard_visual_node_phase_check CHECK (lifecycle_phase = ANY (ARRAY['PRE_REGISTRATION'::text,'REGISTERED'::text,'DELETED'::text])),
    CONSTRAINT dashboard_visual_node_identity_check CHECK (
      (lifecycle_phase='PRE_REGISTRATION' AND integration_token_id IS NOT NULL AND component_id IS NULL AND principal_id IS NULL)
      OR (lifecycle_phase='REGISTERED' AND component_id IS NOT NULL AND principal_id IS NOT NULL)
      OR (lifecycle_phase='DELETED')
    ),
    CONSTRAINT dashboard_visual_node_lock_version_check CHECK (lock_version >= 0),
    CONSTRAINT dashboard_visual_node_integration_token_fkey FOREIGN KEY (integration_token_id) REFERENCES public.integration_token(id) ON DELETE SET NULL,
    CONSTRAINT dashboard_visual_node_component_fkey FOREIGN KEY (component_id) REFERENCES public.component(id) ON DELETE SET NULL,
    CONSTRAINT dashboard_visual_node_principal_fkey FOREIGN KEY (principal_id) REFERENCES public.principal(id) ON DELETE SET NULL,
    CONSTRAINT dashboard_visual_node_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_account(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX dashboard_visual_node_active_token_idx
    ON public.dashboard_visual_node (integration_token_id)
    WHERE integration_token_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX dashboard_visual_node_active_component_idx
    ON public.dashboard_visual_node (component_id)
    WHERE component_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX dashboard_visual_node_phase_idx ON public.dashboard_visual_node (lifecycle_phase) WHERE deleted_at IS NULL;

CREATE TABLE public.dashboard_workspace (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_admin_id uuid NOT NULL,
    workspace_key text DEFAULT 'DEFAULT'::text NOT NULL,
    viewport jsonb DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb NOT NULL,
    lock_version bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_workspace_pkey PRIMARY KEY (id),
    CONSTRAINT dashboard_workspace_owner_key_unique UNIQUE (owner_admin_id, workspace_key),
    CONSTRAINT dashboard_workspace_owner_fkey FOREIGN KEY (owner_admin_id) REFERENCES public.admin_account(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_workspace_lock_version_check CHECK (lock_version >= 0),
    CONSTRAINT dashboard_workspace_viewport_check CHECK (jsonb_typeof(viewport)='object')
);

CREATE TABLE public.dashboard_node_position (
    workspace_id uuid NOT NULL,
    node_id uuid NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_node_position_pkey PRIMARY KEY (workspace_id,node_id),
    CONSTRAINT dashboard_node_position_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.dashboard_workspace(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_node_position_node_fkey FOREIGN KEY (node_id) REFERENCES public.dashboard_visual_node(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_node_position_coordinate_check CHECK (x BETWEEN -100000 AND 100000 AND y BETWEEN -100000 AND 100000)
);

CREATE TABLE public.principal_permission_suspension (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    principal_id uuid NOT NULL,
    reason text NOT NULL,
    suspended_by uuid NOT NULL,
    suspended_at timestamp with time zone DEFAULT now() NOT NULL,
    resumed_by uuid,
    resumed_at timestamp with time zone,
    correlation_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT principal_permission_suspension_pkey PRIMARY KEY (id),
    CONSTRAINT principal_permission_suspension_principal_fkey FOREIGN KEY (principal_id) REFERENCES public.principal(id) ON DELETE CASCADE,
    CONSTRAINT principal_permission_suspension_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES public.admin_account(id) ON DELETE RESTRICT,
    CONSTRAINT principal_permission_suspension_resumed_by_fkey FOREIGN KEY (resumed_by) REFERENCES public.admin_account(id) ON DELETE SET NULL,
    CONSTRAINT principal_permission_suspension_resume_check CHECK ((resumed_at IS NULL) = (resumed_by IS NULL))
);
CREATE UNIQUE INDEX principal_permission_suspension_active_idx
    ON public.principal_permission_suspension (principal_id)
    WHERE resumed_at IS NULL;

CREATE TABLE public.pulse_topology_connection (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_component_id uuid NOT NULL,
    source_port_key text NOT NULL,
    source_revision_id uuid,
    source_contract_digest text,
    target_component_id uuid NOT NULL,
    target_port_key text NOT NULL,
    target_revision_id uuid,
    target_contract_digest text,
    target_route text NOT NULL,
    target_scope text NOT NULL,
    audience text NOT NULL,
    state text DEFAULT 'CONNECTED'::text NOT NULL,
    compatibility_status text DEFAULT 'UNKNOWN'::text NOT NULL,
    compatibility_evaluator_version text DEFAULT 'dashboard-compatibility/1'::text NOT NULL,
    compatibility_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    permission_id uuid,
    authorization_desired boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_by uuid,
    revoked_at timestamp with time zone,
    correlation_id uuid NOT NULL,
    lock_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT pulse_topology_connection_pkey PRIMARY KEY (id),
    CONSTRAINT pulse_topology_connection_direction_check CHECK (source_component_id <> target_component_id),
    CONSTRAINT pulse_topology_connection_state_check CHECK (state = ANY (ARRAY['CONNECTED'::text,'DISCONNECTED'::text,'ARCHIVED'::text])),
    CONSTRAINT pulse_topology_connection_compatibility_check CHECK (compatibility_status = ANY (ARRAY['EXACT_MATCH'::text,'COMPATIBLE_WITH_DIFFERENCES'::text,'INCOMPATIBLE'::text,'UNKNOWN'::text,'STALE'::text])),
    CONSTRAINT pulse_topology_connection_lock_version_check CHECK (lock_version >= 0),
    CONSTRAINT pulse_topology_connection_source_fkey FOREIGN KEY (source_component_id) REFERENCES public.component(id) ON DELETE CASCADE,
    CONSTRAINT pulse_topology_connection_target_fkey FOREIGN KEY (target_component_id) REFERENCES public.component(id) ON DELETE CASCADE,
    CONSTRAINT pulse_topology_connection_source_revision_fkey FOREIGN KEY (source_revision_id) REFERENCES public.component_revision(id) ON DELETE SET NULL,
    CONSTRAINT pulse_topology_connection_target_revision_fkey FOREIGN KEY (target_revision_id) REFERENCES public.component_revision(id) ON DELETE SET NULL,
    CONSTRAINT pulse_topology_connection_permission_fkey FOREIGN KEY (permission_id) REFERENCES public.component_permission(id) ON DELETE SET NULL,
    CONSTRAINT pulse_topology_connection_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admin_account(id) ON DELETE RESTRICT,
    CONSTRAINT pulse_topology_connection_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.admin_account(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX pulse_topology_connection_active_identity_idx
    ON public.pulse_topology_connection (source_component_id,source_port_key,target_component_id,target_port_key,target_route,target_scope,audience)
    WHERE revoked_at IS NULL;
CREATE INDEX pulse_topology_connection_source_idx ON public.pulse_topology_connection (source_component_id) WHERE revoked_at IS NULL;
CREATE INDEX pulse_topology_connection_target_idx ON public.pulse_topology_connection (target_component_id) WHERE revoked_at IS NULL;
CREATE INDEX pulse_topology_connection_permission_idx ON public.pulse_topology_connection (permission_id) WHERE revoked_at IS NULL;

INSERT INTO public.dashboard_visual_node(component_id,principal_id,lifecycle_phase,label,metadata)
SELECT c.id,c.principal_id,'REGISTERED',c.code,jsonb_build_object('seededBy','migration-004')
  FROM public.component c
 WHERE c.deregistered_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.dashboard_visual_node n WHERE n.component_id=c.id AND n.deleted_at IS NULL);

INSERT INTO public.dashboard_visual_node(integration_token_id,lifecycle_phase,label,token_fingerprint,created_by,metadata)
SELECT it.id,'PRE_REGISTRATION',it.label,it.fingerprint,it.created_by,jsonb_build_object('seededBy','migration-004')
  FROM public.integration_token it
 WHERE it.deleted_at IS NULL
   AND it.revoked_at IS NULL
   AND it.expires_at > now()
   AND NOT EXISTS (
     SELECT 1 FROM public.component_onboarding_job job
      WHERE job.integration_token_id=it.id AND job.component_id IS NOT NULL
   )
   AND NOT EXISTS (SELECT 1 FROM public.dashboard_visual_node n WHERE n.integration_token_id=it.id AND n.deleted_at IS NULL);

CREATE TABLE public.dashboard_deregistration_request (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_digest text NOT NULL,
    actor_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT dashboard_deregistration_request_pkey PRIMARY KEY (id),
    CONSTRAINT dashboard_deregistration_request_unique UNIQUE (node_id,idempotency_key),
    CONSTRAINT dashboard_deregistration_request_node_fkey FOREIGN KEY (node_id) REFERENCES public.dashboard_visual_node(id) ON DELETE RESTRICT,
    CONSTRAINT dashboard_deregistration_request_actor_fkey FOREIGN KEY (actor_id) REFERENCES public.admin_account(id) ON DELETE RESTRICT,
    CONSTRAINT dashboard_deregistration_request_status_check CHECK (status = ANY (ARRAY['PENDING'::text,'COMPLETED'::text,'FAILED'::text])),
    CONSTRAINT dashboard_deregistration_request_completion_check CHECK ((status='COMPLETED') = (completed_at IS NOT NULL))
);
