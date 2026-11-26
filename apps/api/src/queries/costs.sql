/* Recipe costing (escandallos) of the Hotel Arts catalog. Rank 1 only;
   validation and revisions live in compi_arts_save_recipe_cost. */

/* @name recipeCost */
SELECT public.compi_arts_recipe_cost(:h!, :o!, :g!) AS "cost!";

/* @name saveRecipeCost */
SELECT public.compi_arts_save_recipe_cost(:h!, :o!, :g!, :settings!, :previous::uuid) AS "revision!";

/* @name costOverview */
SELECT hotel_key AS "hotelKey!", outlet_key AS "outletKey!", guide_key AS "guideKey!", settings, ingredient_count AS "ingredientCount"
FROM public.compi_arts_cost_overview(:guides!);
