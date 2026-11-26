/** Types generated for queries found in "src/queries/generator.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'GeneratorOutlet' parameters type */
export interface GeneratorOutletParams {
  h: string;
  o: string;
}

/** 'GeneratorOutlet' return type */
export interface GeneratorOutletResult {
  hotel: string;
  outlet: string;
}

/** 'GeneratorOutlet' query type */
export interface GeneratorOutletQuery {
  params: GeneratorOutletParams;
  result: GeneratorOutletResult;
}

const generatorOutletIR: any = {"usedParamSet":{"h":true,"o":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":86,"b":88}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":91,"b":93}]}],"statement":"SELECT hotel AS \"hotel!\", outlet AS \"outlet!\" FROM public.compi_arts_generator_outlet(:h!, :o!)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT hotel AS "hotel!", outlet AS "outlet!" FROM public.compi_arts_generator_outlet(:h!, :o!)
 * ```
 */
export const generatorOutlet = new PreparedQuery<GeneratorOutletParams,GeneratorOutletResult>(generatorOutletIR);


/** 'ReserveDraft' parameters type */
export interface ReserveDraftParams {
  fingerprint: string;
  h: string;
  label: string;
  o: string;
  ticket: string;
}

/** 'ReserveDraft' return type */
export interface ReserveDraftResult {
  draft: Json;
}

/** 'ReserveDraft' query type */
export interface ReserveDraftQuery {
  params: ReserveDraftParams;
  result: ReserveDraftResult;
}

const reserveDraftIR: any = {"usedParamSet":{"h":true,"o":true,"ticket":true,"label":true,"fingerprint":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":49,"b":51}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":54,"b":56}]},{"name":"ticket","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":66}]},{"name":"label","required":true,"transform":{"type":"scalar"},"locs":[{"a":75,"b":81}]},{"name":"fingerprint","required":true,"transform":{"type":"scalar"},"locs":[{"a":84,"b":96}]}],"statement":"SELECT public.compi_arts_reserve_generated_draft(:h!, :o!, :ticket!::uuid, :label!, :fingerprint!) AS \"draft!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_reserve_generated_draft(:h!, :o!, :ticket!::uuid, :label!, :fingerprint!) AS "draft!"
 * ```
 */
export const reserveDraft = new PreparedQuery<ReserveDraftParams,ReserveDraftResult>(reserveDraftIR);


/** 'SaveGuideSource' parameters type */
export interface SaveGuideSourceParams {
  docx: string;
  g: string;
  h: string;
  o: string;
  pdf: string;
  previous?: string | null | void;
  source: Json;
}

/** 'SaveGuideSource' return type */
export interface SaveGuideSourceResult {
  revision: string;
}

/** 'SaveGuideSource' query type */
export interface SaveGuideSourceQuery {
  params: SaveGuideSourceParams;
  result: SaveGuideSourceResult;
}

const saveGuideSourceIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"source":true,"docx":true,"pdf":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":45}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":48,"b":50}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":53,"b":55}]},{"name":"source","required":true,"transform":{"type":"scalar"},"locs":[{"a":58,"b":65}]},{"name":"docx","required":true,"transform":{"type":"scalar"},"locs":[{"a":68,"b":73}]},{"name":"pdf","required":true,"transform":{"type":"scalar"},"locs":[{"a":76,"b":80}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":83,"b":91}]}],"statement":"SELECT public.compi_arts_save_guide_source(:h!, :o!, :g!, :source!, :docx!, :pdf!, :previous::uuid) AS \"revision!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_save_guide_source(:h!, :o!, :g!, :source!, :docx!, :pdf!, :previous::uuid) AS "revision!"
 * ```
 */
export const saveGuideSource = new PreparedQuery<SaveGuideSourceParams,SaveGuideSourceResult>(saveGuideSourceIR);


/** 'CommitDocumentBrand' parameters type */
export interface CommitDocumentBrandParams {
  aal: string;
  accent: string;
  expectedRevision: number;
  h: string;
  logo?: string | null | void;
  session: string;
  sub: string;
}

/** 'CommitDocumentBrand' return type */
export interface CommitDocumentBrandResult {
  brand: Json;
}

/** 'CommitDocumentBrand' query type */
export interface CommitDocumentBrandQuery {
  params: CommitDocumentBrandParams;
  result: CommitDocumentBrandResult;
}

const commitDocumentBrandIR: any = {"usedParamSet":{"h":true,"accent":true,"logo":true,"expectedRevision":true,"sub":true,"session":true,"aal":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"accent","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":54}]},{"name":"logo","required":false,"transform":{"type":"scalar"},"locs":[{"a":57,"b":61}]},{"name":"expectedRevision","required":true,"transform":{"type":"scalar"},"locs":[{"a":64,"b":81}]},{"name":"sub","required":true,"transform":{"type":"scalar"},"locs":[{"a":89,"b":93}]},{"name":"session","required":true,"transform":{"type":"scalar"},"locs":[{"a":102,"b":110}]},{"name":"aal","required":true,"transform":{"type":"scalar"},"locs":[{"a":119,"b":123}]}],"statement":"SELECT public.compi_commit_document_brand(:h!, :accent!, :logo, :expectedRevision!::int, :sub!::uuid, :session!::uuid, :aal!) AS \"brand!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_commit_document_brand(:h!, :accent!, :logo, :expectedRevision!::int, :sub!::uuid, :session!::uuid, :aal!) AS "brand!"
 * ```
 */
export const commitDocumentBrand = new PreparedQuery<CommitDocumentBrandParams,CommitDocumentBrandResult>(commitDocumentBrandIR);


/** 'AcuarelaMaster' parameters type */
export type AcuarelaMasterParams = void;

/** 'AcuarelaMaster' return type */
export interface AcuarelaMasterResult {
  png: string | null;
}

/** 'AcuarelaMaster' query type */
export interface AcuarelaMasterQuery {
  params: AcuarelaMasterParams;
  result: AcuarelaMasterResult;
}

const acuarelaMasterIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT public.compi_acuarela_master() AS \"png\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_acuarela_master() AS "png"
 * ```
 */
export const acuarelaMaster = new PreparedQuery<AcuarelaMasterParams,AcuarelaMasterResult>(acuarelaMasterIR);


/** 'AssistantSettings' parameters type */
export type AssistantSettingsParams = void;

/** 'AssistantSettings' return type */
export interface AssistantSettingsResult {
  settings: Json;
}

/** 'AssistantSettings' query type */
export interface AssistantSettingsQuery {
  params: AssistantSettingsParams;
  result: AssistantSettingsResult;
}

const assistantSettingsIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT public.compi_assistant_settings() AS \"settings!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_assistant_settings() AS "settings!"
 * ```
 */
export const assistantSettings = new PreparedQuery<AssistantSettingsParams,AssistantSettingsResult>(assistantSettingsIR);


