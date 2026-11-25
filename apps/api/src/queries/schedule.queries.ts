/** Types generated for queries found in "src/queries/schedule.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type DateOrString = Date | string;

export type DateOrStringArray = (DateOrString)[];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'ScheduleView' parameters type */
export interface ScheduleViewParams {
  department?: string | null | void;
  h: string;
  monthStart: DateOrString;
}

/** 'ScheduleView' return type */
export interface ScheduleViewResult {
  view: Json;
}

/** 'ScheduleView' query type */
export interface ScheduleViewQuery {
  params: ScheduleViewParams;
  result: ScheduleViewResult;
}

const scheduleViewIR: any = {"usedParamSet":{"h":true,"monthStart":true,"department":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":34,"b":36}]},{"name":"monthStart","required":true,"transform":{"type":"scalar"},"locs":[{"a":39,"b":50}]},{"name":"department","required":false,"transform":{"type":"scalar"},"locs":[{"a":59,"b":69}]}],"statement":"SELECT public.compi_schedule_view(:h!, :monthStart!::date, :department) AS \"view!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_schedule_view(:h!, :monthStart!::date, :department) AS "view!"
 * ```
 */
export const scheduleView = new PreparedQuery<ScheduleViewParams,ScheduleViewResult>(scheduleViewIR);


/** 'ScheduleEdit' parameters type */
export interface ScheduleEditParams {
  day: DateOrString;
  employee: string;
  endTime?: DateOrString | null | void;
  h: string;
  kind: string;
  previous?: string | null | void;
  startTime?: DateOrString | null | void;
}

/** 'ScheduleEdit' return type */
export interface ScheduleEditResult {
  compi_schedule_edit: undefined | null;
}

/** 'ScheduleEdit' query type */
export interface ScheduleEditQuery {
  params: ScheduleEditParams;
  result: ScheduleEditResult;
}

const scheduleEditIR: any = {"usedParamSet":{"h":true,"employee":true,"day":true,"kind":true,"startTime":true,"endTime":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":34,"b":36}]},{"name":"employee","required":true,"transform":{"type":"scalar"},"locs":[{"a":39,"b":48}]},{"name":"day","required":true,"transform":{"type":"scalar"},"locs":[{"a":57,"b":61}]},{"name":"kind","required":true,"transform":{"type":"scalar"},"locs":[{"a":70,"b":75}]},{"name":"startTime","required":false,"transform":{"type":"scalar"},"locs":[{"a":78,"b":87}]},{"name":"endTime","required":false,"transform":{"type":"scalar"},"locs":[{"a":96,"b":103}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":112,"b":120}]}],"statement":"SELECT public.compi_schedule_edit(:h!, :employee!::uuid, :day!::date, :kind!, :startTime::time, :endTime::time, :previous::uuid)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_schedule_edit(:h!, :employee!::uuid, :day!::date, :kind!, :startTime::time, :endTime::time, :previous::uuid)
 * ```
 */
export const scheduleEdit = new PreparedQuery<ScheduleEditParams,ScheduleEditResult>(scheduleEditIR);


/** 'ScheduleBalance' parameters type */
export interface ScheduleBalanceParams {
  employee: string;
  h: string;
  minutes: number;
  monthStart: DateOrString;
  previous?: string | null | void;
}

/** 'ScheduleBalance' return type */
export interface ScheduleBalanceResult {
  compi_schedule_balance: undefined | null;
}

/** 'ScheduleBalance' query type */
export interface ScheduleBalanceQuery {
  params: ScheduleBalanceParams;
  result: ScheduleBalanceResult;
}

const scheduleBalanceIR: any = {"usedParamSet":{"h":true,"employee":true,"monthStart":true,"minutes":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"employee","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":51}]},{"name":"monthStart","required":true,"transform":{"type":"scalar"},"locs":[{"a":60,"b":71}]},{"name":"minutes","required":true,"transform":{"type":"scalar"},"locs":[{"a":80,"b":88}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":96,"b":104}]}],"statement":"SELECT public.compi_schedule_balance(:h!, :employee!::uuid, :monthStart!::date, :minutes!::int, :previous::uuid)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_schedule_balance(:h!, :employee!::uuid, :monthStart!::date, :minutes!::int, :previous::uuid)
 * ```
 */
export const scheduleBalance = new PreparedQuery<ScheduleBalanceParams,ScheduleBalanceResult>(scheduleBalanceIR);


/** 'ScheduleRequest' parameters type */
export interface ScheduleRequestParams {
  days: DateOrStringArray;
  h: string;
  id: string;
}

/** 'ScheduleRequest' return type */
export interface ScheduleRequestResult {
  compi_schedule_request: undefined | null;
}

/** 'ScheduleRequest' query type */
export interface ScheduleRequestQuery {
  params: ScheduleRequestParams;
  result: ScheduleRequestResult;
}

const scheduleRequestIR: any = {"usedParamSet":{"h":true,"id":true,"days":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":45}]},{"name":"days","required":true,"transform":{"type":"scalar"},"locs":[{"a":54,"b":59}]}],"statement":"SELECT public.compi_schedule_request(:h!, :id!::uuid, :days!::date[])"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_schedule_request(:h!, :id!::uuid, :days!::date[])
 * ```
 */
export const scheduleRequest = new PreparedQuery<ScheduleRequestParams,ScheduleRequestResult>(scheduleRequestIR);


/** 'ScheduleDecide' parameters type */
export interface ScheduleDecideParams {
  decision: string;
  h: string;
  id: string;
}

/** 'ScheduleDecide' return type */
export interface ScheduleDecideResult {
  compi_schedule_decide: undefined | null;
}

/** 'ScheduleDecide' query type */
export interface ScheduleDecideQuery {
  params: ScheduleDecideParams;
  result: ScheduleDecideResult;
}

const scheduleDecideIR: any = {"usedParamSet":{"h":true,"id":true,"decision":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":36,"b":38}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":44}]},{"name":"decision","required":true,"transform":{"type":"scalar"},"locs":[{"a":53,"b":62}]}],"statement":"SELECT public.compi_schedule_decide(:h!, :id!::uuid, :decision!)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_schedule_decide(:h!, :id!::uuid, :decision!)
 * ```
 */
export const scheduleDecide = new PreparedQuery<ScheduleDecideParams,ScheduleDecideResult>(scheduleDecideIR);


