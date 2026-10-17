import { osduSource } from "@ikhmalputra/subsurface-core/osdu";
import type { WellDataSource } from "@ikhmalputra/subsurface-core/data-contract";
import type { SourceConfig } from "@ikhmalputra/subsurface-core/deck-config";
import type { GuardAuth } from "@ikhmalputra/subsurface-core/fetch-guard";

/**
 * A configured OSDU source, bound to the deck: its URL resolved beside the deck when it is a path
 * (a reverse proxy to the platform), and its sign-in taken from the named auth profile. Until the
 * deck can sign in (the OIDC phase), a source with no profile sends no token, which is right for a
 * proxy that adds one.
 */
export type TokenProvider = (profile: string) => GuardAuth | null;
let tokens: TokenProvider = () => null;
/** Installed by the sign-in module once it exists; every OSDU source then asks it for its profile's token. */
export const provideTokens = (provider: TokenProvider) => { tokens = provider; };

export function osduAdapter(id: string, config: Extract<SourceConfig, { type: "osdu" }>, base: string): WellDataSource {
  const auth = config.auth ? tokens(config.auth) : null;
  return osduSource({
    id, ...(config.label ? { label: config.label } : {}), // Absolute when it names a scheme: the config parser admits only https, or http on this machine (a mock).
    baseUrl: /^[a-z][a-z0-9+.-]*:/i.test(config.url) ? config.url : `${base}${config.url.replace(/^\.?\//, "")}`,
    dataPartition: config.dataPartition, ...(auth ? { auth } : {}), ...(config.paths ? { paths: config.paths } : {}), ...(config.kinds ? { kinds: config.kinds } : {}), ...(config.query ? { query: config.query } : {}),
  });
}
