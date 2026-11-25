/** Types generated for queries found in "src/queries/access.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

/** 'NeedsMfa' parameters type */
export type NeedsMfaParams = void;

/** 'NeedsMfa' return type */
export interface NeedsMfaResult {
  needsMfa: boolean;
}

/** 'NeedsMfa' query type */
export interface NeedsMfaQuery {
  params: NeedsMfaParams;
  result: NeedsMfaResult;
}

const needsMfaIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT public.compi_needs_mfa() AS \"needsMfa!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_needs_mfa() AS "needsMfa!"
 * ```
 */
export const needsMfa = new PreparedQuery<NeedsMfaParams,NeedsMfaResult>(needsMfaIR);


/** 'ListMyHotels' parameters type */
export type ListMyHotelsParams = void;

/** 'ListMyHotels' return type */
export interface ListMyHotelsResult {
  accessRank: number;
  hotelKey: string;
}

/** 'ListMyHotels' query type */
export interface ListMyHotelsQuery {
  params: ListMyHotelsParams;
  result: ListMyHotelsResult;
}

const listMyHotelsIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT hotel_key AS \"hotelKey!\", access_rank AS \"accessRank!\"\nFROM public.compi_my_access()"};

/**
 * Query generated from SQL:
 * ```
 * SELECT hotel_key AS "hotelKey!", access_rank AS "accessRank!"
 * FROM public.compi_my_access()
 * ```
 */
export const listMyHotels = new PreparedQuery<ListMyHotelsParams,ListMyHotelsResult>(listMyHotelsIR);


