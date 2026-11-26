import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { ApiError, errorResponse } from "./http/errors.js";
import type { AppEnv, Deps } from "./http/types.js";
import { authRoutes } from "./routes/auth.js";
import { catalogRoutes } from "./routes/catalog.js";
import { guideRoutes } from "./routes/guides.js";
import { mailRoutes } from "./routes/mail.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { staffRoutes } from "./routes/staff.js";
import { costRoutes } from "./routes/costs.js";
import { editingRoutes } from "./routes/editing.js";
import { generatorRoutes } from "./routes/generator.js";
import { sessionRoutes } from "./routes/session.js";
import { systemRoutes } from "./routes/system.js";

export function createApp(deps: Deps) {
  const app = new OpenAPIHono<AppEnv>({
    // Request validation failures use the same error shape as everything else.
    defaultHook: (result, c) => {
      if (!result.success) {
        const fields = result.error.issues.map((i) => i.path.join(".") || "(root)").join(", ");
        return errorResponse(c, new ApiError(422, "invalid_request", "The request is not valid.", fields));
      }
    },
  });

  app.use("*", secureHeaders());
  app.use(
    "/v1/*",
    cors({
      origin: deps.config.corsOrigins,
      allowHeaders: ["Authorization", "Content-Type"],
      exposeHeaders: ["X-CompI-Brand-Revision", "X-CompI-Drive-Original"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Supabase Auth access token of the signed-in employee.",
  });

  systemRoutes(app, deps);
  authRoutes(app, deps);
  sessionRoutes(app, deps);
  catalogRoutes(app, deps);
  guideRoutes(app, deps);
  mailRoutes(app, deps);
  scheduleRoutes(app, deps);
  staffRoutes(app, deps);
  costRoutes(app, deps);
  editingRoutes(app, deps);
  generatorRoutes(app, deps);

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "CompI API",
      version: "1.0.0",
      description: "API for the CompI web and mobile apps. Authenticate with a Supabase Auth access token.",
    },
  });
  app.get("/docs", Scalar({ url: "/v1/openapi.json", pageTitle: "CompI API" }));

  app.notFound((c) => errorResponse(c, new ApiError(404, "not_found", "Not found.")));
  app.onError((error, c) => errorResponse(c, error));

  return app;
}

export type AppType = ReturnType<typeof createApp>;
