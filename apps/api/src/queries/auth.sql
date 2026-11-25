/*
  Sign-in steps, two-step codes, password change, recovery and invitations.
  Rules live in the database functions; these queries only call them.
*/

/* @name activateAccess */
SELECT public.compi_activate_access() AS "done";

/* @name issueSecondFactor */
SELECT email AS "email!", code AS "code!" FROM compi_private.second_factor_issue();

/* @name verifySecondFactor */
SELECT public.compi_second_factor_verify(:code!) AS "status!";

/* @name finishPasswordChange */
SELECT public.compi_finish_password_change() AS "done!";

/* @name personalBackup */
SELECT public.compi_personal_backup(:issue!) AS "result!";

/* @name allowAuthRequest */
SELECT public.compi_allow_auth_request(:endpoint!, :client!) AS "allowed!";

/* @name beginRecovery */
SELECT public.compi_begin_recovery(:address!, :code!) AS "result!";

/* @name releaseRecovery */
SELECT public.compi_release_recovery(:userId!, :lease!) AS "done";

/* @name beginAccept */
SELECT public.compi_begin_accept(:ticket!) AS "result!";
