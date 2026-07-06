-- Structured columns now carry daily project-cost details.
-- Clear legacy encoded labels so new reports and audits no longer depend on them.

update public.project_costs
set label = null
where work_date is not null
  and label like 'يومي:%';
