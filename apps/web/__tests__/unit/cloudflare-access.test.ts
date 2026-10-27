import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	accessIsConfigured,
	accessTeamDomain,
	verifyAccessJwt,
} from "@cap/database/auth/cloudflare-access";

/**
 * A verified Cloudflare Access assertion is what lets ScreenShare publish the
 * dashboard on a public hostname at all: it is the app's only source of
 * identity there, and the localhost owner bypass is deliberately unavailable.
 * A hole here would hand an owner or team-member session to anyone who can
 * reach the origin, so the rejection cases matter more than the happy path.
 */

const TEAM = "rocstarrmedia.cloudflareaccess.com";
const AUD = "aud-tag-1234567890abcdef";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
});
const attackerKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

const signingJwk = {
	...(publicKey.export({ format: "jwk" }) as Record<string, unknown>),
	kid: "test-kid",
	alg: "RS256",
};

const encode = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

const now = () => Math.floor(Date.now() / 1000);

function signToken(
	payload: Record<string, unknown>,
	options: { kid?: string; alg?: string; key?: crypto.KeyObject } = {},
) {
	const header = {
		alg: options.alg ?? "RS256",
		kid: options.kid ?? "test-kid",
		typ: "JWT",
	};
	const signingInput = `${encode(header)}.${encode(payload)}`;
	const signature = crypto.sign(
		"RSA-SHA256",
		Buffer.from(signingInput),
		options.key ?? privateKey,
	);

	return `${signingInput}.${signature.toString("base64url")}`;
}

const validPayload = () => ({
	iss: `https://${TEAM}`,
	aud: [AUD],
	email: "Team.Member@Example.com",
	sub: "sub-123",
	iat: now() - 10,
	exp: now() + 3600,
});

describe("cloudflare access token verification", () => {
	beforeEach(() => {
		process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = TEAM;
		process.env.CLOUDFLARE_ACCESS_AUD = AUD;

		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url !== `https://${TEAM}/cdn-cgi/access/certs`) {
					throw new Error(`unexpected fetch: ${url}`);
				}
				return {
					ok: true,
					status: 200,
					json: async () => ({ keys: [signingJwk] }),
				} as unknown as Response;
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("accepts a genuine assertion and normalises the email", async () => {
		const identity = await verifyAccessJwt(signToken(validPayload()));

		expect(identity).toEqual({
			email: "team.member@example.com",
			subject: "sub-123",
		});
	});

	it("expands a bare team name to the full Access domain", () => {
		process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = "rocstarrmedia";
		expect(accessTeamDomain()).toBe(TEAM);
		expect(accessIsConfigured()).toBe(true);
	});

	it.each([
		["a missing token", null],
		["a malformed token", "not-a-jwt"],
	])("rejects %s", async (_label, token) => {
		expect(await verifyAccessJwt(token)).toBeNull();
	});

	it("rejects a token minted for another Access application", async () => {
		const token = signToken({ ...validPayload(), aud: ["someone-elses-app"] });
		expect(await verifyAccessJwt(token)).toBeNull();
	});

	it("rejects a token from another Zero Trust team", async () => {
		const token = signToken({
			...validPayload(),
			iss: "https://attacker.cloudflareaccess.com",
		});
		expect(await verifyAccessJwt(token)).toBeNull();
	});

	it("rejects expired and not-yet-valid tokens", async () => {
		expect(
			await verifyAccessJwt(signToken({ ...validPayload(), exp: now() - 120 })),
		).toBeNull();
		expect(
			await verifyAccessJwt(signToken({ ...validPayload(), nbf: now() + 600 })),
		).toBeNull();
	});

	it("rejects a signature from a key Cloudflare does not publish", async () => {
		const token = signToken(validPayload(), { key: attackerKey.privateKey });
		expect(await verifyAccessJwt(token)).toBeNull();
	});

	it("rejects an unknown signing key id", async () => {
		expect(
			await verifyAccessJwt(signToken(validPayload(), { kid: "other-kid" })),
		).toBeNull();
	});

	it("rejects an alg:none downgrade", async () => {
		const token = `${encode({ alg: "none", kid: "test-kid" })}.${encode(
			validPayload(),
		)}.`;
		expect(await verifyAccessJwt(token)).toBeNull();
	});

	it("rejects a payload swapped onto a valid signature", async () => {
		const [header, , signature] = signToken(validPayload()).split(".");
		const tampered = `${header}.${encode({
			...validPayload(),
			email: "attacker@evil.com",
		})}.${signature}`;

		expect(await verifyAccessJwt(tampered)).toBeNull();
	});

	it("fails closed when Access is not configured", async () => {
		const token = signToken(validPayload());

		process.env.CLOUDFLARE_ACCESS_AUD = "";
		expect(await verifyAccessJwt(token)).toBeNull();

		process.env.CLOUDFLARE_ACCESS_AUD = AUD;
		process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN = "";
		expect(await verifyAccessJwt(token)).toBeNull();
	});
});
