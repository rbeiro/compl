/* Plating guides (Hotel Arts edition: compi_arts_* functions). */

/* @name workspaceGuide */
SELECT public.compi_arts_workspace_guide(:h!, :o!, :g!) AS "guide";

/* @name reviewGuide */
SELECT public.compi_arts_review_guide(:h!, :o!, :g!, :reviewed!) AS "reviewed!";

/* @name classifyGuide */
SELECT public.compi_arts_classify_guide(:h!, :o!, :g!, :kind, :category) AS "done";

/* @name fileAccess */
SELECT public.compi_arts_file_access(:h!, :o!, :g!, :fmt!, :editing!) AS "access!";

/* @name stageAccess */
SELECT public.compi_arts_stage_guide_access(:h!, :o!, :g!, :fmt!) AS "access!";

/* @name commitFile */
SELECT public.compi_arts_commit_file(:h!, :o!, :g!, :fmt!, :sha!, :previous) AS "done";

/* @name workspaceMedia */
SELECT public.compi_arts_workspace_media(:h!, :o!, :g!, :variant!) AS "media";

/* @name guideSource */
SELECT public.compi_arts_guide_source(:h!, :o!, :g!) AS "source";

/* @name documentBrand */
SELECT public.compi_document_brand(:h!) AS "brand!";

/* @name documentBrandRevision */
SELECT public.compi_document_brand_revision(:h!) AS "revision!";

/* @name imageLabels */
SELECT public.compi_arts_image_labels(:h!, :o!, :g!) AS "labels";

/* @name catalogChange */
SELECT public.compi_arts_catalog_change(:h!, :o!, :g!, :op!, :label!) AS "key";
