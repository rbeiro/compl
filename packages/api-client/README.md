# @compi/api-client

Typed client for the CompI API (`apps/api`), generated from its OpenAPI spec
with openapi-typescript and called through openapi-fetch. Works in Next.js and
React Native.

```ts
import { createApiClient } from "@compi/api-client";

const api = createApiClient({ baseUrl: API_URL, accessToken: () => session?.access_token });
const { data, error, response } = await api.GET("/v1/guides", { params: { query: { limit: 50 } } });
```

`openapi.json` and `src/schema.d.ts` are generated; do not edit them. After
changing API routes run `pnpm --filter @compi/api openapi:export`.
