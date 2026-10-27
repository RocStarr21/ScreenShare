"use client";

import { Switch } from "@cap/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeftIcon } from "lucide-react";
import {
	RECORDING_QUALITY_OPTIONS,
	type RecordingQuality,
} from "./useRecorderOptions";

interface SettingsPanelProps {
	open: boolean;
	rememberDevices: boolean;
	onClose: () => void;
	onRememberDevicesChange: (value: boolean) => void;
	countdown: boolean;
	onCountdownChange: (value: boolean) => void;
	noiseFilter: boolean;
	onNoiseFilterChange: (value: boolean) => void;
	quality: RecordingQuality;
	onQualityChange: (value: RecordingQuality) => void;
	speakerNotes: string;
	onSpeakerNotesChange: (value: string) => void;
	disabled?: boolean;
}

const SettingRow = ({
	title,
	description,
	checked,
	onChange,
	disabled,
}: {
	title: string;
	description: string;
	checked: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) => (
	<div className="flex gap-4 justify-between items-start p-3 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
		<div className="flex flex-col gap-1 text-left">
			<p className="text-sm font-medium text-gray-12">{title}</p>
			<p className="text-xs text-gray-10">{description}</p>
		</div>
		<Switch
			checked={checked}
			onCheckedChange={onChange}
			disabled={disabled}
			aria-label={title}
		/>
	</div>
);

export const SettingsPanel = ({
	open,
	rememberDevices,
	onClose,
	onRememberDevicesChange,
	countdown,
	onCountdownChange,
	noiseFilter,
	onNoiseFilterChange,
	quality,
	onQualityChange,
	speakerNotes,
	onSpeakerNotesChange,
	disabled = false,
}: SettingsPanelProps) => {
	return (
		<AnimatePresence mode="wait">
			{open && (
				<motion.div
					key="web-recorder-settings"
					initial={{ opacity: 0, y: -12 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -12 }}
					transition={{ duration: 0.2, ease: "easeOut" }}
					className="absolute inset-0 z-40 flex flex-col gap-4 p-4 overflow-y-auto border border-gray-3 rounded-lg bg-gray-1 shadow-lg dark:bg-gray-2"
				>
					<div className="flex shrink-0 items-center justify-between">
						<button
							type="button"
							onClick={onClose}
							className="flex items-center gap-1 text-sm font-medium text-gray-11 transition-colors hover:text-gray-12"
						>
							<ArrowLeftIcon className="size-4" />
							Back
						</button>
						<h2 className="text-sm font-semibold text-gray-12">
							Recorder settings
						</h2>
						<span className="w-9 h-9" aria-hidden />
					</div>
					<div className="flex shrink-0 flex-col gap-3 pb-1 [&>*]:shrink-0">
						<div className="flex gap-4 justify-between items-start p-4 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
							<div className="flex flex-col gap-1 text-left">
								<p className="text-sm font-medium text-gray-12">
									Automatically select your last webcam/microphone
								</p>
								<p className="text-xs text-gray-10">
									If available, the last used camera and mic will be
									automatically selected.
								</p>
							</div>
							<Switch
								checked={rememberDevices}
								onCheckedChange={onRememberDevicesChange}
								aria-label="Remember selected devices"
							/>
						</div>
						<SettingRow
							title="Recording countdown"
							description="Count down 3, 2, 1 after you pick what to share."
							checked={countdown}
							onChange={onCountdownChange}
							disabled={disabled}
						/>
						<SettingRow
							title="Noise filter"
							description="Reduce background noise from your microphone."
							checked={noiseFilter}
							onChange={onNoiseFilterChange}
							disabled={disabled}
						/>
						<label className="flex flex-col gap-1.5 p-3 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
							<span className="text-sm font-medium text-gray-12">
								Recording quality
							</span>
							<select
								value={quality}
								disabled={disabled}
								onChange={(event) =>
									onQualityChange(event.target.value as RecordingQuality)
								}
								className="px-2 h-9 text-sm rounded-lg border border-gray-4 bg-gray-2 text-gray-12"
							>
								{RECORDING_QUALITY_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<span className="text-xs text-gray-10">
								Your screen is captured at up to this size.
							</span>
						</label>
						<label className="flex flex-col gap-1.5 p-3 text-left rounded-xl border border-gray-3 bg-gray-1 dark:bg-gray-3">
							<span className="text-sm font-medium text-gray-12">
								Speaker notes
							</span>
							<textarea
								value={speakerNotes}
								onChange={(event) => onSpeakerNotesChange(event.target.value)}
								rows={4}
								placeholder="Talking points to keep in view while you record"
								className="p-2 text-sm rounded-lg border resize-y border-gray-4 bg-gray-2 text-gray-12"
							/>
							<span className="text-xs text-gray-10">
								Shown on the recording bar in this tab. Anything on the screen
								you share is recorded, so record a different tab or window.
							</span>
						</label>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
};
