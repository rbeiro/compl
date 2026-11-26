/* Recipe generator and document brand. Rules live in the database:
   compi_arts_generator_outlet (editors of the outlet), draft reservation,
   source revisions, and compi_commit_document_brand (rank 1, verified session).
   acuarelaMaster and assistantSettings run with the service role. */

/* @name generatorOutlet */
SELECT hotel AS "hotel!", outlet AS "outlet!" FROM public.compi_arts_generator_outlet(:h!, :o!);

/* @name reserveDraft */
SELECT public.compi_arts_reserve_generated_draft(:h!, :o!, :ticket!::uuid, :label!, :fingerprint!) AS "draft!";

/* @name saveGuideSource */
SELECT public.compi_arts_save_guide_source(:h!, :o!, :g!, :source!, :docx!, :pdf!, :previous::uuid) AS "revision!";

/* @name commitDocumentBrand */
SELECT public.compi_commit_document_brand(:h!, :accent!, :logo, :expectedRevision!::int, :sub!::uuid, :session!::uuid, :aal!) AS "brand!";

/* @name acuarelaMaster */
SELECT public.compi_acuarela_master() AS "png";

/* @name assistantSettings */
SELECT public.compi_assistant_settings() AS "settings!";
