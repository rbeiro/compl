/* Schedules (horarios). Rules (who may see which department, who edits,
   45 leave days a year, revisions) live in compi_private.schedule_*. */

/* @name scheduleView */
SELECT public.compi_schedule_view(:h!, :monthStart!::date, :department) AS "view!";

/* @name scheduleEdit */
SELECT public.compi_schedule_edit(:h!, :employee!::uuid, :day!::date, :kind!, :startTime::time, :endTime::time, :previous::uuid);

/* @name scheduleBalance */
SELECT public.compi_schedule_balance(:h!, :employee!::uuid, :monthStart!::date, :minutes!::int, :previous::uuid);

/* @name scheduleRequest */
SELECT public.compi_schedule_request(:h!, :id!::uuid, :days!::date[]);

/* @name scheduleDecide */
SELECT public.compi_schedule_decide(:h!, :id!::uuid, :decision!);
