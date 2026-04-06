import { useState, useRef, useCallback, useEffect } from "react";
import { Copy, Plus, Trash2, Check, Film, ClipboardList, Clock, Subtitles, Loader2 } from "lucide-react";

interface Remark {
  id: string;
  timestamp: number;
  text: string;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extractDropboxEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("dropbox.com") && u.pathname.includes(".mp4")) {
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      return u.toString();
    }
    if (u.hostname.includes("dropbox.com")) {
      u.searchParams.set("raw", "1");
      u.searchParams.delete("dl");
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findPhraseWordIndex(normWords: string[], phraseWords: string[], after = 0): number {
  outer: for (let i = after; i <= normWords.length - phraseWords.length; i++) {
    for (let j = 0; j < phraseWords.length; j++) {
      if (normWords[i + j] !== phraseWords[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractHomilySection(transcript: string): string | null {
  const words = transcript.split(/\s+/);
  const normWords = words.map(normalizeWord);

  const startCandidates = [
    "praise to you lord jesus christ",
    "praise to you o lord jesus christ",
    "praise to you lord jesus",
    "praise to you jesus christ",
  ].map((p) => p.split(" "));

  const endCandidates = [
    "our father who art in heaven hallowed be thy name",
    "our father who art in heaven",
    "our father in heaven hallowed be thy name",
  ].map((p) => p.split(" "));

  let startWordIdx = -1;
  let startPhraseLen = 0;
  for (const phrase of startCandidates) {
    const idx = findPhraseWordIndex(normWords, phrase);
    if (idx !== -1) {
      startWordIdx = idx;
      startPhraseLen = phrase.length;
      break;
    }
  }
  if (startWordIdx === -1) return null;

  const afterStart = startWordIdx + startPhraseLen;

  let endWordIdx = words.length;
  for (const phrase of endCandidates) {
    const idx = findPhraseWordIndex(normWords, phrase, afterStart);
    if (idx !== -1) {
      endWordIdx = idx;
      break;
    }
  }

  return words.slice(afterStart, endWordIdx).join(" ").trim() || null;
}

export default function Reviewer() {
  const [videoUrl, setVideoUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState("");
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [currentRemark, setCurrentRemark] = useState("");
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const [copied, setCopied] = useState(false);
  const [remarkAdded, setRemarkAdded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remarkInputRef = useRef<HTMLTextAreaElement>(null);

  const [transcribing, setTranscribing] = useState(false);
  const [captionSection, setCaptionSection] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [rawVideoUrl, setRawVideoUrl] = useState<string | null>(null);

  const captureTimestamp = useCallback(() => {
    if (videoRef.current) {
      const t = videoRef.current.currentTime;
      setCurrentTimestamp(t);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePause = () => {
      captureTimestamp();
      remarkInputRef.current?.focus();
    };

    video.addEventListener("pause", handlePause);
    return () => video.removeEventListener("pause", handlePause);
  }, [embedUrl, captureTimestamp]);

  function handleLoadVideo() {
    setUrlError("");
    const trimmed = videoUrl.trim();
    if (!trimmed) {
      setUrlError("Please paste a video URL.");
      return;
    }
    const embed = extractDropboxEmbedUrl(trimmed);
    if (!embed) {
      setUrlError("Please enter a valid Dropbox video link.");
      return;
    }
    setEmbedUrl(embed);
    setRawVideoUrl(embed);
    setRemarks([]);
    setCurrentRemark("");
    setCurrentTimestamp(0);
    setCaptionSection(null);
    setCaptionError(null);
  }

  async function handleGetCaptions() {
    if (!rawVideoUrl) return;
    setTranscribing(true);
    setCaptionSection(null);
    setCaptionError(null);
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: rawVideoUrl }),
      });
      const data = await res.json() as { transcript?: string; error?: string };
      if (!res.ok || data.error) {
        setCaptionError(data.error ?? "Transcription failed.");
        return;
      }
      if (!data.transcript) {
        setCaptionError("No transcript returned.");
        return;
      }
      const section = extractHomilySection(data.transcript);
      if (!section) {
        setCaptionError(
          "Could not find the Homily in this video's transcript. Could not detect \"Praise to you Lord Jesus Christ\" or \"Our Father, who art in heaven\"."
        );
      } else {
        setCaptionSection(section);
      }
    } catch {
      setCaptionError("Failed to contact the transcription service.");
    } finally {
      setTranscribing(false);
    }
  }

  function handleAddRemark() {
    if (!currentRemark.trim()) return;
    const ts = videoRef.current ? videoRef.current.currentTime : currentTimestamp;
    const newRemark: Remark = {
      id: crypto.randomUUID(),
      timestamp: ts,
      text: currentRemark.trim(),
    };
    setRemarks((prev) =>
      [...prev, newRemark].sort((a, b) => a.timestamp - b.timestamp)
    );
    setCurrentRemark("");
    setRemarkAdded(true);
    setTimeout(() => setRemarkAdded(false), 1500);
    remarkInputRef.current?.focus();
  }

  function handleDeleteRemark(id: string) {
    setRemarks((prev) => prev.filter((r) => r.id !== id));
  }

  function handleJumpTo(timestamp: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = timestamp;
      videoRef.current.focus();
    }
  }

  function buildCopyText(): string {
    if (remarks.length === 0) return "";
    const lines = remarks.map(
      (r, i) => `${i + 1}. [${formatTimestamp(r.timestamp)}] ${r.text}`
    );
    return lines.join("\n");
  }

  async function handleCopyAll() {
    const text = buildCopyText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleAddRemark();
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-4 sm:px-6">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-600">
            <Film className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Parish Video Reviewer</h1>
            <p className="text-xs text-slate-400">Review, annotate, and share feedback with your team</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        {/* URL Input */}
        <section aria-label="Load video">
          <label htmlFor="video-url" className="block text-sm font-medium text-slate-300 mb-2">
            Dropbox Video Link
          </label>
          <div className="flex gap-2">
            <input
              id="video-url"
              type="url"
              value={videoUrl}
              onChange={(e) => { setVideoUrl(e.target.value); setUrlError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLoadVideo()}
              placeholder="Paste your Dropbox video link here..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              aria-describedby={urlError ? "url-error" : undefined}
              aria-invalid={!!urlError}
            />
            <button
              onClick={handleLoadVideo}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-lg px-4 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-950 whitespace-nowrap"
              aria-label="Load video"
            >
              Load Video
            </button>
          </div>
          {urlError && (
            <p id="url-error" role="alert" className="mt-1.5 text-xs text-red-400">
              {urlError}
            </p>
          )}
          <p className="mt-1.5 text-xs text-slate-500">
            Paste a shared Dropbox link ending in .mp4 or any Dropbox video share link.
          </p>
        </section>

        {embedUrl && (
          <>
            {/* Video Player */}
            <section aria-label="Video player">
              <div className="rounded-xl overflow-hidden bg-black border border-slate-800 shadow-2xl">
                <video
                  ref={videoRef}
                  src={embedUrl}
                  controls
                  className="w-full max-h-[480px] object-contain bg-black"
                  aria-label="Parish video for review"
                >
                  Your browser does not support the video element.
                </video>
              </div>
              <p className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                Pause the video to automatically capture the timestamp, then type your remark below.
              </p>
            </section>

            {/* Add Remark */}
            <section aria-label="Add remark">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-300">Add a Remark</h2>
                  <span className="text-xs text-indigo-400 font-mono bg-indigo-950 px-2 py-0.5 rounded-full">
                    {formatTimestamp(currentTimestamp)}
                  </span>
                </div>
                <textarea
                  ref={remarkInputRef}
                  value={currentRemark}
                  onChange={(e) => setCurrentRemark(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your remark here... (Ctrl+Enter or Cmd+Enter to add)"
                  rows={3}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  aria-label="Remark text"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    Timestamp captured when you paused the video
                  </p>
                  <button
                    onClick={handleAddRemark}
                    disabled={!currentRemark.trim()}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                    aria-label="Add remark to list"
                  >
                    {remarkAdded ? (
                      <Check className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Plus className="w-4 h-4" aria-hidden="true" />
                    )}
                    {remarkAdded ? "Added!" : "Add Remark"}
                  </button>
                </div>
              </div>
            </section>

            {/* Remarks List */}
            <section aria-label="Remarks list">
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    <ClipboardList className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                    Remarks
                    {remarks.length > 0 && (
                      <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {remarks.length}
                      </span>
                    )}
                  </h2>
                  {remarks.length > 0 && (
                    <button
                      onClick={handleCopyAll}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                      aria-label="Copy all remarks to clipboard for WhatsApp"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      {copied ? "Copied!" : "Copy All for WhatsApp"}
                    </button>
                  )}
                </div>

                {remarks.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-slate-500 text-sm">
                      No remarks yet. Pause the video and start adding notes.
                    </p>
                  </div>
                ) : (
                  <ol className="divide-y divide-slate-800" aria-label="List of video remarks">
                    {remarks.map((remark, index) => (
                      <li key={remark.id} className="flex gap-3 px-4 py-3 group hover:bg-slate-800/50 transition-colors">
                        <span className="shrink-0 text-xs text-slate-400 pt-0.5 w-5 text-right" aria-label={`Remark ${index + 1}`}>
                          {index + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => handleJumpTo(remark.timestamp)}
                            className="inline-flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 bg-indigo-950 hover:bg-indigo-900 px-2 py-0.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-1"
                            aria-label={`Jump to ${formatTimestamp(remark.timestamp)}`}
                          >
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {formatTimestamp(remark.timestamp)}
                          </button>
                          <p className="text-sm text-slate-200 leading-relaxed">{remark.text}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteRemark(remark.id)}
                          className="shrink-0 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100 p-1 rounded focus:outline-none focus:ring-2 focus:ring-red-400"
                          aria-label={`Delete remark at ${formatTimestamp(remark.timestamp)}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {remarks.length > 0 && (
                <div className="mt-3 p-3 bg-slate-900 border border-slate-800 rounded-xl">
                  <p className="text-xs font-medium text-slate-400 mb-2">Preview (what will be copied):</p>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">
                    {buildCopyText()}
                  </pre>
                </div>
              )}
            </section>

            {/* Captions Section */}
            <section aria-label="Homily captions">
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                    <Subtitles className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    Homily
                  </h2>
                  <button
                    onClick={handleGetCaptions}
                    disabled={transcribing}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900"
                    aria-label="Get captions for this video"
                  >
                    {transcribing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Subtitles className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {transcribing ? "Transcribing…" : "Get Captions"}
                  </button>
                </div>

                <div className="px-4 py-4">
                  {!captionSection && !captionError && !transcribing && (
                    <p className="text-slate-500 text-sm text-center py-6">
                      Press "Get Captions" to transcribe this video and extract the Homily.
                    </p>
                  )}
                  {transcribing && (
                    <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
                      <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                      <p className="text-sm">Transcribing video audio — this may take a minute…</p>
                    </div>
                  )}
                  {captionError && (
                    <p role="alert" className="text-red-400 text-sm py-4 text-center">
                      {captionError}
                    </p>
                  )}
                  {captionSection && (
                    <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                      {captionSection}
                    </p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {!embedUrl && (
          <div className="py-16 text-center border border-dashed border-slate-800 rounded-xl">
            <Film className="w-12 h-12 text-slate-700 mx-auto mb-3" aria-hidden="true" />
            <p className="text-slate-500 text-sm">Paste a Dropbox video link above to get started.</p>
          </div>
        )}
      </main>
    </div>
  );
}
