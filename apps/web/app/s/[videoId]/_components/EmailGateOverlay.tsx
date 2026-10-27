"use client";

import { Button, Dialog, DialogContent, Input, Logo } from "@cap/ui";
import type { Video } from "@cap/web-domain";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { submitViewerDetails } from "@/actions/videos/share-options";

interface EmailGateOverlayProps {
	videoId: Video.VideoId;
	videoName: string;
	ownerName: string | null;
}

export const EmailGateOverlay = ({
	videoId,
	videoName,
	ownerName,
}: EmailGateOverlayProps) => {
	const nameId = useId();
	const emailId = useId();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const router = useRouter();

	const submit = useMutation({
		mutationFn: async () => {
			const result = await submitViewerDetails(videoId, { name, email });
			if (!result.success) throw new Error(result.message);
		},
		onSuccess: () => router.refresh(),
		onError: (error) => toast.error(error.message),
	});

	const canSubmit = name.trim().length > 0 && email.trim().length > 0;

	return (
		<Dialog open>
			<DialogContent className="w-[95vw] max-w-sm p-4 sm:p-6 md:p-8 sm:max-w-md">
				<form
					className="flex flex-col items-center space-y-4 sm:space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						if (canSubmit && !submit.isPending) submit.mutate();
					}}
				>
					<div className="flex flex-col items-center space-y-3 sm:space-y-4">
						<Logo className="w-16 sm:w-20 md:w-24 h-auto" />
						<div className="text-center space-y-2">
							<h2 className="text-lg sm:text-xl font-semibold text-gray-12">
								{videoName}
							</h2>
							<p className="text-xs sm:text-sm text-gray-10 max-w-xs sm:max-w-sm px-2 sm:px-0">
								{ownerName
									? `${ownerName} asks viewers to share their name and email before watching.`
									: "Share your name and email to watch this video."}
							</p>
						</div>
					</div>

					<div className="w-full space-y-3 sm:space-y-4">
						<div className="space-y-2">
							<label
								htmlFor={nameId}
								className="text-sm font-medium text-gray-12"
							>
								Name
							</label>
							<Input
								id={nameId}
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Your name"
								autoComplete="name"
								maxLength={120}
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<label
								htmlFor={emailId}
								className="text-sm font-medium text-gray-12"
							>
								Email
							</label>
							<Input
								id={emailId}
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="you@company.com"
								autoComplete="email"
								maxLength={255}
							/>
						</div>
						<Button
							type="submit"
							variant="dark"
							size="lg"
							className="w-full"
							spinner={submit.isPending}
							disabled={submit.isPending || !canSubmit}
						>
							Watch video
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
};
