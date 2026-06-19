import { useCallback, useRef, useState } from "react";

/** Minimal MediaRecorder wrapper for capturing a short voice note. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [supported] = useState(() => typeof MediaRecorder !== "undefined");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const start = useCallback(async () => {
    if (!supported) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
    rec.start();
    recorderRef.current = rec;
    startedAtRef.current = Date.now();
    setRecording(true);
  }, [supported]);

  const stop = useCallback((): Promise<{ blob: Blob; durationMs: number } | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        rec.stream.getTracks().forEach((tk) => tk.stop());
        setRecording(false);
        resolve({ blob, durationMs: Date.now() - startedAtRef.current });
      };
      rec.stop();
    });
  }, []);

  return { recording, supported, start, stop };
}
