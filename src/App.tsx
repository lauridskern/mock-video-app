import { Slider } from "@/components/ui/slider";
import {
  defaultAspectRatio,
  defaultDeviceGapPercent,
  defaultMockup,
  getMockupPreviewInnerX,
  getMockupPreviewInnerY,
  mockupGroups,
  widthFractionForDevices,
} from "@/lib/appDefaults";
import {
  colorPickerSwatchInputClassName,
  defaultSolidColor,
  normalizeColorHex,
} from "@/lib/colorFormat";
import { colors } from "@/lib/constants/colors";
import { gradientPresets } from "@/lib/constants/gradientPresets";
import { mockupsDefs } from "@/lib/constants/mockups";
import { aspectRatios } from "@/lib/constants/sizes";
import useMediabunny, { type Background, type ExportFormat } from "@/lib/hooks/useMediabunny";
import { buildPreviewSurfaceStyle } from "@/lib/previewSurfaceStyle";
import { cn } from "@/lib/utils";
import { smartTrim } from "@/lib/utils/utils";
import {
  clampEndOffset,
  clampStartOffset,
  formatFrameTimestamp,
  formatTimestamp,
  getEffectiveTrimWindow,
  MIN_REMAINING_SECONDS,
  snapToFrame,
  type VideoDimensions,
} from "@/lib/videoTrim";
import { Popover, PopoverTrigger, PopoverContent } from "@radix-ui/react-popover";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type DeviceCount = 1 | 2 | 3;
type BgTab = "color" | "gradient" | "image";
type MediaMode = "video" | "image";

export default function App() {
  const { generateVideo, generateImage, progress, reset, transpilingFinished, finishedVideoUrl, transpilingStarted } = useMediabunny();
  const [mediaMode, setMediaMode] = useState<MediaMode>("video");
  const [selectedMockup, setSelectedMockup] = useState(defaultMockup);
  const [scale, setScale] = useState(90);
  const [videoScale, setVideoScale] = useState(100);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const [selectedFramerate, setSelectedFramerate] = useState(30);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("mp4");
  const [selectedAspectRatio, setSelectedAspectRatio] = useState(defaultAspectRatio);
  const [deviceCount, setDeviceCount] = useState<DeviceCount>(1);
  const [deviceGapPercent, setDeviceGapPercent] = useState(defaultDeviceGapPercent);
  const [loopShorter, setLoopShorter] = useState(true);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const [previewScrubTime, setPreviewScrubTime] = useState(0);

  const [videoFiles, setVideoFiles] = useState<(File | null)[]>([null]);
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [videoDurations, setVideoDurations] = useState<number[]>([0]);
  const [videoDimensions, setVideoDimensions] = useState<(VideoDimensions | null)[]>([null]);
  const [videoStartOffsets, setVideoStartOffsets] = useState<number[]>([0]);
  const [videoEndOffsets, setVideoEndOffsets] = useState<number[]>([0]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [activeDragIdx, setActiveDragIdx] = useState<number | null>(null);

  const [bgTab, setBgTab] = useState<BgTab>("color");
  const [solidColor, setSolidColor] = useState(defaultSolidColor);
  const [gradient, setGradient] = useState({ from: "#a5f3fc", to: "#f5d0fe", angle: 135 });
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgImageUrl, setBgImageUrl] = useState<string>("");

  const background: Background = useMemo(() => {
    if (bgTab === "gradient") return { type: "gradient", ...gradient };
    if (bgTab === "image" && bgImageFile) return { type: "image", file: bgImageFile };
    return { type: "color", color: solidColor };
  }, [bgTab, gradient, bgImageFile, solidColor]);

  const isTransparentExport = mediaMode === "video" && exportFormat === "webm-transparent";
  const previewSurfaceStyle = useMemo(
    () =>
      buildPreviewSurfaceStyle({
        background,
        solidColor,
        isTransparentExport,
        aspectWidth: selectedAspectRatio.width,
        aspectHeight: selectedAspectRatio.height,
      }),
    [background, isTransparentExport, selectedAspectRatio.height, selectedAspectRatio.width, solidColor],
  );
  const frameDuration = 1 / selectedFramerate;

  const trimmedDurations = useMemo(() => {
    return videoFiles.map((file, idx) => {
      if (!file) return 0;
      const duration = videoDurations[idx] ?? 0;
      if (!Number.isFinite(duration) || duration <= 0) return 0;
      const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
      return Math.max(end - start, 0);
    });
  }, [videoDurations, videoEndOffsets, videoFiles, videoStartOffsets]);

  const finalPreviewDuration = useMemo(() => Math.max(...trimmedDurations, 0), [trimmedDurations]);

  useEffect(() => {
    const resize = <T,>(prev: T[], fill: T) => {
      const next = prev.slice(0, deviceCount);
      while (next.length < deviceCount) next.push(fill);
      return next;
    };
    setVideoFiles((prev) => resize(prev, null));
    setVideoDurations((prev) => resize(prev, 0));
    setVideoDimensions((prev) => resize(prev, null));
    setVideoStartOffsets((prev) => resize(prev, 0));
    setVideoEndOffsets((prev) => resize(prev, 0));
    videoRefs.current = videoRefs.current.slice(0, deviceCount);
  }, [deviceCount]);

  useEffect(() => {
    const urls = videoFiles.map((f) => (f ? URL.createObjectURL(f) : ""));
    setVideoUrls(urls);
    return () => {
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, [videoFiles]);

  useEffect(() => {
    if (!bgImageFile) {
      setBgImageUrl("");
      return;
    }
    const url = URL.createObjectURL(bgImageFile);
    setBgImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [bgImageFile]);

  useEffect(() => {
    if (!transpilingStarted) return;
    const outputDuration = Math.max(
      ...videoRefs.current.map((video, idx) => {
        const duration = videoDurations[idx] || video?.duration || 0;
        const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
        return Math.max(end - start, 0);
      }),
      0,
    );
    if (!Number.isFinite(outputDuration) || outputDuration <= 0) return;

    const t = (progress / 100) * outputDuration;
    videoRefs.current.forEach((vv, idx) => {
      if (!vv) return;
      const duration = videoDurations[idx] || vv.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;

      const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
      const remainingDuration = Math.max(end - start, 0);
      const relativeTime = loopShorter && remainingDuration > 0
        ? t % remainingDuration
        : Math.min(t, Math.max(remainingDuration - 1 / selectedFramerate, 0));
      vv.currentTime = Math.min(start + relativeTime, Math.max(end - 0.001, 0));
    });
  }, [loopShorter, progress, selectedFramerate, transpilingStarted, videoDurations, videoEndOffsets, videoStartOffsets]);

  useEffect(() => {
    videoRefs.current.forEach((v) => {
      if (!v) return;
      if (transpilingStarted) v.pause();
    });
  }, [transpilingStarted]);

  useEffect(() => {
    if (transpilingStarted || transpilingFinished) return;

    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      if (!previewPlaying) {
        video.pause();
        return;
      }

      const duration = videoDurations[idx] || video.duration || 0;
      if (Number.isFinite(duration) && duration > 0 && video.ended) {
        const { start } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
        video.currentTime = start;
      }
      video.play().catch(() => {});
    });
  }, [previewPlaying, transpilingFinished, transpilingStarted, videoDurations, videoEndOffsets, videoStartOffsets]);

  const setVideoAt = useCallback((idx: number, file: File | null) => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles((prev) => {
      const next = prev.slice();
      next[idx] = file;
      return next;
    });
    setVideoDurations((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoDimensions((prev) => {
      const next = prev.slice();
      next[idx] = null;
      return next;
    });
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
  }, []);

  const handleMediaModeChange = useCallback((nextMode: MediaMode) => {
    if (nextMode === mediaMode) return;
    setMediaMode(nextMode);
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles(Array(deviceCount).fill(null));
    setVideoDurations(Array(deviceCount).fill(0));
    setVideoDimensions(Array(deviceCount).fill(null));
    setVideoStartOffsets(Array(deviceCount).fill(0));
    setVideoEndOffsets(Array(deviceCount).fill(0));
    videoRefs.current = [];
    setExportFormat("mp4");
    reset();
  }, [deviceCount, mediaMode, reset]);

  const setVideoDurationAt = useCallback((idx: number, duration: number) => {
    const safeDuration = Number.isFinite(duration) ? duration : 0;
    setVideoDurations((prev) => {
      const next = prev.slice();
      next[idx] = safeDuration;
      return next;
    });
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = clampStartOffset(next[idx] ?? 0, safeDuration);
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = clampEndOffset(next[idx] || safeDuration, safeDuration);
      return next;
    });
  }, []);

  const setVideoDimensionsAt = useCallback((idx: number, dimensions: VideoDimensions) => {
    setVideoDimensions((prev) => {
      const next = prev.slice();
      next[idx] = dimensions;
      return next;
    });
  }, []);

  const getTrimStartForVideo = useCallback((idx: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration).start;
  }, [videoDurations, videoEndOffsets, videoStartOffsets]);

  const getTrimEndForVideo = useCallback((idx: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    const endOffset = clampEndOffset(videoEndOffsets[idx] || duration, duration);
    return Math.max(endOffset - 0.001, 0);
  }, [videoDurations, videoEndOffsets]);

  const getVideoTimeAtPreviewTime = useCallback((idx: number, previewTime: number) => {
    const video = videoRefs.current[idx];
    const duration = videoDurations[idx] || video?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) return 0;

    const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
    const trimDuration = Math.max(end - start, 0);
    if (trimDuration <= 0) return start;

    if (loopShorter) {
      const relativeTime = previewTime >= finalPreviewDuration ? trimDuration : previewTime % trimDuration;
      return Math.min(start + relativeTime, Math.max(end - 0.001, start));
    }

    const relativeTime = Math.min(previewTime, Math.max(trimDuration - 0.001, 0));
    return Math.min(start + relativeTime, Math.max(end - 0.001, start));
  }, [finalPreviewDuration, loopShorter, videoDurations, videoEndOffsets, videoStartOffsets]);

  const seekAllVideosToPreviewTime = useCallback((previewTime: number) => {
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      video.pause();
      video.currentTime = getVideoTimeAtPreviewTime(idx, previewTime);
    });
  }, [getVideoTimeAtPreviewTime]);

  useEffect(() => {
    if (previewScrubTime <= finalPreviewDuration) return;
    const nextTime = Math.max(finalPreviewDuration, 0);
    setPreviewScrubTime(nextTime);
    seekAllVideosToPreviewTime(nextTime);
  }, [finalPreviewDuration, previewScrubTime, seekAllVideosToPreviewTime]);

  const pausePreviewAt = useCallback((idx: number, time: number, alignOthersTo: "start" | "end" = "start") => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    videoRefs.current.forEach((video, videoIdx) => {
      if (!video) return;
      const duration = videoDurations[videoIdx] || video.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) {
        video.pause();
        return;
      }
      video.currentTime = videoIdx === idx
        ? time
        : alignOthersTo === "end"
          ? getTrimEndForVideo(videoIdx)
          : getTrimStartForVideo(videoIdx);
      video.pause();
    });
  }, [getTrimEndForVideo, getTrimStartForVideo, videoDurations]);

  const seekAllVideosToTrimStart = useCallback(() => {
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      const duration = videoDurations[idx] || video.duration || 0;
      if (!Number.isFinite(duration) || duration <= 0) return;
      video.currentTime = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration).start;
    });
  }, [videoDurations, videoEndOffsets, videoStartOffsets]);

  const pauseCompletedPreview = useCallback(() => {
    setPreviewPlaying(false);
    setPreviewCompleted(true);
    videoRefs.current.forEach((video) => video?.pause());
  }, []);

  const handleStartOffsetChange = useCallback((idx: number, value: number) => {
    const duration = videoDurations[idx] ?? 0;
    const nextOffset = clampStartOffset(snapToFrame(value, selectedFramerate), duration);
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextOffset;
      return next;
    });

    pausePreviewAt(idx, nextOffset, "start");
  }, [pausePreviewAt, selectedFramerate, videoDurations]);

  const handleEndOffsetChange = useCallback((idx: number, value: number) => {
    const duration = videoDurations[idx] ?? 0;
    const nextOffset = clampEndOffset(snapToFrame(value, selectedFramerate), duration);
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = nextOffset;
      return next;
    });

    pausePreviewAt(idx, Math.max(nextOffset - 0.001, 0), "end");
  }, [pausePreviewAt, selectedFramerate, videoDurations]);

  const handleResetTrimAt = useCallback((idx: number) => {
    setPreviewCompleted(false);
    const duration = videoDurations[idx] ?? 0;
    setVideoStartOffsets((prev) => {
      const next = prev.slice();
      next[idx] = 0;
      return next;
    });
    setVideoEndOffsets((prev) => {
      const next = prev.slice();
      next[idx] = duration;
      return next;
    });

    const video = videoRefs.current[idx];
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = 0;
      if (previewPlaying) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, [previewPlaying, videoDurations]);

  const handleTogglePreviewPlayback = useCallback(() => {
    if (previewPlaying) {
      setPreviewPlaying(false);
      return;
    }

    if (previewCompleted) {
      seekAllVideosToTrimStart();
      setPreviewScrubTime(0);
      setPreviewCompleted(false);
    }
    setPreviewPlaying(true);
  }, [previewCompleted, previewPlaying, seekAllVideosToTrimStart]);

  const handlePreviewScrubChange = useCallback((value: number) => {
    const nextTime = Math.min(Math.max(snapToFrame(value, selectedFramerate), 0), finalPreviewDuration);
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(nextTime);
    seekAllVideosToPreviewTime(nextTime);
  }, [finalPreviewDuration, seekAllVideosToPreviewTime, selectedFramerate]);

  const handleFileChangeAt = useCallback((idx: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const file = files?.[0];
    if (file && file.type.startsWith(`${mediaMode}/`)) setVideoAt(idx, file);
    setTimeout(() => { event.target.value = ""; }, 50);
  }, [mediaMode, setVideoAt]);

  const handleDropAt = useCallback((idx: number) => (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setActiveDragIdx(null);
    const files = event.dataTransfer.files;
    const file = files?.[0];
    if (file && file.type.startsWith(`${mediaMode}/`)) setVideoAt(idx, file);
  }, [mediaMode, setVideoAt]);

  const handleBgImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) setBgImageFile(files[0]);
    setTimeout(() => { event.target.value = ""; }, 50);
  }, []);

  const cellWidthFraction = useMemo(
    () => widthFractionForDevices(deviceCount, deviceGapPercent),
    [deviceCount, deviceGapPercent],
  );

  const allVideosLoaded = videoFiles.every((f) => f !== null);
  const anyVideoLoaded = videoFiles.some((f) => f !== null);

  const handleGenerate = () => {
    const filledFiles = videoFiles.filter((f): f is File => f !== null);
    if (filledFiles.length !== deviceCount) return;
    setPreviewPlaying(false);
    if (mediaMode === "image") {
      generateImage({
        imageFiles: filledFiles,
        mockup: selectedMockup,
        background,
        canvasWidth: selectedAspectRatio.width,
        canvasHeight: selectedAspectRatio.height,
        phoneSizePercentage: scale,
        videoSizePercentage: videoScale,
        mockupBackgroundColor: "black",
        verticalOffset,
        deviceGapPercent,
      });
      return;
    }
    generateVideo({
      videoFiles: filledFiles,
      mockup: selectedMockup,
      background,
      canvasWidth: selectedAspectRatio.width,
      canvasHeight: selectedAspectRatio.height,
      phoneSizePercentage: scale,
      videoSizePercentage: videoScale,
      mockupBackgroundColor: "black",
      verticalOffset,
      frameRate: selectedFramerate,
      exportFormat,
      loopShorter,
      videoStartTimes: videoStartOffsets.slice(0, deviceCount),
      videoEndTimes: videoEndOffsets.slice(0, deviceCount),
      deviceGapPercent,
    });
  };

  const handleReset = () => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    setPreviewScrubTime(0);
    setVideoFiles(Array(deviceCount).fill(null));
    setScale(90);
    setVideoScale(100);
    setBgTab("color");
    setSolidColor(defaultSolidColor);
    setGradient({ from: "#a5f3fc", to: "#f5d0fe", angle: 135 });
    setBgImageFile(null);
    setVideoDurations(Array(deviceCount).fill(0));
    setVideoDimensions(Array(deviceCount).fill(null));
    setVideoStartOffsets(Array(deviceCount).fill(0));
    setVideoEndOffsets(Array(deviceCount).fill(0));
    setDeviceGapPercent(defaultDeviceGapPercent);
    setSelectedMockup(defaultMockup);
    setSelectedAspectRatio(defaultAspectRatio);
    setExportFormat("mp4");
    reset();
  };

  const handleContinueEditing = () => {
    setPreviewPlaying(false);
    setPreviewCompleted(false);
    seekAllVideosToTrimStart();
    reset();
  };

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-[5%]"
      style={{ backgroundColor: solidColor + "33" }}
    >
      <div className="flex-1 flex flex-col text-center justify-center items-center">
        <span className="text-base text-black/70 font-medium mb-1">Mockup Generator</span>
        <span className="text-xs text-black/45">
          {deviceCount > 1
            ? `Compare ${mediaMode === "video" ? "recordings" : "screenshots"} side by side inside matching device frames.`
            : mediaMode === "video"
              ? "Turn a screen recording into a polished phone mockup video."
              : "Turn a screenshot into a polished phone mockup image."}
        </span>
        <div className="mt-3 rounded-lg bg-stone-900/5 p-0.5 text-black/70">
          <div className="relative flex w-36 items-center">
            <div
              className={cn(
                "absolute inset-y-0 left-0 w-1/2 rounded-md bg-white shadow transition-transform duration-200",
                mediaMode === "image" && "translate-x-full",
              )}
            />
            {(["video", "image"] as MediaMode[]).map((mode) => (
              <button
                key={mode}
                className="relative flex-1 cursor-pointer py-1 text-xs font-semibold capitalize"
                onClick={() => handleMediaModeChange(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="w-full h-full justify-center items-center flex relative">
        <div
          className="border border-black/5 rounded-xl shadow-2xl shadow-black/5 group relative flex justify-center items-center transition-all ease-in-out duration-300 overflow-hidden"
          style={previewSurfaceStyle}
        >
          {!isTransparentExport && bgTab === "image" && bgImageUrl && (
            <img
              src={bgImageUrl}
              alt="background"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}

          <div
            className="absolute inset-0 flex flex-row items-center justify-center h-full w-full min-w-0"
            style={deviceCount > 1 ? { columnGap: `${deviceGapPercent}%` } : undefined}
          >
            {Array.from({ length: deviceCount }).map((_, idx) => {
              const file = videoFiles[idx];
              const url = videoUrls[idx];
              const isDragOver = activeDragIdx === idx;
              const cellAspect = (selectedAspectRatio.width / selectedAspectRatio.height) * cellWidthFraction;
              const mockupAspect = selectedMockup.width / selectedMockup.height;
              const screenAspect = selectedMockup.innerWidth / selectedMockup.innerHeight;
              const dimensions = videoDimensions[idx];
              const videoAspect = dimensions && dimensions.width > 0 && dimensions.height > 0
                ? dimensions.width / dimensions.height
                : screenAspect;
              const mediaSizing = videoAspect > screenAspect
                ? { height: `${videoScale}%`, width: "auto" }
                : { width: `${videoScale}%`, height: "auto" };
              const maxScaleByColumn = (cellAspect * 0.97 / mockupAspect) * 100;
              const sizingScale = Math.min(scale, maxScaleByColumn);
              return (
                <div
                  key={idx}
                  className="group/phone relative flex shrink-0 cursor-pointer items-center justify-center"
                  style={{
                    height: `${sizingScale}%`,
                    marginTop: `${verticalOffset}%`,
                    aspectRatio: `${selectedMockup.width}/${selectedMockup.height}`,
                  }}
                >
                    <div className="h-full w-full flex items-center justify-center cursor-pointer">
                      <div className={cn(
                        "absolute w-full h-full bg-white/5 rounded-[20%] flex flex-col items-center justify-center p-[5%] transition-colors transform-gpu",
                        !file && "group-hover/phone:bg-white/30",
                        isDragOver && "bg-white/40",
                      )}>
                        {!file && (
                          <div
                            className="flex flex-col items-center gap-2"
                            style={{
                              transform: `scale(${Math.max(Math.min(sizingScale / 100, 1), 0.5)})`,
                              width: "90%",
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="w-4 h-4 opacity-20 lg:w-5 lg:h-5"
                            >
                              <path d="M7.25 11.5a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Z" />
                              <path
                                fillRule="evenodd"
                                d="M6 1a2.5 2.5 0 0 0-2.5 2.5v9A2.5 2.5 0 0 0 6 15h4a2.5 2.5 0 0 0 2.5-2.5v-9A2.5 2.5 0 0 0 10 1H6Zm4 1.5h-.5V3a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-.5H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1Z"
                                clipRule="evenodd"
                              />
                            </svg>
                            <p className="text-xs lg:text-sm text-center text-black/50 max-w-full">
                              {deviceCount > 1
                                ? `Add ${mediaMode} ${idx + 1}`
                                : `Click or drag here to add ${mediaMode === "video" ? "a screen recording" : "an image"} of your app`}
                            </p>
                          </div>
                        )}
                      </div>
                      <div
                        className={cn(
                          "absolute rounded-[5%] overflow-hidden bg-black transition-all duration-200",
                          !file && "group-hover/phone:opacity-30 group-hover/phone:blur-sm",
                        )}
                        style={{
                          left: `${(getMockupPreviewInnerX(selectedMockup) / selectedMockup.width) * 100}%`,
                          top: `${(getMockupPreviewInnerY(selectedMockup) / selectedMockup.height) * 100}%`,
                          width: `${(selectedMockup.innerWidth / selectedMockup.width) * 100 * 1.005}%`,
                          height: `${(selectedMockup.innerHeight / selectedMockup.height) * 100 * 1.01}%`,
                        }}
                      >
                        {file && url && mediaMode === "video" && (
                          <video
                            controls={false}
                            muted
                            className="absolute left-1/2 top-1/2 max-w-none transition-transform duration-200"
                            style={{
                              ...mediaSizing,
                              transform: "translate(-50%, -50%)",
                            }}
                            key={url}
                            playsInline
                            unselectable="on"
                            ref={(el) => { videoRefs.current[idx] = el; }}
                            onLoadedMetadata={(event) => {
                              const duration = event.currentTarget.duration;
                              setVideoDurationAt(idx, duration);
                              setVideoDimensionsAt(idx, {
                                width: event.currentTarget.videoWidth,
                                height: event.currentTarget.videoHeight,
                              });
                              const { start } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                              event.currentTarget.currentTime = start;
                              if (previewPlaying) {
                                event.currentTarget.play().catch(() => {});
                              } else {
                                event.currentTarget.pause();
                              }
                            }}
                            onTimeUpdate={(event) => {
                              if (!previewPlaying || transpilingStarted) return;
                              const duration = event.currentTarget.duration;
                              const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                              if (event.currentTarget.currentTime >= end) {
                                if (loopShorter) {
                                  event.currentTarget.currentTime = start;
                                  event.currentTarget.play().catch(() => {});
                                } else {
                                  event.currentTarget.currentTime = Math.max(end - 0.001, start);
                                  pauseCompletedPreview();
                                }
                              }
                            }}
                            onEnded={(event) => {
                              if (transpilingStarted || !previewPlaying) return;
                              const duration = event.currentTarget.duration;
                              const { start, end } = getEffectiveTrimWindow(videoStartOffsets[idx] ?? 0, videoEndOffsets[idx] || duration, duration);
                              if (loopShorter) {
                                event.currentTarget.currentTime = start;
                                event.currentTarget.play().catch(() => {});
                              } else {
                                event.currentTarget.currentTime = Math.max(end - 0.001, start);
                                pauseCompletedPreview();
                              }
                            }}
                          >
                            <source src={url} />
                          </video>
                        )}
                        {file && url && mediaMode === "image" && (
                          <img
                            src={url}
                            alt={`Uploaded screen ${idx + 1}`}
                            className="absolute left-1/2 top-1/2 max-w-none transition-transform duration-200"
                            style={{
                              ...mediaSizing,
                              transform: "translate(-50%, -50%)",
                            }}
                            onLoad={(event) => {
                              setVideoDimensionsAt(idx, {
                                width: event.currentTarget.naturalWidth,
                                height: event.currentTarget.naturalHeight,
                              });
                            }}
                            draggable={false}
                          />
                        )}
                      </div>

                      <img
                        src={selectedMockup.imageRelative}
                        alt={selectedMockup.name + " mockup"}
                        width={selectedMockup.width}
                        height={selectedMockup.height}
                        className="h-full w-full relative object-contain pointer-events-none"
                        draggable={false}
                      />
                      <label
                        className="w-full h-full absolute cursor-pointer top-0"
                        onDragOver={(e) => { e.preventDefault(); setActiveDragIdx(idx); }}
                        onDragLeave={(e) => { e.preventDefault(); setActiveDragIdx(null); }}
                        onDrop={handleDropAt(idx)}
                      >
                        <input
                          type="file"
                          className="hidden"
                          accept={`${mediaMode}/*`}
                          onChange={handleFileChangeAt(idx)}
                        />
                      </label>
                    </div>
                </div>
              );
            })}
          </div>

          {allVideosLoaded && !transpilingStarted && !transpilingFinished && (
            <button
              className="z-10 cursor-pointer flex items-center text-black/70 bg-white/90 hover:scale-105 transition-all ease-in-out shadow-md border-white/5 shadow-black/5 border backdrop-blur-3xl px-3.5 gap-1 text-sm font-medium py-1 rounded-md absolute bottom-3 left-4"
              onClick={handleGenerate}
            >
              <span>Generate {mediaMode === "video" ? "Video" : "Image"}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M9.58 1.077a.75.75 0 0 1 .405.82L9.165 6h4.085a.75.75 0 0 1 .567 1.241l-6.5 7.5a.75.75 0 0 1-1.302-.638L6.835 10H2.75a.75.75 0 0 1-.567-1.241l6.5-7.5a.75.75 0 0 1 .897-.182Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}

          {!transpilingStarted && !transpilingFinished && (
            <div className="absolute top-4 right-4 z-10">
              <Popover>
                <PopoverTrigger aria-label="Settings">
                  <div className="w-8 h-8 bg-black/5 p-1.5 rounded-full group-hover:scale-125 ease-springy transform-gpu transition-all duration-300 hover:bg-black/10 hover:ease-in-out cursor-pointer">
                    <div className="w-full h-full text-black/40">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M9.66852 16.5404L7.67137 19.7958C6.8191 21.185 4.89246 21.4125 3.74002 20.2601C2.58758 19.1076 2.81511 17.181 4.20431 16.3287L7.45968 14.3316C7.73521 14.1625 7.78034 13.7804 7.55177 13.5518L6.41423 12.4143C5.63317 11.6332 5.63317 10.3669 6.41423 9.58586L7.14646 8.85363C7.34173 8.65837 7.65831 8.65837 7.85357 8.85363L15.1465 16.1465C15.3417 16.3418 15.3417 16.6584 15.1465 16.8536L14.4142 17.5859C13.6332 18.3669 12.3669 18.3669 11.5858 17.5859L10.4483 16.4483C10.2197 16.2198 9.83756 16.2649 9.66852 16.5404Z"
                          fill="currentColor"
                        ></path>
                        <path
                          d="M16.6464 14.6464L9.35348 7.3535C9.15821 7.15823 9.15822 6.84164 9.35349 6.64638L12.1186 3.8814C13.2902 2.70989 15.1896 2.7099 16.3612 3.88142L20.1185 7.63865C21.2901 8.81022 21.2901 10.7097 20.1185 11.8813L17.3535 14.6464C17.1582 14.8416 16.8416 14.8416 16.6464 14.6464Z"
                          fill="currentColor"
                        ></path>
                      </svg>
                    </div>
                  </div>
                </PopoverTrigger>
                <PopoverContent className="px-3 py-2 rounded-lg backdrop-blur-3xl shadow-2xl shadow-black/10 bg-black/5 mt-3 ring-1 ring-black/5 PopoverContent flex flex-col w-[min(16.8rem,calc(60vw-1.2rem))] overflow-hidden">
                  <label className="font-normal mb-0.5 text-black/80 text-xs">Devices</label>
                  <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                    <div className="relative flex items-center">
                      <div
                        className="absolute inset-y-0 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow"
                        style={{ width: `${100 / 3}%`, left: `${((deviceCount - 1) * 100) / 3}%` }}
                      />
                      {[1, 2, 3].map((n) => (
                        <button
                          key={n}
                          className="relative flex-1 flex text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                          onClick={() => setDeviceCount(n as DeviceCount)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {deviceCount > 1 && (
                    <>
                      {mediaMode === "video" && (
                        <>
                          <hr className="my-1.5 border-none" />
                          <label className="font-normal mb-0.5 text-black/80 text-xs flex items-center justify-between">
                            Shorter video behavior
                          </label>
                          <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                            <div className="relative flex items-center">
                              <div
                                className={cn(
                                  "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                                  loopShorter ? "translate-x-0" : "translate-x-full",
                                )}
                              />
                              <button
                                className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                                onClick={() => setLoopShorter(true)}
                              >
                                Loop
                              </button>
                              <button
                                className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                                onClick={() => setLoopShorter(false)}
                              >
                                Freeze
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                      <hr className="my-1.5 border-none" />
                      <label className="font-normal mb-0.5 text-black/80 text-xs flex justify-between items-center">
                        <span>Gap</span>
                        <span className="font-mono text-black/50">{deviceGapPercent}%</span>
                      </label>
                      <Slider
                        max={12}
                        step={0.5}
                        min={0}
                        value={[deviceGapPercent]}
                        onValueChange={(v) => setDeviceGapPercent(v[0])}
                      />
                    </>
                  )}

                  <hr className="my-1.5 border-none" />
                  <label className="font-normal mb-0.5 text-black/80 text-xs">Device</label>
                  <div className="flex relative items-center w-full">
                    <select
                      tabIndex={-1}
                      className="appearance-none bg-white/60 rounded-md px-3 py-1 w-full text-xs font-normal text-black/80 cursor-pointer"
                      value={selectedMockup.name}
                      onChange={(event) => {
                        setSelectedMockup(mockupsDefs.find((mockup) => mockup.name === event.target.value)!);
                      }}
                    >
                      {mockupGroups.map((group) => (
                        <optgroup key={group} label={group}>
                          {mockupsDefs
                            .filter((mockup) => mockup.group === group)
                            .map((mockup) => (
                              <option key={mockup.name} value={mockup.name}>
                                {mockup.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className="absolute right-1 text-black/70 pointer-events-none">
                      <ChevronDown />
                    </div>
                  </div>

                  <hr className="my-1.5 border-none" />
                  <label className="font-normal mb-0.5 text-black/80 text-xs">Aspect Ratio</label>
                  <div className="flex relative items-center w-full">
                    <select
                      value={selectedAspectRatio.name}
                      tabIndex={-1}
                      className="appearance-none bg-white/60 rounded-md px-3 py-1 w-full text-xs font-normal text-black/80 cursor-pointer"
                      onChange={(event) => {
                        setSelectedAspectRatio(aspectRatios.find((ratio) => ratio.name === event.target.value)!);
                      }}
                    >
                      {aspectRatios.map((ratio) => (
                        <option key={ratio.name} value={ratio.name}>
                          {ratio.name}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-1 text-black/70 pointer-events-none">
                      <ChevronDown />
                    </div>
                  </div>

                  <hr className="my-1.5 border-none" />
                  <label className="font-normal mb-1 text-black/80 text-xs flex justify-between items-center">
                    Frame Size
                    <button className="text-black/50 cursor-pointer" onClick={() => setScale(90)} aria-label="Reset size">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider
                    max={150}
                    step={1}
                    min={30}
                    value={[scale]}
                    onValueChange={(value) => setScale(value[0])}
                  />

                  <hr className="my-1.5 border-none" />
                  <label className="font-normal mb-1 text-black/80 text-xs flex justify-between items-center">
                    {mediaMode === "video" ? "Video" : "Image"} Size
                    <button className="text-black/50 cursor-pointer" onClick={() => setVideoScale(100)} aria-label="Reset media size">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider
                    max={200}
                    step={1}
                    min={50}
                    value={[videoScale]}
                    onValueChange={(value) => setVideoScale(value[0])}
                  />

                  <hr className="my-1.5 border-none" />
                  <label className="font-normal mb-1 text-black/80 text-xs flex justify-between items-center">
                    Vertical Position
                    <button className="text-black/50 cursor-pointer" onClick={() => setVerticalOffset(0)} aria-label="Reset vertical position">
                      <ResetIcon />
                    </button>
                  </label>
                  <Slider
                    max={100}
                    step={1}
                    min={-100}
                    value={[verticalOffset]}
                    onValueChange={(value) => setVerticalOffset(value[0])}
                  />

                  {mediaMode === "video" && (
                    <>
                      <hr className="my-1.5 border-none" />
                      <label className="font-normal mb-1 text-black/80 text-xs">Framerate</label>
                      <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className={cn(
                              "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                              selectedFramerate === 30 && "translate-x-0",
                              selectedFramerate === 60 && "translate-x-full",
                            )}
                          />
                          <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setSelectedFramerate(30)}>30</button>
                          <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setSelectedFramerate(60)}>60</button>
                        </div>
                      </div>

                      <hr className="my-1.5 border-none" />
                      <label className="font-normal mb-1 text-black/80 text-xs">Output</label>
                      <div className="bg-stone-900/5 rounded-lg text-black/70" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className={cn(
                              "absolute left-0 inset-y-0 w-1/2 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow",
                              exportFormat === "mp4" && "translate-x-0",
                              exportFormat === "webm-transparent" && "translate-x-full",
                            )}
                          />
                          <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setExportFormat("mp4")}>MP4</button>
                          <button className="relative flex-1 text-xs font-semibold items-center justify-center cursor-pointer m-px p-px py-0.5" onClick={() => setExportFormat("webm-transparent")}>WebM</button>
                        </div>
                      </div>
                    </>
                  )}

                  {!isTransparentExport && (
                    <>
                      <hr className="my-1.5 border-none" />
                      <label className="font-normal mb-1 text-black/80 text-xs">Background</label>
                      <div className="bg-stone-900/5 rounded-lg text-black/70 mb-2" style={{ padding: 2 }}>
                        <div className="relative flex items-center">
                          <div
                            className="absolute inset-y-0 flex bg-white transition-all ease-in-out duration-200 transform rounded-md shadow"
                            style={{ width: `${100 / 3}%`, left: `${["color", "gradient", "image"].indexOf(bgTab) * (100 / 3)}%` }}
                          />
                          {(["color", "gradient", "image"] as BgTab[]).map((t) => (
                            <button
                              key={t}
                              className="relative flex-1 text-xs font-semibold capitalize items-center justify-center cursor-pointer m-px p-px py-0.5"
                              onClick={() => setBgTab(t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {!isTransparentExport && bgTab === "color" && (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 overflow-auto pb-1">
                        {colors.map((color) => (
                          <button
                            key={color}
                            className={cn(
                              "w-6 h-6 rounded-full cursor-pointer flex items-center justify-center border border-black/10 shadow-sm flex-shrink-0",
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => setSolidColor(normalizeColorHex(color))}
                            aria-label={`Color ${color}`}
                          >
                            {solidColor === color && <div className="bg-white shadow-sm rounded-full h-2.5 w-2.5" />}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-black/70">
                        <span className="flex-1">Custom</span>
                        <input
                          type="color"
                          autoComplete="off"
                          value={solidColor}
                          onChange={(e) => setSolidColor(normalizeColorHex(e.target.value))}
                          className={colorPickerSwatchInputClassName}
                        />
                      </label>
                    </div>
                  )}

                  {!isTransparentExport && bgTab === "gradient" && (
                    <div className="flex flex-col gap-2">
                      <div
                        className="h-8 w-full rounded-md border border-black/10"
                        style={{ background: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})` }}
                      />
                      <div className="flex items-center gap-2 text-xs text-black/70">
                        <span className="w-12">From</span>
                        <input
                          type="color"
                          autoComplete="off"
                          value={gradient.from}
                          onChange={(e) => setGradient((g) => ({ ...g, from: e.target.value }))}
                          className={colorPickerSwatchInputClassName}
                        />
                        <span className="w-8 text-right">To</span>
                        <input
                          type="color"
                          autoComplete="off"
                          value={gradient.to}
                          onChange={(e) => setGradient((g) => ({ ...g, to: e.target.value }))}
                          className={colorPickerSwatchInputClassName}
                        />
                      </div>
                      <label className="text-xs text-black/70 flex justify-between items-center">
                        <span>Angle</span>
                        <span className="font-mono text-black/50">{gradient.angle}°</span>
                      </label>
                      <Slider
                        max={360}
                        step={1}
                        min={0}
                        value={[gradient.angle]}
                        onValueChange={(v) => setGradient((g) => ({ ...g, angle: v[0] }))}
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {gradientPresets.map((p) => (
                          <button
                            key={p.from + p.to}
                            className="h-6 w-6 rounded-full border border-black/10 cursor-pointer flex-shrink-0"
                            style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                            onClick={() => setGradient((g) => ({ ...g, from: p.from, to: p.to }))}
                            aria-label="Gradient preset"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {!isTransparentExport && bgTab === "image" && (
                    <div className="flex flex-col gap-2">
                      {bgImageUrl ? (
                        <div className="relative">
                          <img src={bgImageUrl} alt="Background preview" className="h-20 w-full object-cover rounded-md border border-black/10" />
                          <button
                            className="absolute top-1 right-1 bg-white/90 rounded-full px-2 py-0.5 text-[10px] font-medium text-black/70 cursor-pointer shadow"
                            onClick={() => setBgImageFile(null)}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                      <label className="cursor-pointer text-center text-xs text-black/70 bg-white/60 hover:bg-white rounded-md py-2 border border-dashed border-black/15">
                        {bgImageFile ? "Replace image" : "Upload image"}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleBgImageChange}
                        />
                      </label>
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          )}

          {anyVideoLoaded && !transpilingStarted && !transpilingFinished && (
            <div className="hidden sm:block bottom-3 right-4 absolute text-xs text-black/50 font-mono z-10">
              {videoFiles.filter((f): f is File => !!f).map((f, i) => (
                <div key={i}>{smartTrim(f.name, 16)} | {Math.fround(f.size / 1000000).toPrecision(3)}/Mb</div>
              ))}
            </div>
          )}

          {transpilingStarted && !transpilingFinished && (
            <>
              <div className="absolute transition-all h-full w-full left-0" />
              <div
                className="absolute transition-all h-full left-0 bg-black/5"
                style={{ width: `${progress}%` }}
              />
              <div className="w-full h-full absolute pointer-events-none" />
              <div className="text-xs bottom-3 left-4 text-black/50 font-mono absolute">
                <span>Generating {mediaMode}... {Math.min(Math.round(progress), 100)}%</span>
              </div>
            </>
          )}

          {transpilingFinished && finishedVideoUrl && (
            <div className="bg-white/20 backdrop-blur-md absolute transition-all h-full flex items-center justify-center w-full left-0 z-20">
              <div className="flex flex-col items-center">
                <button
                  className="cursor-pointer flex items-center text-black/70 bg-white/90 hover:scale-105 transition-all ease-in-out shadow-md border-black/10 border backdrop-blur-3xl px-3.5 gap-1 text-sm font-medium py-1 rounded-md"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = finishedVideoUrl;
                    a.download = mediaMode === "image" ? "mockup.png" : isTransparentExport ? "mockup.webm" : "mockup.mp4";
                    a.click();
                  }}
                >
                  <span>Download {mediaMode === "video" ? "Video" : "Image"}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-4 h-4"
                  >
                    <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                  </svg>
                </button>
                <hr className="my-1 border-none" />
                <button
                  className="cursor-pointer flex items-center font-semibold text-black/60 hover:underline underline-offset-2 group/edit drop-shadow-sm shadow-black gap-1 text-xs hover:scale-105 ease-in-out"
                  onClick={handleContinueEditing}
                >
                  <span>Continue Editing</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5 group-hover/edit:-translate-y-0.5 ease-in-out transition-all duration-300"
                  >
                    <path d="M11.94 1.94a1.5 1.5 0 0 1 2.12 2.12l-.88.88-2.12-2.12.88-.88Z" />
                    <path d="M10 3.88 2.75 11.13A2.75 2.75 0 0 0 2 12.56V14h1.44a2.75 2.75 0 0 0 1.43-.75L12.12 6 10 3.88Z" />
                  </svg>
                </button>
                <hr className="my-1 border-none" />
                <button
                  className="cursor-pointer flex items-center font-semibold text-black/60 hover:underline underline-offset-2 group/retry drop-shadow-sm shadow-black gap-1 text-xs hover:scale-105 ease-in-out"
                  onClick={handleReset}
                >
                  <span>Start Over</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5 group-hover/retry:rotate-180 ease-in-out transition-all duration-300"
                  >
                    <path
                      fillRule="evenodd"
                      d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08.932.75.75 0 0 1-1.3-.75 6 6 0 0 1 9.44-1.242l.842.84V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.241l-.84-.84v1.371a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.841.841a4.5 4.5 0 0 0 7.08-.932.75.75 0 0 1 1.025-.273Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {mediaMode === "video" && anyVideoLoaded && !transpilingStarted && !transpilingFinished && (
        <div className="w-full max-w-2xl px-[5%] pt-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-md bg-white/60 px-2.5 py-2 text-xs text-black/60 shadow-sm ring-1 ring-black/5 backdrop-blur-xl">
              <span className="font-medium text-black/70">Preview</span>
              <button
                className="flex h-7 min-w-20 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-white/80 px-2.5 font-semibold text-black/70 shadow-sm transition-colors hover:bg-white"
                onClick={handleTogglePreviewPlayback}
                aria-label={previewPlaying ? "Pause preview" : "Play preview"}
                title={previewPlaying ? "Pause preview" : "Play preview"}
              >
                {previewPlaying ? <PauseIcon /> : <PlayIcon />}
                <span>{previewPlaying ? "Pause" : "Play"}</span>
              </button>
            </div>
            {deviceCount > 1 && finalPreviewDuration > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-white/60 px-2.5 py-2 text-xs text-black/60 shadow-sm ring-1 ring-black/5 backdrop-blur-xl">
                <span className="w-12 shrink-0 text-left font-medium text-black/70">Final</span>
                <Slider
                  max={Math.max(finalPreviewDuration, frameDuration)}
                  step={frameDuration}
                  min={0}
                  value={[Math.min(previewScrubTime, finalPreviewDuration)]}
                  onValueChange={(value) => handlePreviewScrubChange(value[0])}
                  className="min-w-0 flex-1"
                />
                <span className="w-32 shrink-0 text-right font-mono text-[11px] text-black/50">
                  {formatFrameTimestamp(Math.min(previewScrubTime, finalPreviewDuration), selectedFramerate)}
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-black/50">
                  {selectedFramerate}fps
                </span>
              </div>
            )}
            {videoFiles.map((file, idx) => {
              if (!file) return null;

              const duration = videoDurations[idx] ?? 0;
              const startOffset = clampStartOffset(videoStartOffsets[idx] ?? 0, duration);
              const endOffset = clampEndOffset(videoEndOffsets[idx] || duration, duration);
              const maxStartOffset = Math.max(duration - frameDuration, 0);
              const canTrim = duration > frameDuration;
              const startFrame = Math.max(Math.round(startOffset * selectedFramerate), 0);
              const endFrame = Math.max(Math.round(endOffset * selectedFramerate), 0);
              const maxStartFrame = Math.max(Math.floor(maxStartOffset * selectedFramerate), 0);
              const maxEndFrame = Math.max(Math.round(duration * selectedFramerate), 1);

              return (
                <div
                  key={`${idx}-${file.name}-${file.lastModified}`}
                  className="flex flex-col gap-2 rounded-md bg-white/60 px-2.5 py-2 text-xs text-black/60 shadow-sm ring-1 ring-black/5 backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 text-left font-medium text-black/70">
                      {deviceCount > 1 ? `Video ${idx + 1}` : smartTrim(file.name, 24)}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-black/50">
                      {formatFrameTimestamp(Math.max(endOffset - startOffset, 0), selectedFramerate)}
                    </span>
                    <button
                      className="shrink-0 text-black/50 cursor-pointer disabled:cursor-default disabled:opacity-30"
                      onClick={() => handleResetTrimAt(idx)}
                      disabled={startOffset === 0 && endOffset === duration}
                      aria-label={`Reset video ${idx + 1} trim`}
                    >
                      <ResetIcon />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-left font-medium text-black/60">Start</span>
                    <Slider
                      max={Math.max(maxStartOffset, MIN_REMAINING_SECONDS)}
                      step={frameDuration}
                      min={0}
                      value={[startOffset]}
                      disabled={!canTrim || maxStartOffset <= 0}
                      onValueChange={(value) => handleStartOffsetChange(idx, value[0])}
                      className="min-w-0 flex-1"
                    />
                    <div className="flex w-36 shrink-0 items-center justify-end gap-1.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={maxStartFrame}
                        step={1}
                        value={startFrame}
                        disabled={!canTrim || maxStartOffset <= 0}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(value)) handleStartOffsetChange(idx, value / selectedFramerate);
                        }}
                        className="h-7 w-20 rounded-md border border-black/10 bg-white/70 px-1.5 text-right font-mono text-[11px] text-black/70 shadow-sm disabled:opacity-40"
                        aria-label={`Video ${idx + 1} start frame`}
                      />
                      <span className="w-10 text-right font-mono text-[11px] text-black/50">
                        {formatTimestamp(startOffset)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-left font-medium text-black/60">End</span>
                    <Slider
                      max={Math.max(duration, MIN_REMAINING_SECONDS)}
                      step={frameDuration}
                      min={frameDuration}
                      value={[endOffset]}
                      disabled={!canTrim}
                      onValueChange={(value) => handleEndOffsetChange(idx, value[0])}
                      className="min-w-0 flex-1"
                    />
                    <div className="flex w-36 shrink-0 items-center justify-end gap-1.5">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={maxEndFrame}
                        step={1}
                        value={endFrame}
                        disabled={!canTrim}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(value)) handleEndOffsetChange(idx, value / selectedFramerate);
                        }}
                        className="h-7 w-20 rounded-md border border-black/10 bg-white/70 px-1.5 text-right font-mono text-[11px] text-black/70 shadow-sm disabled:opacity-40"
                        aria-label={`Video ${idx + 1} end frame`}
                      />
                      <span className="w-10 text-right font-mono text-[11px] text-black/50">
                        {formatTimestamp(endOffset)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-between items-center py-3">
        <div className="text-xs flex items-start text-black/50 gap-x-0.5 mx-8">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M8.5 1.709a.75.75 0 0 0-1 0 8.963 8.963 0 0 1-4.84 2.217.75.75 0 0 0-.654.72 10.499 10.499 0 0 0 5.647 9.672.75.75 0 0 0 .694-.001 10.499 10.499 0 0 0 5.647-9.672.75.75 0 0 0-.654-.719A8.963 8.963 0 0 1 8.5 1.71Zm2.34 5.504a.75.75 0 0 0-1.18-.926L7.394 9.17l-1.156-.99a.75.75 0 1 0-.976 1.138l1.75 1.5a.75.75 0 0 0 1.078-.106l2.75-3.5Z"
              clipRule="evenodd"
            />
          </svg>
          <span className="flex-1 flex">This app runs 100% locally, so your {mediaMode} data never leaves your device.</span>
        </div>
        <div className="text-xs text-black/30">© Laurids Kern {new Date().getFullYear()}</div>
      </div>
    </main>
  );
}

function ChevronDown() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
      <path
        fillRule="evenodd"
        d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
      <path
        fillRule="evenodd"
        d="M12.5 9.75A2.75 2.75 0 0 0 9.75 7H4.56l2.22 2.22a.75.75 0 1 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5a.75.75 0 0 1 1.06 1.06L4.56 5.5h5.19a4.25 4.25 0 0 1 0 8.5h-1a.75.75 0 0 1 0-1.5h1a2.75 2.75 0 0 0 2.75-2.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4.25 3.14v9.72c0 .64.7 1.03 1.24.68l7.08-4.86a.82.82 0 0 0 0-1.36L5.49 2.46a.82.82 0 0 0-1.24.68Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
      <path d="M4.75 2.5A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 1 0 2.5 0v-8.5A1.25 1.25 0 0 0 4.75 2.5Zm6.5 0A1.25 1.25 0 0 0 10 3.75v8.5a1.25 1.25 0 1 0 2.5 0v-8.5a1.25 1.25 0 0 0-1.25-1.25Z" />
    </svg>
  );
}
