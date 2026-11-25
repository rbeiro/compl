/** Types generated for queries found in "src/queries/auth.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'ActivateAccess' parameters type */
export type ActivateAccessParams = void;

/** 'ActivateAccess' return type */
export interface ActivateAccessResult {
  done: undefined | null;
}

/** 'ActivateAccess' query type */
export interface ActivateAccessQuery {
  params: ActivateAccessParams;
  result: ActivateAccessResult;
}

const activateAccessIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT public.compi_activate_access() AS \"done\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_activate_access() AS "done"
 * ```
 */
export const activateAccess = new PreparedQuery<ActivateAccessParams,ActivateAccessResult>(activateAccessIR);


/** 'IssueSecondFactor' parameters type */
export type IssueSecondFactorParams = void;

/** 'IssueSecondFactor' return type */
export interface IssueSecondFactorResult {
  code: string;
  email: string;
}

/** 'IssueSecondFactor' query type */
export interface IssueSecondFactorQuery {
  params: IssueSecondFactorParams;
  result: IssueSecondFactorResult;
}

const issueSecondFactorIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT email AS \"email!\", code AS \"code!\" FROM compi_private.second_factor_issue()"};

/**
 * Query generated from SQL:
 * ```
 * SELECT email AS "email!", code AS "code!" FROM compi_private.second_factor_issue()
 * ```
 */
export const issueSecondFactor = new PreparedQuery<IssueSecondFactorParams,IssueSecondFactorResult>(issueSecondFactorIR);


/** 'VerifySecondFactor' parameters type */
export interface VerifySecondFactorParams {
  code: string;
}

/** 'VerifySecondFactor' return type */
export interface VerifySecondFactorResult {
  status: string;
}

/** 'VerifySecondFactor' query type */
export interface VerifySecondFactorQuery {
  params: VerifySecondFactorParams;
  result: VerifySecondFactorResult;
}

const verifySecondFactorIR: any = {"usedParamSet":{"code":true},"params":[{"name":"code","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":46}]}],"statement":"SELECT public.compi_second_factor_verify(:code!) AS \"status!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_second_factor_verify(:code!) AS "status!"
 * ```
 */
export const verifySecondFactor = new PreparedQuery<VerifySecondFactorParams,VerifySecondFactorResult>(verifySecondFactorIR);


/** 'FinishPasswordChange' parameters type */
export type FinishPasswordChangeParams = void;

/** 'FinishPasswordChange' return type */
export interface FinishPasswordChangeResult {
  done: boolean;
}

/** 'FinishPasswordChange' query type */
export interface FinishPasswordChangeQuery {
  params: FinishPasswordChangeParams;
  result: FinishPasswordChangeResult;
}

const finishPasswordChangeIR: any = {"usedParamSet":{},"params":[],"statement":"SELECT public.compi_finish_password_change() AS \"done!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_finish_password_change() AS "done!"
 * ```
 */
export const finishPasswordChange = new PreparedQuery<FinishPasswordChangeParams,FinishPasswordChangeResult>(finishPasswordChangeIR);


/** 'PersonalBackup' parameters type */
export interface PersonalBackupParams {
  issue: boolean;
}

/** 'PersonalBackup' return type */
export interface PersonalBackupResult {
  result: Json;
}

/** 'PersonalBackup' query type */
export interface PersonalBackupQuery {
  params: PersonalBackupParams;
  result: PersonalBackupResult;
}

const personalBackupIR: any = {"usedParamSet":{"issue":true},"params":[{"name":"issue","required":true,"transform":{"type":"scalar"},"locs":[{"a":36,"b":42}]}],"statement":"SELECT public.compi_personal_backup(:issue!) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_personal_backup(:issue!) AS "result!"
 * ```
 */
export const personalBackup = new PreparedQuery<PersonalBackupParams,PersonalBackupResult>(personalBackupIR);


/** 'AllowAuthRequest' parameters type */
export interface AllowAuthRequestParams {
  client: string;
  endpoint: string;
}

/** 'AllowAuthRequest' return type */
export interface AllowAuthRequestResult {
  allowed: boolean;
}

/** 'AllowAuthRequest' query type */
export interface AllowAuthRequestQuery {
  params: AllowAuthRequestParams;
  result: AllowAuthRequestResult;
}

const allowAuthRequestIR: any = {"usedParamSet":{"endpoint":true,"client":true},"params":[{"name":"endpoint","required":true,"transform":{"type":"scalar"},"locs":[{"a":39,"b":48}]},{"name":"client","required":true,"transform":{"type":"scalar"},"locs":[{"a":51,"b":58}]}],"statement":"SELECT public.compi_allow_auth_request(:endpoint!, :client!) AS \"allowed!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_allow_auth_request(:endpoint!, :client!) AS "allowed!"
 * ```
 */
export const allowAuthRequest = new PreparedQuery<AllowAuthRequestParams,AllowAuthRequestResult>(allowAuthRequestIR);


/** 'BeginRecovery' parameters type */
export interface BeginRecoveryParams {
  address: string;
  code: string;
}

/** 'BeginRecovery' return type */
export interface BeginRecoveryResult {
  result: Json;
}

/** 'BeginRecovery' query type */
export interface BeginRecoveryQuery {
  params: BeginRecoveryParams;
  result: BeginRecoveryResult;
}

const beginRecoveryIR: any = {"usedParamSet":{"address":true,"code":true},"params":[{"name":"address","required":true,"transform":{"type":"scalar"},"locs":[{"a":35,"b":43}]},{"name":"code","required":true,"transform":{"type":"scalar"},"locs":[{"a":46,"b":51}]}],"statement":"SELECT public.compi_begin_recovery(:address!, :code!) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_begin_recovery(:address!, :code!) AS "result!"
 * ```
 */
export const beginRecovery = new PreparedQuery<BeginRecoveryParams,BeginRecoveryResult>(beginRecoveryIR);


/** 'ReleaseRecovery' parameters type */
export interface ReleaseRecoveryParams {
  lease: string;
  userId: string;
}

/** 'ReleaseRecovery' return type */
export interface ReleaseRecoveryResult {
  done: undefined | null;
}

/** 'ReleaseRecovery' query type */
export interface ReleaseRecoveryQuery {
  params: ReleaseRecoveryParams;
  result: ReleaseRecoveryResult;
}

const releaseRecoveryIR: any = {"usedParamSet":{"userId":true,"lease":true},"params":[{"name":"userId","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":44}]},{"name":"lease","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":53}]}],"statement":"SELECT public.compi_release_recovery(:userId!, :lease!) AS \"done\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_release_recovery(:userId!, :lease!) AS "done"
 * ```
 */
export const releaseRecovery = new PreparedQuery<ReleaseRecoveryParams,ReleaseRecoveryResult>(releaseRecoveryIR);


/** 'BeginAccept' parameters type */
export interface BeginAcceptParams {
  ticket: string;
}

/** 'BeginAccept' return type */
export interface BeginAcceptResult {
  result: Json;
}

/** 'BeginAccept' query type */
export interface BeginAcceptQuery {
  params: BeginAcceptParams;
  result: BeginAcceptResult;
}

const beginAcceptIR: any = {"usedParamSet":{"ticket":true},"params":[{"name":"ticket","required":true,"transform":{"type":"scalar"},"locs":[{"a":33,"b":40}]}],"statement":"SELECT public.compi_begin_accept(:ticket!) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_begin_accept(:ticket!) AS "result!"
 * ```
 */
export const beginAccept = new PreparedQuery<BeginAcceptParams,BeginAcceptResult>(beginAcceptIR);


