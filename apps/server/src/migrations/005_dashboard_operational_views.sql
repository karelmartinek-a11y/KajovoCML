CREATE TABLE public.dashboard_external_target_position (
    workspace_id uuid NOT NULL,
    external_target_id uuid NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_external_target_position_pkey PRIMARY KEY (workspace_id,external_target_id),
    CONSTRAINT dashboard_external_target_position_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES public.dashboard_workspace(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_external_target_position_target_fkey FOREIGN KEY (external_target_id) REFERENCES public.component_external_target(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_external_target_position_coordinate_check CHECK (x BETWEEN -100000 AND 100000 AND y BETWEEN -100000 AND 100000)
);

CREATE INDEX dashboard_external_target_position_target_idx
    ON public.dashboard_external_target_position (external_target_id);
