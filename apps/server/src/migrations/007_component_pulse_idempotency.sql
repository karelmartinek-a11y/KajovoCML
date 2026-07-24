CREATE UNIQUE INDEX component_operation_lease_pulse_correlation_unique
    ON public.component_operation_lease (target_component_id, correlation_id, operation_kind)
    WHERE operation_kind = 'PULSE';

CREATE UNIQUE INDEX component_operation_event_pulse_correlation_unique
    ON public.component_operation_event (component_id, correlation_id, direction, operation_key)
    WHERE pulse_type IS NOT NULL AND direction IS NOT NULL;
