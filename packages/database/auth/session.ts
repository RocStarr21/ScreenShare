import { Organisation, User } from "@cap/web-domain";
import { and, eq, type InferSelectModel, ne } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "../";
import { nanoId } from "../helpers";
import { organizationMembers, organizations, users } from "../schema";
import { authOptions } from "./auth-options";
import {
	ACCESS_JWT_COOKIE,
	ACCESS_JWT_HEADER,
	type AccessIdentity,
	verifyAccessJwt,
} from "./cloudflare-access";

const fallbackOwnerEmail = "owner@screenshare.local";
const localOwnerName = "ScreenShare Owner";
const localOrganizationName = "RocStarr ScreenShare";

/**
 * The owner account's email address.
 *
 * This is what unifies the three ways into the app. The localhost bypass, a
 * Cloudflare Access assertion, and an emailed sign-in code all have to resolve
 * to the *same* account, or signing in through one of them drops you into an
 * empty library while your recordings sit on another account. NextAuth matches
 * accounts by email, so pointing the owner account at the real address is what
 * makes the email route land on the existing library.
 */
export function localOwnerEmailAddress() {
	return (
		process.env.SCREENSHARE_OWNER_EMAIL?.trim().toLowerCase() ||
		fallbackOwnerEmail
	);
}

async function getOrCreateLocalOwner() {
	const localUserId = User.UserId.make("screenshareuser");
	const localOrganizationId = Organisation.OrganisationId.make("screenshareorg");
	const localOwnerEmail = localOwnerEmailAddress();

	return db().transaction(async (tx) => {
		// Look the owner up by its well-known id first, so that changing
		// SCREENSHARE_OWNER_EMAIL renames the existing account instead of
		// silently provisioning a second, empty one alongside it.
		const [ownerById] = await tx
			.select()
			.from(users)
			.where(eq(users.id, localUserId))
			.limit(1);

		const [ownerByEmail] = ownerById
			? [undefined]
			: await tx
					.select()
					.from(users)
					.where(eq(users.email, localOwnerEmail))
					.limit(1);

		const existingUser = ownerById ?? ownerByEmail;

		const userId = existingUser?.id ?? localUserId;

		if (existingUser && existingUser.email !== localOwnerEmail) {
			// users.email is UNIQUE. If a separate account already holds the
			// address — e.g. an empty one created by signing in with an emailed
			// code before this was configured — renaming would throw and take the
			// whole dashboard down, so leave the owner alone and let the operator
			// merge the two deliberately.
			const [conflict] = await tx
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.email, localOwnerEmail), ne(users.id, userId)))
				.limit(1);

			if (conflict) {
				console.warn(
					`[screenshare] Owner account ${userId} was not renamed to ${localOwnerEmail}: account ${conflict.id} already uses that address.`,
				);
			} else {
				await tx
					.update(users)
					.set({ email: localOwnerEmail })
					.where(eq(users.id, userId));
			}
		}

		if (!existingUser) {
			await tx.insert(users).values({
				id: userId,
				email: localOwnerEmail,
				name: localOwnerName,
				activeOrganizationId: localOrganizationId,
				defaultOrgId: localOrganizationId,
				onboardingSteps: {
					welcome: true,
					organizationSetup: true,
					customDomain: true,
					inviteTeam: true,
					download: true,
				},
				onboarding_completed_at: new Date(),
			});
		} else if (
			!existingUser.activeOrganizationId ||
			!existingUser.defaultOrgId ||
			!existingUser.name
		) {
			await tx
				.update(users)
				.set({
					name: existingUser.name || localOwnerName,
					activeOrganizationId:
						existingUser.activeOrganizationId ?? localOrganizationId,
					defaultOrgId: existingUser.defaultOrgId ?? localOrganizationId,
				})
				.where(eq(users.id, userId));
		}

		const [existingOrganization] = await tx
			.select({ id: organizations.id })
			.from(organizations)
			.where(eq(organizations.id, localOrganizationId))
			.limit(1);

		if (!existingOrganization) {
			await tx.insert(organizations).values({
				id: localOrganizationId,
				name: localOrganizationName,
				ownerId: userId,
			});
		}

		const [existingMember] = await tx
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, userId),
					eq(organizationMembers.organizationId, localOrganizationId),
				),
			)
			.limit(1);

		if (!existingMember) {
			await tx.insert(organizationMembers).values({
				id: "screenshowner",
				userId,
				organizationId: localOrganizationId,
				role: "owner",
				hasProSeat: true,
			});
		}

		const [currentUser] = await tx
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		return currentUser ?? null;
	});
}

/**
 * Provisions the account for a team member who signed in through Cloudflare
 * Access. They land in the same organization as the owner so recordings,
 * spaces and comments are shared, but as a `member` rather than an owner.
 */
async function getOrCreateAccessMember(email: string) {
	const localOrganizationId = Organisation.OrganisationId.make("screenshareorg");
	const normalizedEmail = email.trim().toLowerCase();
	const displayName =
		normalizedEmail
			.split("@")[0]
			?.replace(/[._-]+/g, " ")
			.trim() || normalizedEmail;

	return db().transaction(async (tx) => {
		const [existingUser] = await tx
			.select()
			.from(users)
			.where(eq(users.email, normalizedEmail))
			.limit(1);

		const userId = existingUser?.id ?? User.UserId.make(nanoId());

		if (!existingUser) {
			await tx.insert(users).values({
				id: userId,
				email: normalizedEmail,
				name: displayName,
				emailVerified: new Date(),
				activeOrganizationId: localOrganizationId,
				defaultOrgId: localOrganizationId,
				onboardingSteps: {
					welcome: true,
					organizationSetup: true,
					customDomain: true,
					inviteTeam: true,
					download: true,
				},
				onboarding_completed_at: new Date(),
			});
		}

		const [existingMember] = await tx
			.select({ id: organizationMembers.id })
			.from(organizationMembers)
			.where(
				and(
					eq(organizationMembers.userId, userId),
					eq(organizationMembers.organizationId, localOrganizationId),
				),
			)
			.limit(1);

		if (!existingMember) {
			await tx.insert(organizationMembers).values({
				id: nanoId(),
				userId,
				organizationId: localOrganizationId,
				role: "member",
				hasProSeat: true,
			});
		}

		const [currentUser] = await tx
			.select()
			.from(users)
			.where(eq(users.id, userId))
			.limit(1);

		return currentUser ?? null;
	});
}

/**
 * True when this request arrived directly on the machine running the stack
 * rather than through the public tunnel. cloudflared forwards the original
 * `Host`, so a tunnelled request never looks local.
 */
async function requestIsLocal(): Promise<boolean> {
	const extraHosts = (process.env.SCREENSHARE_LOCAL_HOSTS ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	try {
		const host = (await headers()).get("host")?.toLowerCase();
		if (!host) return false;

		// Strip the port, and the brackets IPv6 literals arrive wrapped in.
		const hostname = host
			.replace(/:\d+$/, "")
			.replace(/^\[/, "")
			.replace(/\]$/, "");

		return (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1" ||
			extraHosts.includes(hostname)
		);
	} catch {
		// No request scope (build-time render, background job) — treat as public
		// so the owner bypass can never leak into a rendered public page.
		return false;
	}
}

/** Verified Cloudflare Access identity for this request, if there is one. */
export async function getAccessIdentity(): Promise<AccessIdentity | null> {
	try {
		// The header is only present on destinations Access evaluates. On bypassed
		// ones — the share page's media routes — the cookie is the only identity
		// the request carries.
		const token =
			(await headers()).get(ACCESS_JWT_HEADER) ??
			(await cookies()).get(ACCESS_JWT_COOKIE)?.value ??
			null;

		return await verifyAccessJwt(token);
	} catch {
		return null;
	}
}

/**
 * Maps a verified Access identity onto an account. The email named by
 * `SCREENSHARE_OWNER_EMAIL` resolves to the same owner account the localhost
 * bypass uses, so the library looks identical whether the owner opens the app
 * on this machine or through the public URL.
 */
async function getUserForAccessIdentity(identity: AccessIdentity) {
	const ownerEmail = process.env.SCREENSHARE_OWNER_EMAIL?.trim().toLowerCase();

	if (ownerEmail && identity.email === ownerEmail) {
		return getOrCreateLocalOwner();
	}

	return getOrCreateAccessMember(identity.email);
}

export const getSession = async () => {
	const session = await getServerSession(authOptions());

	return session;
};

export const getCurrentUser = cache(
	async (): Promise<InferSelectModel<typeof users> | null> => {
		// A verified Access assertion wins: it is the only identity that is
		// meaningful on a public hostname, and it is what gives team members
		// their own accounts.
		const accessIdentity = await getAccessIdentity();
		if (accessIdentity) return getUserForAccessIdentity(accessIdentity);

		// The passwordless owner bypass is deliberately restricted to requests
		// that did not come through the tunnel. Without the host check, publishing
		// the app would hand every visitor an owner session.
		if (
			process.env.SCREENSHARE_DISABLE_AUTH === "true" &&
			(await requestIsLocal())
		) {
			return getOrCreateLocalOwner();
		}

		const session = await getServerSession(authOptions());

		if (!session) return null;

		const [currentUser] = await db()
			.select()
			.from(users)
			.where(eq(users.id, User.UserId.make(session.user.id)));

		return currentUser ?? null;
	},
);

export const userSelectProps = users.$inferSelect;
