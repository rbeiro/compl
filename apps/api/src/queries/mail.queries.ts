/** Types generated for queries found in "src/queries/mail.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'MailRead' parameters type */
export interface MailReadParams {
  box: string;
  h: string;
  item?: string | null | void;
  page: number;
}

/** 'MailRead' return type */
export interface MailReadResult {
  mail: Json;
}

/** 'MailRead' query type */
export interface MailReadQuery {
  params: MailReadParams;
  result: MailReadResult;
}

const mailReadIR: any = {"usedParamSet":{"h":true,"box":true,"page":true,"item":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":30,"b":32}]},{"name":"box","required":true,"transform":{"type":"scalar"},"locs":[{"a":35,"b":39}]},{"name":"page","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":47}]},{"name":"item","required":false,"transform":{"type":"scalar"},"locs":[{"a":50,"b":54}]}],"statement":"SELECT public.compi_mail_read(:h!, :box!, :page!, :item) AS \"mail!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_mail_read(:h!, :box!, :page!, :item) AS "mail!"
 * ```
 */
export const mailRead = new PreparedQuery<MailReadParams,MailReadResult>(mailReadIR);


/** 'MailChange' parameters type */
export interface MailChangeParams {
  data: Json;
  h: string;
  op: string;
}

/** 'MailChange' return type */
export interface MailChangeResult {
  result: Json;
}

/** 'MailChange' query type */
export interface MailChangeQuery {
  params: MailChangeParams;
  result: MailChangeResult;
}

const mailChangeIR: any = {"usedParamSet":{"h":true,"op":true,"data":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":32,"b":34}]},{"name":"op","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":40}]},{"name":"data","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":48}]}],"statement":"SELECT public.compi_mail_change(:h!, :op!, :data!) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_mail_change(:h!, :op!, :data!) AS "result!"
 * ```
 */
export const mailChange = new PreparedQuery<MailChangeParams,MailChangeResult>(mailChangeIR);


