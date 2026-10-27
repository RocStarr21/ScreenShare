import {
	LogitsProcessor,
	LogitsProcessorList,
	pipeline,
	TextStreamer,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";

const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const TIME_PRECISION = 0.02;

// The _timestamped exports carry the decoder cross-attentions that word-level
// alignment needs; word timings must stay fp32 on the decoder outputs.
const MODEL_IDS = {
	tiny: "onnx-community/whisper-tiny_timestamped",
	base: "onnx-community/whisper-base_timestamped",
	small: "onnx-community/whisper-small_timestamped",
};
const MODEL_LABELS = {
	tiny: "Whisper Tiny",
	base: "Whisper Base",
	small: "Whisper Small",
};
const DTYPES = {
	webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
	wasm: { encoder_model: "q8", decoder_model_merged: "q8" },
};

let devicePromise = null;
const pipelines = new Map();
let emitCurrent = () => undefined;

const detectDevice = () => {
	devicePromise ??= (async () => {
		if (!navigator.gpu) return "wasm";
		try {
			return (await navigator.gpu.requestAdapter()) ? "webgpu" : "wasm";
		} catch {
			return "wasm";
		}
	})();
	return devicePromise;
};

const megabytes = (bytes) => (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0);

function downloadReporter(label) {
	const files = new Map();
	let fraction = 0;
	let lastSent = -1;
	let lastTime = 0;
	let fetching = false;
	let finished = false;
	const track = (file, loaded, total) => {
		if (Number.isFinite(total) && total > 0) {
			files.set(file, { loaded: Number.isFinite(loaded) ? loaded : 0, total });
		}
	};
	return (info) => {
		switch (info.status) {
			case "download":
				fetching = true;
				return;
			case "progress_total":
				for (const [file, p] of Object.entries(info.files)) {
					track(file, p.loaded, p.total);
				}
				break;
			case "progress":
				track(info.file, info.loaded, info.total);
				break;
			case "done": {
				const p = files.get(info.file);
				if (p) p.loaded = p.total;
				break;
			}
			case "ready":
				emitCurrent({ stage: "load", progress: 1, message: `${label} ready` });
				return;
			default:
				return;
		}
		if (finished) return;
		let loaded = 0;
		let total = 0;
		for (const p of files.values()) {
			loaded += Math.min(p.loaded, p.total);
			total += p.total;
		}
		if (total <= 0) return;
		fraction = Math.max(fraction, Math.min(1, loaded / total));
		const now = Date.now();
		if (fraction < 1 && fraction - lastSent < 0.005 && now - lastTime < 250) {
			return;
		}
		lastSent = fraction;
		lastTime = now;
		const pct = `${Math.round(fraction * 100)}%`;
		emitCurrent({
			stage: "download",
			progress: fraction,
			message: fetching
				? `Downloading ${label}… ${pct} (${megabytes(loaded)} / ${megabytes(total)} MB)`
				: `Loading ${label} from cache… ${pct}`,
		});
		if (fraction >= 1) {
			finished = true;
			emitCurrent({
				stage: "load",
				progress: 0,
				message: `Starting ${label}…`,
			});
		}
	};
}

function loadPipeline(model, device) {
	const key = `${model}:${device}`;
	let pending = pipelines.get(key);
	if (!pending) {
		const label = `${MODEL_LABELS[model]} (${device === "webgpu" ? "GPU" : "CPU"})`;
		emitCurrent({
			stage: "download",
			progress: 0,
			message: `Preparing ${label}…`,
		});
		pending = pipeline("automatic-speech-recognition", MODEL_IDS[model], {
			device,
			dtype: DTYPES[device],
			progress_callback: downloadReporter(label),
		});
		pipelines.set(key, pending);
		pending.catch(() => pipelines.delete(key));
	}
	return pending;
}

async function getPipeline(model) {
	const device = await detectDevice();
	try {
		return await loadPipeline(model, device);
	} catch (error) {
		if (device !== "webgpu") throw error;
		console.warn("device-transcribe: WebGPU failed, using CPU", error);
		devicePromise = Promise.resolve("wasm");
		return loadPipeline(model, "wasm");
	}
}

class AllowTokensProcessor extends LogitsProcessor {
	constructor(allowed) {
		super();
		this.allowed = allowed;
	}

	_call(_inputIds, logits) {
		const data = logits.data;
		const vocab = logits.dims[logits.dims.length - 1];
		for (let row = 0; row < data.length; row += vocab) {
			const kept = this.allowed.map((id) => data[row + id]);
			data.fill(-Infinity, row, row + vocab);
			this.allowed.forEach((id, i) => {
				data[row + id] = kept[i];
			});
		}
		return logits;
	}
}

function loudestWindow(audio, size) {
	if (audio.length <= size) return audio;
	const block = SAMPLE_RATE / 2;
	const energy = new Float64Array(Math.ceil(audio.length / block));
	for (let i = 0; i < audio.length; i++) {
		energy[Math.floor(i / block)] += audio[i] * audio[i];
	}
	const span = Math.floor(size / block);
	let sum = 0;
	for (let b = 0; b < span; b++) sum += energy[b];
	let best = sum;
	let bestBlock = 0;
	for (let b = span; b < energy.length; b++) {
		sum += energy[b] - energy[b - span];
		if (sum > best) {
			best = sum;
			bestBlock = b - span + 1;
		}
	}
	const start = Math.min(bestBlock * block, audio.length - size);
	return audio.subarray(start, start + size);
}

// transformers.js does not run Whisper language detection itself, so take one
// decoder step after <|startoftranscript|> restricted to language tokens.
async function detectLanguage(asr, audio) {
	const config = asr.model.generation_config;
	const langToId = config?.lang_to_id;
	const start = config?.decoder_start_token_id;
	if (!langToId || start == null) return "en";
	const languages = Object.entries(langToId);
	const processors = new LogitsProcessorList();
	processors.push(new AllowTokensProcessor(languages.map(([, id]) => id)));
	const { input_features } = await asr.processor(
		loudestWindow(audio, CHUNK_SECONDS * SAMPLE_RATE),
	);
	const output = await asr.model.generate({
		inputs: input_features,
		decoder_input_ids: [start],
		max_new_tokens: 1,
		return_timestamps: false,
		return_token_timestamps: false,
		logits_processor: processors,
	});
	const sequence = output.tolist()[0];
	const predicted = Number(sequence[sequence.length - 1]);
	const token = languages.find(([, id]) => id === predicted)?.[0];
	return token ? token.slice(2, -2) : "en";
}

class TimestampStreamer extends TextStreamer {
	constructor(asr, timestampBegin, onTime) {
		super(asr.tokenizer, {
			skip_prompt: true,
			callback_function: () => undefined,
		});
		this.timestampBegin = timestampBegin;
		this.onTime = onTime;
	}

	put(value) {
		const tokens = value[0];
		if (!tokens || tokens.length !== 1) return;
		const offset = Number(tokens[0]) - this.timestampBegin;
		if (offset >= 0) this.onTime(offset * TIME_PRECISION);
	}

	end() {
		return undefined;
	}
}

function countWindows(samples) {
	const window = CHUNK_SECONDS * SAMPLE_RATE;
	const jump = window - 2 * STRIDE_SECONDS * SAMPLE_RATE;
	let count = 1;
	for (let offset = 0; offset + window < samples; offset += jump) count++;
	return count;
}

const clock = (seconds) => {
	const s = Math.max(0, Math.floor(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function runAsr(asr, audio, language, emit) {
	const duration = audio.length / SAMPLE_RATE;
	const windows = countWindows(audio.length);
	const jumpSeconds = CHUNK_SECONDS - 2 * STRIDE_SECONDS;
	const timestampBegin =
		(asr.model.generation_config?.no_timestamps_token_id ?? 50363) + 1;

	let windowIndex = 0;
	let windowTime = 0;
	let lastReport = 0;
	const report = (force) => {
		const now = Date.now();
		if (!force && now - lastReport < 200) return;
		lastReport = now;
		const windowStart = windowIndex * jumpSeconds;
		const windowLength = Math.max(
			0.001,
			Math.min(CHUNK_SECONDS, duration - windowStart),
		);
		const within = Math.min(1, windowTime / windowLength);
		emit({
			stage: "transcribe",
			progress: Math.min(1, (windowIndex + within) / windows),
			message: `Transcribing… ${clock(Math.min(duration, windowStart + windowTime))} / ${clock(duration)}`,
		});
	};
	const streamer = new TimestampStreamer(asr, timestampBegin, (t) => {
		if (t <= windowTime) return;
		windowTime = t;
		report(false);
	});

	// The pipeline calls generate() once per 30 s window with no per-window
	// hook, so wrap it for this call to count finished windows.
	const model = asr.model;
	const ownGenerate = Object.hasOwn(model, "generate");
	const generate = model.generate;
	model.generate = async (...args) => {
		windowTime = 0;
		try {
			return await generate.apply(asr.model, args);
		} finally {
			windowIndex = Math.min(windows, windowIndex + 1);
			windowTime = 0;
			report(true);
		}
	};

	emit({
		stage: "transcribe",
		progress: 0,
		message: `Transcribing… 0:00 / ${clock(duration)}`,
	});
	try {
		const output = await asr(audio, {
			language,
			task: "transcribe",
			return_timestamps: "word",
			chunk_length_s: CHUNK_SECONDS,
			stride_length_s: STRIDE_SECONDS,
			streamer,
		});
		return output.chunks ?? [];
	} finally {
		if (ownGenerate) model.generate = generate;
		else delete model.generate;
	}
}

const finiteOrNull = (value) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
const round3 = (value) => Math.round(value * 1000) / 1000;

// Whisper can leave a word's start or end null when audio cuts off mid-word:
// borrow the touching neighbour edge, else spread the untimed run across the
// surrounding gap by text length, then force a monotonic timeline.
function toWords(chunks, duration) {
	const items = chunks
		.map((c) => ({
			text: c.text.trim(),
			start: finiteOrNull(c.timestamp?.[0]),
			end: finiteOrNull(c.timestamp?.[1]),
		}))
		.filter((w) => w.text !== "");
	const n = items.length;
	for (let i = 1; i < n; i++) {
		if (items[i].start === null) items[i].start = items[i - 1].end;
	}
	for (let i = n - 2; i >= 0; i--) {
		if (items[i].end === null) items[i].end = items[i + 1].start;
	}
	for (let i = 0; i < n; ) {
		if (items[i].start !== null && items[i].end !== null) {
			i++;
			continue;
		}
		let j = i;
		while (
			j + 1 < n &&
			(items[j + 1].start === null || items[j + 1].end === null)
		) {
			j++;
		}
		const left = items[i].start ?? (i > 0 ? (items[i - 1].end ?? 0) : 0);
		let right = items[j].end ?? (j + 1 < n ? items[j + 1].start : null);
		if (right === null || right < left) {
			right = Math.min(Math.max(duration, left), left + 0.35 * (j - i + 1));
		}
		const weights = items.slice(i, j + 1).map((w) => w.text.length + 1);
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let acc = 0;
		for (let k = i; k <= j; k++) {
			const from = left + ((right - left) * acc) / totalWeight;
			acc += weights[k - i];
			const to = left + ((right - left) * acc) / totalWeight;
			items[k].start ??= from;
			items[k].end ??= to;
		}
		i = j + 1;
	}
	let prevEnd = 0;
	return items.map((w) => {
		const start = Math.min(Math.max(w.start ?? 0, prevEnd), duration);
		const end = Math.min(Math.max(w.end ?? start, start), duration);
		prevEnd = end;
		return { text: w.text, start: round3(start), end: round3(end) };
	});
}

const describeError = (error) => {
	if (typeof error === "number") {
		return "Ran out of memory while running the speech model. Try the faster model or a shorter video.";
	}
	if (error instanceof Error) return error.message || error.name;
	return String(error);
};

async function handle(request) {
	const emit = (p) =>
		self.postMessage({ type: "progress", id: request.id, ...p });
	emitCurrent = emit;
	try {
		const audio = request.audio;
		const duration = audio.length / SAMPLE_RATE;
		const requested = (request.language || "auto").toLowerCase();
		if (audio.length === 0) {
			self.postMessage({
				type: "result",
				id: request.id,
				words: [],
				language: requested === "auto" ? "und" : requested,
			});
			return;
		}
		const asr = await getPipeline(
			request.model in MODEL_IDS ? request.model : "base",
		);
		let language = requested;
		if (language === "auto") {
			emit({
				stage: "transcribe",
				progress: 0,
				message: "Detecting language…",
			});
			language = await detectLanguage(asr, audio);
		}
		const chunks = await runAsr(asr, audio, language, emit);
		const words = toWords(chunks, duration);
		self.postMessage({ type: "result", id: request.id, words, language });
	} catch (error) {
		console.error("device-transcribe:", error);
		self.postMessage({
			type: "error",
			id: request.id,
			message: describeError(error),
		});
	} finally {
		emitCurrent = () => undefined;
	}
}

let queue = Promise.resolve();

self.onmessage = (event) => {
	const request = event.data;
	if (request?.type !== "transcribe") return;
	queue = queue.then(() => handle(request));
};
