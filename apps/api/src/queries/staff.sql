/* Team management (legacy management.js). Every rule (rank 1 only, keep one
   administrator, revisions, address allocation) lives in the database.
   listStaff returns what RLS lets the caller see (rank 1: the whole hotel).
   createdAccountTarget, provisionInvitationChannel, invitationRevision and
   relayInvitation run with the service role: the invitation proof is derived
   on the server and only its hash is stored. */

/* @name listStaff */
SELECT id AS "id!", email AS "email!", employee_name AS "name!", position_name AS "position!",
  outlet_name AS "outlet!", access_rank AS "rank!", user_id IS NOT NULL AS "hasAccount!",
  to_char(withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "withdrawnAt", invite_state AS "inviteState", invite_until AS "inviteUntil",
  invite_revision AS "inviteRevision"
FROM public.compi_staff
WHERE hotel_key = :h!
ORDER BY employee_name;

/* @name registerEmployee */
SELECT public.compi_register_employee(:h!, :requestId!::uuid, :givenName!, :surname!, :position!, :outlet!, :rank!::smallint) AS "email!";

/* @name createdAccountTarget */
SELECT email AS "email!", hotel_key AS "hotelKey!", user_id AS "userId", invite_state AS "inviteState"
FROM public.compi_staff WHERE id = :id!::uuid;

/* @name linkCreatedAccount */
SELECT public.compi_link_created_account(:employee!::uuid, :uid!::uuid, :creator!::uuid);

/* @name changeRank */
SELECT public.compi_staff_change(:h!, 'rank', jsonb_build_object('id', :id!::uuid, 'rank', :rank!::int, 'previous', :previous!::int));

/* @name setStaffAccess */
SELECT public.compi_set_staff_access(:h!, :id!::uuid, :enabled!::boolean, :expectedRank!::smallint);

/* @name deleteWithdrawnEmployee */
SELECT public.compi_delete_withdrawn_employee(:h!, :id!::uuid, :withdrawal!::timestamptz);

/* @name removePendingEmployee */
SELECT public.compi_remove_pending_employee(:h!, :id!::uuid);

/* @name manageInvitation */
SELECT public.compi_manage_invitation(:h!, :id!::uuid, :op!, :previous::uuid) AS "result!";

/* @name provisionInvitationChannel */
SELECT public.compi_provision_lab_channel(:h!, :id!::uuid, :email!, :proofHash!);

/* @name invitationRevision */
SELECT invite_revision AS "revision" FROM public.compi_staff WHERE id = :id!::uuid;

/* @name relayInvitation */
SELECT public.compi_lab_relay(:email!, :proof!, :receipt::uuid) AS "result!";
