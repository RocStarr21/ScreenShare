"use client";

import { Button, Input, Switch } from "@cap/ui";
import type { Video } from "@cap/web-domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, RotateCcw, ScanLine } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	getOwnerShareOptions,
	resetVideoThumbnail,
	setVideoThumbnail,
	updateVideoShareOptions,
} from "@/actions/videos/share-options";

const MAX_THUMBNAIL_EDGE = 1920;
const THUMBNAIL_QUALITY = 0.88;

const toJpeg = (source: CanvasImageSource, width: number, height: number) =>
	new Promise<Blob>((resolve, reject) => {
		const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const context = canvas.getContext("2d");
		if (!context) {
			reject(new Error("Could not prepare the image"));
			return;
		}
		context.drawImage(source, 0, 0, canvas.width, canvas.height);
		try {
			canvas.toBlob(
				(blob) =>
					blob
						? resolve(blob)
						: reject(new Error("Could not encode the image")),
				"image/jpeg",
				THUMBNAIL_QUALITY,
			);
		} catch {
			reject(
				new Error(
					"This frame can't be captured here. Upload an image instead.",
				),
			);
		}
	});

const fileToJpeg = async (file: File) => {
	if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
	const bitmap = await createImageBitmap(file);
	try {
		return await toJpeg(bitmap, bitmap.width, bitmap.height);
	} finally {
		bitmap.close();
	}
};

function Toggle({
	label,
	description,
	checked,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<div className="flex gap-4 justify-between items-start p-3 rounded-xl border border-gray-4 bg-gray-1">
			<div className="flex flex-col gap-0.5">
				<span className="text-sm font-medium text-gray-12">{label}</span>
				<span className="text-xs text-gray-10">{description}</span>
			</div>
			<Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
		</div>
	);
}

export function ShareOptions({ videoId }: { videoId: Video.VideoId }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [thumbnailVersion, setThumbnailVersion] = useState(0);

	const options = useQuery({
		queryKey: ["shareOptions", videoId],
		queryFn: () => getOwnerShareOptions(videoId),
	});

	const [ctaText, setCtaText] = useState("");
	const [ctaUrl, setCtaUrl] = useState("");
	const [emailGate, setEmailGate] = useState(false);
	const [allowDownload, setAllowDownload] = useState(false);

	useEffect(() => {
		if (!options.data) return;
		setCtaText(options.data.ctaText ?? "");
		setCtaUrl(options.data.ctaUrl ?? "");
		setEmailGate(options.data.emailGate);
		setAllowDownload(options.data.allowDownload);
	}, [options.data]);

	const thumbnail = useQuery({
		queryKey: ["shareThumbnail", videoId, thumbnailVersion],
		queryFn: async () => {
			const response = await fetch(
				`/api/thumbnail?videoId=${encodeURIComponent(videoId)}`,
			);
			if (!response.ok) return null;
			const body = (await response.json()) as { screen?: string };
			return body.screen ?? null;
		},
	});

	const save = useMutation({
		mutationFn: () =>
			updateVideoShareOptions(videoId, {
				ctaText,
				ctaUrl,
				emailGate,
				allowDownload,
			}),
		onSuccess: (saved) => {
			queryClient.setQueryData(["shareOptions", videoId], saved);
			toast.success("Share options saved");
			router.refresh();
		},
		onError: (error) => toast.error(error.message),
	});

	const uploadThumbnail = useMutation({
		mutationFn: async (blob: Blob) => {
			const form = new FormData();
			form.append("thumbnail", blob, "thumbnail.jpg");
			await setVideoThumbnail(videoId, form);
		},
		onSuccess: () => {
			toast.success("Thumbnail updated");
			setThumbnailVersion((v) => v + 1);
			queryClient.invalidateQueries({ queryKey: ["shareOptions", videoId] });
		},
		onError: (error) => toast.error(error.message),
	});

	const resetThumbnail = useMutation({
		mutationFn: () => resetVideoThumbnail(videoId),
		onSuccess: () => {
			toast.success("Original thumbnail restored");
			setThumbnailVersion((v) => v + 1);
			queryClient.invalidateQueries({ queryKey: ["shareOptions", videoId] });
		},
		onError: (error) => toast.error(error.message),
	});

	const captureCurrentFrame = async () => {
		const video = document.querySelector("video");
		if (!video || video.readyState < 2 || !video.videoWidth) {
			toast.error("Play the video to the frame you want first");
			return;
		}
		try {
			uploadThumbnail.mutate(
				await toJpeg(video, video.videoWidth, video.videoHeight),
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not capture the frame",
			);
		}
	};

	if (options.isLoading) {
		return <div className="p-4 h-40 animate-pulse bg-gray-2" />;
	}

	const thumbnailBusy = uploadThumbnail.isPending || resetThumbnail.isPending;

	return (
		<form
			className="flex flex-col gap-5 p-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<section className="flex flex-col gap-2">
				<h3 className="text-sm font-semibold text-gray-12">Call to action</h3>
				<p className="text-xs text-gray-10">
					A button under the video and on its last frame, like booking a call or
					opening a proposal. Clicks show up in Insights.
				</p>
				<Input
					value={ctaText}
					onChange={(e) => setCtaText(e.target.value)}
					placeholder="Button text, e.g. Book a call"
					maxLength={80}
					aria-label="Button text"
				/>
				<Input
					value={ctaUrl}
					onChange={(e) => setCtaUrl(e.target.value)}
					placeholder="Link, e.g. calendly.com/you"
					inputMode="url"
					aria-label="Button link"
				/>
			</section>

			<section className="flex flex-col gap-2">
				<h3 className="text-sm font-semibold text-gray-12">Viewer access</h3>
				<Toggle
					label="Ask for name and email"
					description="Viewers enter their details before watching, so Insights shows exactly who watched."
					checked={emailGate}
					onChange={setEmailGate}
				/>
				<Toggle
					label="Let viewers download"
					description="Anyone who can watch can also download the video."
					checked={allowDownload}
					onChange={setAllowDownload}
				/>
			</section>

			<Button
				type="submit"
				variant="dark"
				size="sm"
				spinner={save.isPending}
				disabled={save.isPending}
			>
				Save options
			</Button>

			<section className="flex flex-col gap-2">
				<h3 className="text-sm font-semibold text-gray-12">Thumbnail</h3>
				<div className="overflow-hidden relative rounded-xl border aspect-video border-gray-4 bg-gray-3">
					{thumbnail.data ? (
						<Image
							src={thumbnail.data}
							alt="Current thumbnail"
							fill
							unoptimized
							sizes="320px"
							className="object-cover"
						/>
					) : (
						<div className="flex justify-center items-center w-full h-full text-xs text-gray-10">
							No thumbnail yet
						</div>
					)}
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={async (event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (!file) return;
						try {
							uploadThumbnail.mutate(await fileToJpeg(file));
						} catch (error) {
							toast.error(
								error instanceof Error ? error.message : "Could not read image",
							);
						}
					}}
				/>
				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="white"
						size="xs"
						disabled={thumbnailBusy}
						onClick={() => fileInputRef.current?.click()}
					>
						<ImageUp className="mr-1.5 size-3.5" aria-hidden />
						Upload image
					</Button>
					<Button
						type="button"
						variant="white"
						size="xs"
						disabled={thumbnailBusy}
						onClick={captureCurrentFrame}
					>
						<ScanLine className="mr-1.5 size-3.5" aria-hidden />
						Use current frame
					</Button>
				</div>
				{options.data?.customThumbnail && (
					<Button
						type="button"
						variant="outline"
						size="xs"
						disabled={thumbnailBusy}
						onClick={() => resetThumbnail.mutate()}
					>
						<RotateCcw className="mr-1.5 size-3.5" aria-hidden />
						Restore original thumbnail
					</Button>
				)}
			</section>
		</form>
	);
}
