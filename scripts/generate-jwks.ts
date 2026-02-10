#!/usr/bin/env bun
/**
 * Generate an EC P-384 key pair for signing OAuth client assertions.
 * Writes:
 *   data/jwks.json       — public-only JWKS (served at .well-known/jwks.json)
 *   data/jwks-intentionally-publishing-private-keys-which-are-not-sensitive-in-this-architecture.json
 *                         — full JWKS including private key "d" parameter
 *
 * The private key is NOT secret for this use case: it ships to end-user
 * browsers that sign client_assertion JWTs for confidential-client OAuth.
 */
import { generateKeyPairSync, randomUUID } from "crypto";
import { mkdirSync, writeFileSync, existsSync } from "fs";

const outDir = "./data";
const pubPath = `${outDir}/jwks.json`;
const fullPath = `${outDir}/jwks-intentionally-publishing-private-keys-which-are-not-sensitive-in-this-architecture.json`;

if (existsSync(fullPath)) {
  console.log(`${fullPath} already exists — skipping generation.`);
  console.log("Delete it first if you want to rotate keys.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-384",
});

const kid = randomUUID();

const privJwk = {
  ...privateKey.export({ format: "jwk" }),
  kid,
  alg: "ES384",
  use: "sig",
  key_ops: ["sign"],
};

const pubJwk = { ...privJwk };
delete (pubJwk as any).d; // strip private component
pubJwk.key_ops = ["verify"];

const fullJwks = { keys: [privJwk] };
const pubJwks = { keys: [pubJwk] };

writeFileSync(pubPath, JSON.stringify(pubJwks, null, 2) + "\n");
writeFileSync(fullPath, JSON.stringify(fullJwks, null, 2) + "\n");

console.log(`Generated EC P-384 key pair (kid: ${kid})`);
console.log(`  Full (with private key): ${fullPath}`);
console.log(`  Public only:             ${pubPath}`);
