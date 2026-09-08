import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { MicIcon } from "../lib/icons";

/**
 * Hold-to-talk from the phone, through the box, out of the Hytera.
 *
 * The audio path is deliberately raw: the browser captures with getUserMedia,
 * downsamples to the box's 16 kHz mono, and POSTs signed 16-bit chunks every
 * ~200 ms. A MediaRecorder stream would be smaller, but WebM/Opus cannot be
 * decoded chunk by chunk, and buffering the whole clip before keying would turn
 * push-to-talk into leave-a-message.
 *
 * The transmitter is keyed the moment the button goes down, before any audio has
 * arrived — on a shared channel, holding the slot is the point.
 */
export function PttButton({ disabled, keyed }: { disabled: boolean; keyed: boolean }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const node = useRef<ScriptProcessorNode | null>(null);
  const buffer = useRef<number[]>([]);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const teardown = useCallback(() => {
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = null;
    node.current?.disconnect();
    node.current = null;
    void context.current?.close();
    context.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    buffer.current = [];
  }, []);

  useEffect(() => teardown, [teardown]);

  const flush = useCallback(async () => {
    if (buffer.current.length === 0) return;
    const samples = buffer.current;
    buffer.current = [];
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]!));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    await api.pttAudio(pcm.buffer).catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    if (active || disabled) return;
    setError(null);
    try {
      // Key first: a couple of hundred milliseconds of dead air at the start of
      // a transmission is normal on radio; a clipped first word is not.
      const opened = await api.pttStart();
      if (!opened.ok) {
        setError(opened.detail ?? "The radio would not key.");
        return;
      }
      setActive(true);
      startedAt.current = Date.now();

      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = media;

      const ctx = new AudioContext();
      context.current = ctx;
      const source = ctx.createMediaStreamSource(media);
      // ScriptProcessor is deprecated but universally available, including on
      // the older Android browsers a volunteer's phone actually runs. An
      // AudioWorklet needs a separate module file, which is one more thing to
      // fail to load off an appliance with no internet.
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      node.current = processor;

      const ratio = ctx.sampleRate / 16_000;
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        // Average the samples that fall in each output slot rather than picking
        // one: plain decimation aliases, and aliased speech over a narrowband
        // radio is unintelligible.
        for (let i = 0; i < Math.floor(input.length / ratio); i++) {
          const from = Math.floor(i * ratio);
          const to = Math.min(input.length, Math.floor((i + 1) * ratio));
          let sum = 0;
          for (let j = from; j < to; j++) sum += input[j]!;
          buffer.current.push(sum / Math.max(1, to - from));
        }
      };
      source.connect(processor);
      // Connecting to the destination is what keeps the graph pulling in Chrome;
      // a zero gain node in between stops the phone hearing itself.
      const silence = ctx.createGain();
      silence.gain.value = 0;
      processor.connect(silence);
      silence.connect(ctx.destination);

      flushTimer.current = setInterval(() => {
        void flush();
        setElapsed(Date.now() - startedAt.current);
      }, 200);
    } catch (err) {
      setError(
        (err as Error).name === "NotAllowedError"
          ? "The browser blocked the microphone. Allow it and try again."
          : (err as Error).message,
      );
      setActive(false);
      teardown();
      await api.pttStop().catch(() => undefined);
    }
  }, [active, disabled, flush, teardown]);

  const stop = useCallback(async () => {
    if (!active) return;
    setActive(false);
    setElapsed(0);
    await flush();
    teardown();
    await api.pttStop().catch(() => undefined);
  }, [active, flush, teardown]);

  return (
    <>
      <button
        className={`ptt${active || keyed ? " keyed" : ""}`}
        disabled={disabled}
        // Pointer events cover mouse, touch and pen with one path, and
        // `setPointerCapture` means sliding a thumb off the button does not
        // silently leave the transmitter keyed.
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          void start();
        }}
        onPointerUp={() => void stop()}
        onPointerCancel={() => void stop()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <MicIcon size={22} />
        {active ? `On air · ${(elapsed / 1000).toFixed(1)}s` : "Hold to talk"}
      </button>
      {error && (
        <p style={{ gridColumn: "1 / -1", fontSize: 12, color: "#fca5a5", marginTop: 8 }}>{error}</p>
      )}
    </>
  );
}
