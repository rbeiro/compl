/** Types generated for queries found in "src/queries/costs.sql" */
import { PreparedQuery } from '@pgtyped/runtime';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** 'RecipeCost' parameters type */
export interface RecipeCostParams {
  g: string;
  h: string;
  o: string;
}

/** 'RecipeCost' return type */
export interface RecipeCostResult {
  cost: Json;
}

/** 'RecipeCost' query type */
export interface RecipeCostQuery {
  params: RecipeCostParams;
  result: RecipeCostResult;
}

const recipeCostIR: any = {"usedParamSet":{"h":true,"o":true,"g":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":37,"b":39}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":49}]}],"statement":"SELECT public.compi_arts_recipe_cost(:h!, :o!, :g!) AS \"cost!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_recipe_cost(:h!, :o!, :g!) AS "cost!"
 * ```
 */
export const recipeCost = new PreparedQuery<RecipeCostParams,RecipeCostResult>(recipeCostIR);


/** 'SaveRecipeCost' parameters type */
export interface SaveRecipeCostParams {
  g: string;
  h: string;
  o: string;
  previous?: string | null | void;
  settings: Json;
}

/** 'SaveRecipeCost' return type */
export interface SaveRecipeCostResult {
  revision: string;
}

/** 'SaveRecipeCost' query type */
export interface SaveRecipeCostQuery {
  params: SaveRecipeCostParams;
  result: SaveRecipeCostResult;
}

const saveRecipeCostIR: any = {"usedParamSet":{"h":true,"o":true,"g":true,"settings":true,"previous":true},"params":[{"name":"h","required":true,"transform":{"type":"scalar"},"locs":[{"a":42,"b":44}]},{"name":"o","required":true,"transform":{"type":"scalar"},"locs":[{"a":47,"b":49}]},{"name":"g","required":true,"transform":{"type":"scalar"},"locs":[{"a":52,"b":54}]},{"name":"settings","required":true,"transform":{"type":"scalar"},"locs":[{"a":57,"b":66}]},{"name":"previous","required":false,"transform":{"type":"scalar"},"locs":[{"a":69,"b":77}]}],"statement":"SELECT public.compi_arts_save_recipe_cost(:h!, :o!, :g!, :settings!, :previous::uuid) AS \"revision!\""};

/**
 * Query generated from SQL:
 * ```
 * SELECT public.compi_arts_save_recipe_cost(:h!, :o!, :g!, :settings!, :previous::uuid) AS "revision!"
 * ```
 */
export const saveRecipeCost = new PreparedQuery<SaveRecipeCostParams,SaveRecipeCostResult>(saveRecipeCostIR);


/** 'CostOverview' parameters type */
export interface CostOverviewParams {
  guides: Json;
}

/** 'CostOverview' return type */
export interface CostOverviewResult {
  guideKey: string;
  hotelKey: string;
  ingredientCount: number | null;
  outletKey: string;
  settings: Json | null;
}

/** 'CostOverview' query type */
export interface CostOverviewQuery {
  params: CostOverviewParams;
  result: CostOverviewResult;
}

const costOverviewIR: any = {"usedParamSet":{"guides":true},"params":[{"name":"guides","required":true,"transform":{"type":"scalar"},"locs":[{"a":172,"b":179}]}],"statement":"SELECT hotel_key AS \"hotelKey!\", outlet_key AS \"outletKey!\", guide_key AS \"guideKey!\", settings, ingredient_count AS \"ingredientCount\"\nFROM public.compi_arts_cost_overview(:guides!)"};

/**
 * Query generated from SQL:
 * ```
 * SELECT hotel_key AS "hotelKey!", outlet_key AS "outletKey!", guide_key AS "guideKey!", settings, ingredient_count AS "ingredientCount"
 * FROM public.compi_arts_cost_overview(:guides!)
 * ```
 */
export const costOverview = new PreparedQuery<CostOverviewParams,CostOverviewResult>(costOverviewIR);


