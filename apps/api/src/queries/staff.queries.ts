/** Types generated for queries found in "src/queries/staff.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type DateOrString = Date | string;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'ListStaff' parameters type */
export interface ListStaffParams {
  h: string;
}

/** 'ListStaff' return type */
export interface ListStaffResult {
  email: string;
  hasAccount: boolean;
  id: string;
  inviteRevision: string | null;
  inviteState: string | null;
  inviteUntil: Date | null;
  name: string;
  outlet: string;
  position: string;
  rank: number;
  withdrawnAt: string | null;
}

/** 'ListStaff' query type */
export interface ListStaffQuery {
  params: ListStaffParams;
  result: ListStaffResult;
}

const listStaffIR: any = {"usedParamSet":{"h":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":421,"b":423}]}],"statement":"SELECT id AS \"id!\", email AS \"email!\", employee_name AS \"name!\", position_name AS \"position!\",\n  outlet_name AS \"outlet!\", access_rank AS \"rank!\", user_id IS NOT NULL AS \"hasAccount!\",\n  to_char(withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS \"withdrawnAt\", invite_state AS \"inviteState\", invite_until AS \"inviteUntil\",\n  invite_revision AS \"inviteRevision\"\nFROM public.compi_staff\nWHERE hotel_key = :h!\nORDER BY employee_name"};

/**
 * Query generated from SQL:
 * ```
 * SELECT id AS "id!", email AS "email!", employee_name AS "name!", position_name AS "position!",
 *   outlet_name AS "outlet!", access_rank AS "rank!", user_id IS NOT NULL AS "hasAccount!",
 *   to_char(withdrawn_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "withdrawnAt", invite_state AS "inviteState", invite_until AS "inviteUntil",
 *   invite_revision AS "inviteRevision"
 * FROM public.compi_staff
 * WHERE hotel_key = :h!
 * ORDER BY employee_name
 * ```
 */
export const listStaff = new PreparedQuery<ListStaffParams,ListStaffResult>(listStaffIR);


/** 'RegisterEmployee' parameters type */
export interface RegisterEmployeeParams {
  givenName: string;
  h: string;
  outlet: string;
  position: string;
  rank: number;
  requestId: string;
  surname: string;
}

/** 'RegisterEmployee' return type */
export interface RegisterEmployeeResult {
  email: string;
}

/** 'RegisterEmployee' query type */
export interface RegisterEmployeeQuery {
  params: RegisterEmployeeParams;
  result: RegisterEmployeeResult;
}

const registerEmployeeIR: any = {"usedParamSet":{"h":true,"requestId":true,"givenName":true,"surname":true,"position":true,"outlet":true,"rank":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":38,"b":40}]},{"name":"requestId","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":53}]},{"name":"givenName","required":true,"transform":{"type":"scalar"},"locs":[{"a":62,"b":72}]},{"name":"surname","required":true,"transform":{"type":"scalar"},"locs":[{"a":75,"b":83}]},{"name":"position","required":true,"transform":{"type":"scalar"},"locs":[{"a":86,"b":95}]},{"name":"outlet","required":true,"transform":{"type":"scalar"},"locs":[{"a":98,"b":105}]},{"name":"rank","required":true,"transform":{"type":"scalar"},"locs":[{"a":108,"b":113}]}],"statement":"SELECT public.compi_register_employee(:h!, :requestId!::uuid, :givenName!, :surname!, :position!, :outlet!, :rank!::smallint) AS \"email!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_register_employee(:h!, :requestId!::uuid, :givenName!, :surname!, :position!, :outlet!, :rank!::smallint) AS "email!"
 * ```
 */
export const registerEmployee = new PreparedQuery<RegisterEmployeeParams,RegisterEmployeeResult>(registerEmployeeIR);


/** 'CreatedAccountTarget' parameters type */
export interface CreatedAccountTargetParams {
  id: string;
}

/** 'CreatedAccountTarget' return type */
export interface CreatedAccountTargetResult {
  email: string;
  hotelKey: string;
  inviteState: string | null;
  userId: string | null;
}

/** 'CreatedAccountTarget' query type */
export interface CreatedAccountTargetQuery {
  params: CreatedAccountTargetParams;
  result: CreatedAccountTargetResult;
}

const createdAccountTargetIR: any = {"usedParamSet":{"id":true},"params":[{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":138,"b":141}]}],"statement":"SELECT email AS \"email!\", hotel_key AS \"hotelKey!\", user_id AS \"userId\", invite_state AS \"inviteState\"\nFROM public.compi_staff WHERE id = :id!::uuid"};

/**
 * Query generated from SQL:
 * ```
 * SELECT email AS "email!", hotel_key AS "hotelKey!", user_id AS "userId", invite_state AS "inviteState"
 * FROM public.compi_staff WHERE id = :id!::uuid
 * ```
 */
export const createdAccountTarget = new PreparedQuery<CreatedAccountTargetParams,CreatedAccountTargetResult>(createdAccountTargetIR);


/** 'LinkCreatedAccount' parameters type */
export interface LinkCreatedAccountParams {
  creator: string;
  employee: string;
  uid: string;
}

/** 'LinkCreatedAccount' return type */
export interface LinkCreatedAccountResult {
  compi_link_created_account: undefined | null;
}

/** 'LinkCreatedAccount' query type */
export interface LinkCreatedAccountQuery {
  params: LinkCreatedAccountParams;
  result: LinkCreatedAccountResult;
}

const linkCreatedAccountIR: any = {"usedParamSet":{"employee":true,"uid":true,"creator":true},"params":[{"name":"employee","required":true,"transform":{"type":"scalar"},"locs":[{"a":41,"b":50}]},{"name":"uid","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":63}]},{"name":"creator","required":true,"transform":{"type":"scalar"},"locs":[{"a":72,"b":80}]}],"statement":"SELECT public.compi_link_created_account(:employee!::uuid, :uid!::uuid, :creator!::uuid)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_link_created_account(:employee!::uuid, :uid!::uuid, :creator!::uuid)
 * ```
 */
export const linkCreatedAccount = new PreparedQuery<LinkCreatedAccountParams,LinkCreatedAccountResult>(linkCreatedAccountIR);


/** 'ChangeRank' parameters type */
export interface ChangeRankParams {
  h: string;
  id: string;
  previous: number;
  rank: number;
}

/** 'ChangeRank' return type */
export interface ChangeRankResult {
  compi_staff_change: undefined | null;
}

/** 'ChangeRank' query type */
export interface ChangeRankQuery {
  params: ChangeRankParams;
  result: ChangeRankResult;
}

const changeRankIR: any = {"usedParamSet":{"h":true,"id":true,"rank":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":33,"b":35}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":71,"b":74}]},{"name":"rank","required":true,"transform":{"type":"scalar"},"locs":[{"a":91,"b":96}]},{"name":"previous","required":true,"transform":{"type":"scalar"},"locs":[{"a":116,"b":125}]}],"statement":"SELECT public.compi_staff_change(:h!, 'rank', jsonb_build_object('id', :id!::uuid, 'rank', :rank!::int, 'previous', :previous!::int))"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_staff_change(:h!, 'rank', jsonb_build_object('id', :id!::uuid, 'rank', :rank!::int, 'previous', :previous!::int))
 * ```
 */
export const changeRank = new PreparedQuery<ChangeRankParams,ChangeRankResult>(changeRankIR);


/** 'SetStaffAccess' parameters type */
export interface SetStaffAccessParams {
  enabled: boolean;
  expectedRank: number;
  h: string;
  id: string;
}

/** 'SetStaffAccess' return type */
export interface SetStaffAccessResult {
  compi_set_staff_access: undefined | null;
}

/** 'SetStaffAccess' query type */
export interface SetStaffAccessQuery {
  params: SetStaffAccessParams;
  result: SetStaffAccessResult;
}

const setStaffAccessIR: any = {"usedParamSet":{"h":true,"id":true,"enabled":true,"expectedRank":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":45}]},{"name":"enabled","required":true,"transform":{"type":"scalar"},"locs":[{"a":54,"b":62}]},{"name":"expectedRank","required":true,"transform":{"type":"scalar"},"locs":[{"a":74,"b":87}]}],"statement":"SELECT public.compi_set_staff_access(:h!, :id!::uuid, :enabled!::boolean, :expectedRank!::smallint)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_set_staff_access(:h!, :id!::uuid, :enabled!::boolean, :expectedRank!::smallint)
 * ```
 */
export const setStaffAccess = new PreparedQuery<SetStaffAccessParams,SetStaffAccessResult>(setStaffAccessIR);


/** 'DeleteWithdrawnEmployee' parameters type */
export interface DeleteWithdrawnEmployeeParams {
  h: string;
  id: string;
  withdrawal: DateOrString;
}

/** 'DeleteWithdrawnEmployee' return type */
export interface DeleteWithdrawnEmployeeResult {
  compi_delete_withdrawn_employee: undefined | null;
}

/** 'DeleteWithdrawnEmployee' query type */
export interface DeleteWithdrawnEmployeeQuery {
  params: DeleteWithdrawnEmployeeParams;
  result: DeleteWithdrawnEmployeeResult;
}

const deleteWithdrawnEmployeeIR: any = {"usedParamSet":{"h":true,"id":true,"withdrawal":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":46,"b":48}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":51,"b":54}]},{"name":"withdrawal","required":true,"transform":{"type":"scalar"},"locs":[{"a":63,"b":74}]}],"statement":"SELECT public.compi_delete_withdrawn_employee(:h!, :id!::uuid, :withdrawal!::timestamptz)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_delete_withdrawn_employee(:h!, :id!::uuid, :withdrawal!::timestamptz)
 * ```
 */
export const deleteWithdrawnEmployee = new PreparedQuery<DeleteWithdrawnEmployeeParams,DeleteWithdrawnEmployeeResult>(deleteWithdrawnEmployeeIR);


/** 'RemovePendingEmployee' parameters type */
export interface RemovePendingEmployeeParams {
  h: string;
  id: string;
}

/** 'RemovePendingEmployee' return type */
export interface RemovePendingEmployeeResult {
  compi_remove_pending_employee: undefined | null;
}

/** 'RemovePendingEmployee' query type */
export interface RemovePendingEmployeeQuery {
  params: RemovePendingEmployeeParams;
  result: RemovePendingEmployeeResult;
}

const removePendingEmployeeIR: any = {"usedParamSet":{"h":true,"id":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":44,"b":46}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":49,"b":52}]}],"statement":"SELECT public.compi_remove_pending_employee(:h!, :id!::uuid)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_remove_pending_employee(:h!, :id!::uuid)
 * ```
 */
export const removePendingEmployee = new PreparedQuery<RemovePendingEmployeeParams,RemovePendingEmployeeResult>(removePendingEmployeeIR);


/** 'ManageInvitation' parameters type */
export interface ManageInvitationParams {
  h: string;
  id: string;
  op: string;
  previous?: string | null | void;
}

/** 'ManageInvitation' return type */
export interface ManageInvitationResult {
  result: Json;
}

/** 'ManageInvitation' query type */
export interface ManageInvitationQuery {
  params: ManageInvitationParams;
  result: ManageInvitationResult;
}

const manageInvitationIR: any = {"usedParamSet":{"h":true,"id":true,"op":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":38,"b":40}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":43,"b":46}]},{"name":"op","required":true,"transform":{"type":"scalar"},"locs":[{"a":55,"b":58}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":61,"b":69}]}],"statement":"SELECT public.compi_manage_invitation(:h!, :id!::uuid, :op!, :previous::uuid) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_manage_invitation(:h!, :id!::uuid, :op!, :previous::uuid) AS "result!"
 * ```
 */
export const manageInvitation = new PreparedQuery<ManageInvitationParams,ManageInvitationResult>(manageInvitationIR);


/** 'ProvisionInvitationChannel' parameters type */
export interface ProvisionInvitationChannelParams {
  email: string;
  h: string;
  id: string;
  proofHash: string;
}

/** 'ProvisionInvitationChannel' return type */
export interface ProvisionInvitationChannelResult {
  compi_provision_lab_channel: undefined | null;
}

/** 'ProvisionInvitationChannel' query type */
export interface ProvisionInvitationChannelQuery {
  params: ProvisionInvitationChannelParams;
  result: ProvisionInvitationChannelResult;
}

const provisionInvitationChannelIR: any = {"usedParamSet":{"h":true,"id":true,"email":true,"proofHash":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":50}]},{"name":"email","required":true,"transform":{"type":"scalar"},"locs":[{"a":59,"b":65}]},{"name":"proofHash","required":true,"transform":{"type":"scalar"},"locs":[{"a":68,"b":78}]}],"statement":"SELECT public.compi_provision_lab_channel(:h!, :id!::uuid, :email!, :proofHash!)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_provision_lab_channel(:h!, :id!::uuid, :email!, :proofHash!)
 * ```
 */
export const provisionInvitationChannel = new PreparedQuery<ProvisionInvitationChannelParams,ProvisionInvitationChannelResult>(provisionInvitationChannelIR);


/** 'InvitationRevision' parameters type */
export interface InvitationRevisionParams {
  id: string;
}

/** 'InvitationRevision' return type */
export interface InvitationRevisionResult {
  revision: string | null;
}

/** 'InvitationRevision' query type */
export interface InvitationRevisionQuery {
  params: InvitationRevisionParams;
  result: InvitationRevisionResult;
}

const invitationRevisionIR: any = {"usedParamSet":{"id":true},"params":[{"name":"id","required":true,"transform":{"type":"scalar"},"locs":[{"a":72,"b":75}]}],"statement":"SELECT invite_revision AS \"revision\" FROM public.compi_staff WHERE id = :id!::uuid"};

/**
 * Query generated from SQL:
 * ```
 * SELECT invite_revision AS "revision" FROM public.compi_staff WHERE id = :id!::uuid
 * ```
 */
export const invitationRevision = new PreparedQuery<InvitationRevisionParams,InvitationRevisionResult>(invitationRevisionIR);


/** 'RelayInvitation' parameters type */
export interface RelayInvitationParams {
  email: string;
  proof: string;
  receipt?: string | null | void;
}

/** 'RelayInvitation' return type */
export interface RelayInvitationResult {
  result: Json;
}

/** 'RelayInvitation' query type */
export interface RelayInvitationQuery {
  params: RelayInvitationParams;
  result: RelayInvitationResult;
}

const relayInvitationIR: any = {"usedParamSet":{"email":true,"proof":true,"receipt":true},"params":[{"name":"email","required":true,"transform":{"type":"scalar"},"locs":[{"a":30,"b":36}]},{"name":"proof","required":true,"transform":{"type":"scalar"},"locs":[{"a":39,"b":45}]},{"name":"receipt","required":false,"transform":{"type":"scalar"},"locs":[{"a":48,"b":55}]}],"statement":"SELECT public.compi_lab_relay(:email!, :proof!, :receipt::uuid) AS \"result!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_lab_relay(:email!, :proof!, :receipt::uuid) AS "result!"
 * ```
 */
export const relayInvitation = new PreparedQuery<RelayInvitationParams,RelayInvitationResult>(relayInvitationIR);


