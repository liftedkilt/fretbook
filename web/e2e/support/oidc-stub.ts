import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import http from "node:http";

/**
 * A tiny OpenID Connect provider for the sign-in test: discovery, JWKS, an authorize page that signs the
 * browser in at once as whoever `signInAs` last named, and a token endpoint that checks PKCE and issues an
 * RS256 ID token. It stands in for Pocket ID; tests/test_oidc.py covers the same flow at the HTTP level.
 */
export type OidcStub = {
  issuer: string;
  clientId: string;
  /** The next browser to reach the authorize page is signed in as this person. */
  signInAs: (sub: string, name: string) => void;
  /** Every authorization request the stub received, as query objects. */
  authorizations: Record<string, string>[];
  stop: () => Promise<void>;
};

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export async function startOidcStub(
  port: number,
  clientId: string,
  redirectUri: string,
): Promise<OidcStub> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", use: "sig", alg: "RS256" };
  const issuer = `http://127.0.0.1:${port}`;
  const codes = new Map<string, { sub: string; name: string; nonce: string; challenge: string }>();
  const authorizations: Record<string, string>[] = [];
  let current = { sub: "alice", name: "Alice" };

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks.json`,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks.json") return json(res, 200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const query = Object.fromEntries(url.searchParams);
      authorizations.push(query);
      if (
        query.client_id !== clientId ||
        query.redirect_uri !== redirectUri ||
        query.code_challenge_method !== "S256"
      ) {
        return json(res, 400, { error: "invalid_request" });
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, { ...current, nonce: query.nonce, challenge: query.code_challenge });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", query.state);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(body));
        const grant = codes.get(form.code ?? "");
        codes.delete(form.code ?? "");
        const challenge = createHash("sha256")
          .update(form.code_verifier ?? "")
          .digest("base64url");
        if (
          !grant ||
          form.redirect_uri !== redirectUri ||
          form.client_id !== clientId ||
          challenge !== grant.challenge
        ) {
          return json(res, 400, { error: "invalid_grant" });
        }
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" }));
        const claims = b64url(
          JSON.stringify({
            iss: issuer,
            aud: clientId,
            sub: grant.sub,
            iat: now,
            exp: now + 300,
            nonce: grant.nonce,
            name: grant.name,
            email: `${grant.sub}@example.test`,
            groups: ["fretbook_users"],
          }),
        );
        const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey);
        json(res, 200, {
          access_token: "at",
          token_type: "Bearer",
          id_token: `${header}.${claims}.${b64url(signature)}`,
        });
      });
      return;
    }
    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    issuer,
    clientId,
    signInAs: (sub, name) => {
      current = { sub, name };
    },
    authorizations,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
