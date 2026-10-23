import { test as base, expect, request as playwrightRequest } from "@playwright/test";

import { startOidcStub, type OidcStub } from "./support/oidc-stub";
import { Seeder } from "./support/seed";
import { freePort, type RunningServer, startServer } from "./support/server";

const CLIENT_ID = "fretbook-e2e";

type Fixtures = { appPort: number; stub: OidcStub; server: RunningServer };

// A Fretbook server in OIDC mode and a stub provider it signs people in through.
const test = base.extend<Fixtures>({
  // The provider must know the app's callback URL before the app starts, so the port is chosen first.
  appPort: async ({}, use) => {
    await use(await freePort());
  },
  stub: async ({ appPort }, use) => {
    const stub = await startOidcStub(await freePort(), CLIENT_ID, `http://127.0.0.1:${appPort}/auth/callback`);
    try {
      await use(stub);
    } finally {
      await stub.stop();
    }
  },
  server: async ({ appPort, stub }, use) => {
    const server = await startServer({
      port: appPort,
      env: {
        FRETBOOK_AUTH_MODE: "oidc",
        FRETBOOK_OIDC_ISSUER: stub.issuer,
        FRETBOOK_OIDC_CLIENT_ID: CLIENT_ID,
        FRETBOOK_OIDC_REDIRECT_URI: `http://127.0.0.1:${appPort}/auth/callback`,
        FRETBOOK_SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
      },
    });
    try {
      await use(server);
    } finally {
      await server.stop();
    }
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});

test("sign in through the provider, and each person sees only their own songs", async ({ browser, server, stub }) => {
  // Without a session the API refuses, and a page request is sent to sign in.
  const anonymous = await playwrightRequest.newContext({ baseURL: server.url });
  expect((await anonymous.get("/api/songs")).status()).toBe(401);
  await anonymous.dispose();

  stub.signInAs("alice", "Alice Example");
  const alice = await browser.newContext({ baseURL: server.url });
  const alicePage = await alice.newPage();
  await alicePage.goto("/");
  // The redirect went through the provider's authorize endpoint with PKCE.
  expect(stub.authorizations).toHaveLength(1);
  expect(stub.authorizations[0]).toMatchObject({ response_type: "code", client_id: CLIENT_ID, code_challenge_method: "S256" });
  await expect(alicePage.getByTestId("library-empty")).toBeVisible();
  await alicePage.getByTestId("open-settings").click();
  await expect(alicePage.getByTestId("account-name")).toHaveText("Alice Example");
  await alicePage.keyboard.press("Escape");

  const aliceSeed = new Seeder(alicePage.request);
  await aliceSeed.chordSheet();
  await alicePage.reload();
  await expect(alicePage.getByTestId("song-title")).toHaveText("Sunny Day Blues");

  stub.signInAs("bob", "Bob Example");
  const bob = await browser.newContext({ baseURL: server.url });
  const bobPage = await bob.newPage();
  await bobPage.goto("/");
  await expect(bobPage.getByTestId("library-empty")).toBeVisible();
  await expect(bobPage.getByTestId("song-card")).toHaveCount(0);
  const bobSeed = new Seeder(bobPage.request);
  const bobSong = await bobSeed.musicXmlTab();
  await bobPage.reload();
  await expect(bobPage.getByTestId("song-title")).toHaveText("Practice Riff");

  // Alice still has only hers, and cannot open Bob's song by its address.
  await alicePage.reload();
  await expect(alicePage.getByTestId("song-card")).toHaveCount(1);
  await expect(alicePage.getByTestId("song-title")).toHaveText("Sunny Day Blues");
  expect((await alicePage.request.get(`/api/songs/${bobSong.id}`)).status()).toBe(404);

  await alice.close();
  await bob.close();
});
