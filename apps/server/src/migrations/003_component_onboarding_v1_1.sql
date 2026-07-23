CREATE TABLE public.integration_token_secret_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token_id uuid NOT NULL,
    secret_stable_name public.citext,
    all_secrets boolean DEFAULT false NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    transferred_component_id uuid,
    transferred_component_public_id public.citext,
    transferred_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT integration_token_secret_grant_scope_check CHECK (((all_secrets IS TRUE AND secret_stable_name IS NULL) OR (all_secrets IS FALSE AND secret_stable_name IS NOT NULL)))
);

ALTER TABLE ONLY public.secret_grant
    DROP CONSTRAINT secret_grant_principal_kind_check;

ALTER TABLE ONLY public.secret_grant
    ADD CONSTRAINT secret_grant_principal_kind_check CHECK ((principal_kind = ANY (ARRAY['KAJA'::text, 'COMPONENT'::text, 'INTEGRATION_TOKEN'::text])));

CREATE UNIQUE INDEX integration_token_secret_grant_active_all_idx
    ON public.integration_token_secret_grant USING btree (token_id)
    WHERE ((revoked_at IS NULL) AND (all_secrets IS TRUE));

CREATE UNIQUE INDEX integration_token_secret_grant_active_name_idx
    ON public.integration_token_secret_grant USING btree (token_id, secret_stable_name)
    WHERE ((revoked_at IS NULL) AND (all_secrets IS FALSE));

CREATE INDEX integration_token_secret_grant_component_idx
    ON public.integration_token_secret_grant USING btree (transferred_component_id)
    WHERE (revoked_at IS NULL);

ALTER TABLE ONLY public.integration_token_secret_grant
    ADD CONSTRAINT integration_token_secret_grant_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.admin_account(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.integration_token_secret_grant
    ADD CONSTRAINT integration_token_secret_grant_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.admin_account(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.integration_token_secret_grant
    ADD CONSTRAINT integration_token_secret_grant_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.integration_token(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_token_secret_grant
    ADD CONSTRAINT integration_token_secret_grant_transferred_component_id_fkey FOREIGN KEY (transferred_component_id) REFERENCES public.component(id) ON DELETE SET NULL;
