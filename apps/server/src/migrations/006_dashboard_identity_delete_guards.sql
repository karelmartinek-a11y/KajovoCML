CREATE FUNCTION public.dashboard_visual_node_before_integration_token_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.dashboard_visual_node
     SET lifecycle_phase = CASE WHEN component_id IS NULL THEN 'DELETED' ELSE lifecycle_phase END,
         deleted_at = CASE WHEN component_id IS NULL THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
         updated_at = now(),
         lock_version = lock_version + 1,
         metadata = metadata || jsonb_build_object(
           'integrationTokenHardDeletedAt', now(),
           'integrationTokenHardDeletedId', OLD.id
         )
   WHERE integration_token_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER dashboard_visual_node_integration_token_delete_guard
BEFORE DELETE ON public.integration_token
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_visual_node_before_integration_token_delete();

CREATE FUNCTION public.dashboard_visual_node_before_component_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.dashboard_visual_node
     SET lifecycle_phase = 'DELETED',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now(),
         lock_version = lock_version + 1,
         metadata = metadata || jsonb_build_object(
           'componentHardDeletedAt', now(),
           'componentHardDeletedId', OLD.id
         )
   WHERE component_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER dashboard_visual_node_component_delete_guard
BEFORE DELETE ON public.component
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_visual_node_before_component_delete();

CREATE FUNCTION public.dashboard_visual_node_before_principal_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.dashboard_visual_node
     SET lifecycle_phase = 'DELETED',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now(),
         lock_version = lock_version + 1,
         metadata = metadata || jsonb_build_object(
           'principalHardDeletedAt', now(),
           'principalHardDeletedId', OLD.id
         )
   WHERE principal_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER dashboard_visual_node_principal_delete_guard
BEFORE DELETE ON public.principal
FOR EACH ROW
EXECUTE FUNCTION public.dashboard_visual_node_before_principal_delete();
