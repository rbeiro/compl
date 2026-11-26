/** Types generated for queries found in "src/queries/guides.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'WorkspaceGuide' parameters type */
export interface WorkspaceGuideParams {
  g: string;
  h: string;
  o: string;
}

/** 'WorkspaceGuide' return type */
export interface WorkspaceGuideResult {
  guide: Json | null;
}

/** 'WorkspaceGuide' query type */
export interface WorkspaceGuideQuery {
  params: WorkspaceGuideParams;
  result: WorkspaceGuideResult;
}

const workspaceGuideIR: any = {"usedParamSet":{"h":true,"o":true,"g":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":43}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":46,"b":48}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":51,"b":53}]}],"statement":"SELECT public.compi_arts_workspace_guide(:h!, :o!, :g!) AS \"guide\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_workspace_guide(:h!, :o!, :g!) AS "guide"
 * ```
 */
export const workspaceGuide = new PreparedQuery<WorkspaceGuideParams,WorkspaceGuideResult>(workspaceGuideIR);


/** 'ReviewGuide' parameters type */
export interface ReviewGuideParams {
  g: string;
  h: string;
  o: string;
  reviewed: boolean;
}

/** 'ReviewGuide' return type */
export interface ReviewGuideResult {
  reviewed: boolean;
}

/** 'ReviewGuide' query type */
export interface ReviewGuideQuery {
  params: ReviewGuideParams;
  result: ReviewGuideResult;
}

const reviewGuideIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"reviewed":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":38,"b":40}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":45}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":48,"b":50}]},{"name":"reviewed","required":true,"transform":{"type":"scalar"},"locs":[{"a":53,"b":62}]}],"statement":"SELECT public.compi_arts_review_guide(:h!, :o!, :g!, :reviewed!) AS \"reviewed!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_review_guide(:h!, :o!, :g!, :reviewed!) AS "reviewed!"
 * ```
 */
export const reviewGuide = new PreparedQuery<ReviewGuideParams,ReviewGuideResult>(reviewGuideIR);


/** 'ClassifyGuide' parameters type */
export interface ClassifyGuideParams {
  category?: string | null | void;
  g: string;
  h: string;
  kind?: string | null | void;
  o: string;
}

/** 'ClassifyGuide' return type */
export interface ClassifyGuideResult {
  done: undefined | null;
}

/** 'ClassifyGuide' query type */
export interface ClassifyGuideQuery {
  params: ClassifyGuideParams;
  result: ClassifyGuideResult;
}

const classifyGuideIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"kind":true,"category":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":40,"b":42}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":45,"b":47}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":50,"b":52}]},{"name":"kind","required":false,"transform":{"type":"scalar"},"locs":[{"a":55,"b":59}]},{"name":"category","required":false,"transform":{"type":"scalar"},"locs":[{"a":62,"b":70}]}],"statement":"SELECT public.compi_arts_classify_guide(:h!, :o!, :g!, :kind, :category) AS \"done\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_classify_guide(:h!, :o!, :g!, :kind, :category) AS "done"
 * ```
 */
export const classifyGuide = new PreparedQuery<ClassifyGuideParams,ClassifyGuideResult>(classifyGuideIR);


/** 'FileAccess' parameters type */
export interface FileAccessParams {
  editing: boolean;
  fmt: string;
  g: string;
  h: string;
  o: string;
}

/** 'FileAccess' return type */
export interface FileAccessResult {
  access: Json;
}

/** 'FileAccess' query type */
export interface FileAccessQuery {
  params: FileAccessParams;
  result: FileAccessResult;
}

const fileAccessIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"fmt":true,"editing":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":49}]},{"name":"fmt","required":true,"transform":{"type":"scalar"},"locs":[{"a":52,"b":56}]},{"name":"editing","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":67}]}],"statement":"SELECT public.compi_arts_file_access(:h!, :o!, :g!, :fmt!, :editing!) AS \"access!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_file_access(:h!, :o!, :g!, :fmt!, :editing!) AS "access!"
 * ```
 */
export const fileAccess = new PreparedQuery<FileAccessParams,FileAccessResult>(fileAccessIR);


/** 'StageAccess' parameters type */
export interface StageAccessParams {
  fmt: string;
  g: string;
  h: string;
  o: string;
}

/** 'StageAccess' return type */
export interface StageAccessResult {
  access: Json;
}

/** 'StageAccess' query type */
export interface StageAccessQuery {
  params: StageAccessParams;
  result: StageAccessResult;
}

const stageAccessIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"fmt":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":44,"b":46}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":49,"b":51}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":54,"b":56}]},{"name":"fmt","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":63}]}],"statement":"SELECT public.compi_arts_stage_guide_access(:h!, :o!, :g!, :fmt!) AS \"access!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_stage_guide_access(:h!, :o!, :g!, :fmt!) AS "access!"
 * ```
 */
export const stageAccess = new PreparedQuery<StageAccessParams,StageAccessResult>(stageAccessIR);


/** 'CommitFile' parameters type */
export interface CommitFileParams {
  fmt: string;
  g: string;
  h: string;
  o: string;
  previous?: string | null | void;
  sha: string;
}

/** 'CommitFile' return type */
export interface CommitFileResult {
  done: undefined | null;
}

/** 'CommitFile' query type */
export interface CommitFileQuery {
  params: CommitFileParams;
  result: CommitFileResult;
}

const commitFileIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"fmt":true,"sha":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":49}]},{"name":"fmt","required":true,"transform":{"type":"scalar"},"locs":[{"a":52,"b":56}]},{"name":"sha","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":63}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":66,"b":74}]}],"statement":"SELECT public.compi_arts_commit_file(:h!, :o!, :g!, :fmt!, :sha!, :previous) AS \"done\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_commit_file(:h!, :o!, :g!, :fmt!, :sha!, :previous) AS "done"
 * ```
 */
export const commitFile = new PreparedQuery<CommitFileParams,CommitFileResult>(commitFileIR);


/** 'WorkspaceMedia' parameters type */
export interface WorkspaceMediaParams {
  g: string;
  h: string;
  o: string;
  variant: string;
}

/** 'WorkspaceMedia' return type */
export interface WorkspaceMediaResult {
  media: Json | null;
}

/** 'WorkspaceMedia' query type */
export interface WorkspaceMediaQuery {
  params: WorkspaceMediaParams;
  result: WorkspaceMediaResult;
}

const workspaceMediaIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"variant":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":43}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":46,"b":48}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":51,"b":53}]},{"name":"variant","required":true,"transform":{"type":"scalar"},"locs":[{"a":56,"b":64}]}],"statement":"SELECT public.compi_arts_workspace_media(:h!, :o!, :g!, :variant!) AS \"media\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_workspace_media(:h!, :o!, :g!, :variant!) AS "media"
 * ```
 */
export const workspaceMedia = new PreparedQuery<WorkspaceMediaParams,WorkspaceMediaResult>(workspaceMediaIR);


/** 'GuideSource' parameters type */
export interface GuideSourceParams {
  g: string;
  h: string;
  o: string;
}

/** 'GuideSource' return type */
export interface GuideSourceResult {
  source: Json | null;
}

/** 'GuideSource' query type */
export interface GuideSourceQuery {
  params: GuideSourceParams;
  result: GuideSourceResult;
}

const guideSourceIR: any = {"usedParamSet":{"h":true,"o":true,"g":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":38,"b":40}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":45}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":48,"b":50}]}],"statement":"SELECT public.compi_arts_guide_source(:h!, :o!, :g!) AS \"source\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_guide_source(:h!, :o!, :g!) AS "source"
 * ```
 */
export const guideSource = new PreparedQuery<GuideSourceParams,GuideSourceResult>(guideSourceIR);


/** 'DocumentBrand' parameters type */
export interface DocumentBrandParams {
  h: string;
}

/** 'DocumentBrand' return type */
export interface DocumentBrandResult {
  brand: Json;
}

/** 'DocumentBrand' query type */
export interface DocumentBrandQuery {
  params: DocumentBrandParams;
  result: DocumentBrandResult;
}

const documentBrandIR: any = {"usedParamSet":{"h":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":35,"b":37}]}],"statement":"SELECT public.compi_document_brand(:h!) AS \"brand!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_document_brand(:h!) AS "brand!"
 * ```
 */
export const documentBrand = new PreparedQuery<DocumentBrandParams,DocumentBrandResult>(documentBrandIR);


/** 'DocumentBrandRevision' parameters type */
export interface DocumentBrandRevisionParams {
  h: string;
}

/** 'DocumentBrandRevision' return type */
export interface DocumentBrandRevisionResult {
  revision: number;
}

/** 'DocumentBrandRevision' query type */
export interface DocumentBrandRevisionQuery {
  params: DocumentBrandRevisionParams;
  result: DocumentBrandRevisionResult;
}

const documentBrandRevisionIR: any = {"usedParamSet":{"h":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":44,"b":46}]}],"statement":"SELECT public.compi_document_brand_revision(:h!) AS \"revision!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_document_brand_revision(:h!) AS "revision!"
 * ```
 */
export const documentBrandRevision = new PreparedQuery<DocumentBrandRevisionParams,DocumentBrandRevisionResult>(documentBrandRevisionIR);


/** 'ImageLabels' parameters type */
export interface ImageLabelsParams {
  g: string;
  h: string;
  o: string;
}

/** 'ImageLabels' return type */
export interface ImageLabelsResult {
  labels: Json | null;
}

/** 'ImageLabels' query type */
export interface ImageLabelsQuery {
  params: ImageLabelsParams;
  result: ImageLabelsResult;
}

const imageLabelsIR: any = {"usedParamSet":{"h":true,"o":true,"g":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":38,"b":40}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":45}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":48,"b":50}]}],"statement":"SELECT public.compi_arts_image_labels(:h!, :o!, :g!) AS \"labels\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_image_labels(:h!, :o!, :g!) AS "labels"
 * ```
 */
export const imageLabels = new PreparedQuery<ImageLabelsParams,ImageLabelsResult>(imageLabelsIR);


/** 'CatalogChange' parameters type */
export interface CatalogChangeParams {
  g: string;
  h: string;
  label: string;
  o: string;
  op: string;
}

/** 'CatalogChange' return type */
export interface CatalogChangeResult {
  key: string | null;
}

/** 'CatalogChange' query type */
export interface CatalogChangeQuery {
  params: CatalogChangeParams;
  result: CatalogChangeResult;
}

const catalogChangeIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"op":true,"label":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":40,"b":42}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":45,"b":47}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":50,"b":52}]},{"name":"op","required":true,"transform":{"type":"scalar"},"locs":[{"a":55,"b":58}]},{"name":"label","required":true,"transform":{"type":"scalar"},"locs":[{"a":61,"b":67}]}],"statement":"SELECT public.compi_arts_catalog_change(:h!, :o!, :g!, :op!, :label!) AS \"key\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_catalog_change(:h!, :o!, :g!, :op!, :label!) AS "key"
 * ```
 */
export const catalogChange = new PreparedQuery<CatalogChangeParams,CatalogChangeResult>(catalogChangeIR);


