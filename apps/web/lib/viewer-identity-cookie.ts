import "server-only";

import { decrypt, encrypt } from "@cap/database/crypto";
import { cookies } from "next/headers";
import { isValidViewerEmail } from "./video-insights";

const COOKIE_NAME = "x-ss-viewer";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export type ViewerIdentity = { name: string; email: string };

export async function getViewerIdentity(): Promise<ViewerIdentity | null> {
	const value = (await cookies()).get(COOKIE_NAME)?.value;
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(await decrypt(value));
		if (
			parsed &&
			typeof parsed === "object" &&
			"name" in parsed &&
			"email" in parsed &&
			typeof parsed.name === "string" &&
			typeof parsed.email === "string" &&
			isValidViewerEmail(parsed.email)
		) {
			return { name: parsed.name, email: parsed.email };
		}
	} catch {
		return null;
	}
	return null;
}

export async function setViewerIdentity(identity: ViewerIdentity) {
	(await cookies()).set(
		COOKIE_NAME,
		await encrypt(
			JSON.stringify({
				name: identity.name.trim().slice(0, 120),
				email: identity.email.trim().toLowerCase(),
			}),
		),
		{
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: ONE_YEAR_SECONDS,
		},
	);
}
