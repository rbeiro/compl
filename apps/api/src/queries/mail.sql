/* Internal mail. Rules (who may write to whom, drafts, revisions) live in
   compi_private.mail_read / mail_change. */

/* @name mailRead */
SELECT public.compi_mail_read(:h!, :box!, :page!, :item) AS "mail!";

/* @name mailChange */
SELECT public.compi_mail_change(:h!, :op!, :data!) AS "result!";
