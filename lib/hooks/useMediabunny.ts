import { useState, useRef, useCallback } from 'react';
import {
  Input,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  BlobSource,
  Conversion,
  ALL_FORMATS,
  QUALITY_HIGH,
  VideoSampleSink,
  VideoSample,
} from 'mediabunny';
import { Mockup } from '../constants/mockups';

export type Background =
  | { type: 'color'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'image'; file: File };

export type ExportFormat = 'mp4' | 'webm-transparent';

type GenerateVideoParams = {
  videoFiles: File[];
  mockup: Mockup;
  background: Background;
  canvasWidth: number;
  canvasHeight: number;
  phoneSizePercentage: number;
  videoSizePercentage: number;
  mockupBackgroundColor: string;
  verticalOffset: number;
  frameRate: number;
  exportFormat: ExportFormat;
  loopShorter: boolean;
  videoStartTimes: number[];
  videoEndTimes: number[];
  deviceGapPercent: number;
};

type GenerateImageParams = Omit<
  GenerateVideoParams,
  'videoFiles' | 'frameRate' | 'exportFormat' | 'loopShorter' | 'videoStartTimes' | 'videoEndTimes'
> & {
  imageFiles: File[];
};

interface UseMediabunnyHook {
  progress: number;
  reset: () => void;
  transpilingStarted: boolean;
  transpilingFinished: boolean;
  finishedVideoUrl: string | null;
  generateVideo: (params: GenerateVideoParams) => Promise<void>;
  generateImage: (params: GenerateImageParams) => Promise<void>;
}

const createRoundedRectPath = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const computeLayout = (
  canvasWidth: number,
  canvasHeight: number,
  mockup: Mockup,
  phoneSizePercentage: number,
  verticalOffset: number,
  count: number,
  gapPercent: number,
) => {
  const mockupAspect = mockup.width / mockup.height;
  const gapPx = count > 1 ? Math.round((canvasWidth * gapPercent) / 100) : 0;
  const totalGapPx = gapPx * Math.max(0, count - 1);
  const columnWidth = count > 0 ? (canvasWidth - totalGapPx) / count : canvasWidth;
  const maxHeightFromColumn = (columnWidth * 0.97) / mockupAspect;
  const maxHeightFromCanvas = canvasHeight * (phoneSizePercentage / 100);
  const mockupHeight = Math.min(maxHeightFromColumn, maxHeightFromCanvas);
  const mockupWidth = mockupHeight * mockupAspect;
  const mockupScale = mockupHeight / mockup.height;
  const mockupInnerHeight = Math.round(mockup.innerHeight * mockupScale);
  const mockupInnerWidth = Math.round(mockup.innerWidth * mockupScale);
  const borderRadius = mockup.cornerRadius * mockupScale;
  const offsetX = (mockup.innerX ?? (mockup.width - mockup.innerWidth) / 2) * mockupScale;
  const offsetY = (mockup.innerY ?? (mockup.height - mockup.innerHeight) / 2) * mockupScale;
  const offsetInPixels = (verticalOffset / 100) * canvasHeight;

  const totalRowWidth = count * mockupWidth + totalGapPx;
  const rowStartX = (canvasWidth - totalRowWidth) / 2;

  const slots = Array.from({ length: count }, (_, i) => {
    const posX = rowStartX + i * (mockupWidth + gapPx);
    const posY = ((canvasHeight - mockupHeight) / 2 + offsetInPixels) * 0.9;
    return { posX, posY };
  });

  return {
    slots,
    mockupWidth,
    mockupHeight,
    mockupInnerWidth,
    mockupInnerHeight,
    offsetX,
    offsetY,
    borderRadius,
  };
};

const paintBackground = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  background: Background,
  backgroundImage: ImageBitmap | null,
) => {
  if (background.type === 'color') {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (background.type === 'gradient') {
    const rad = (background.angle * Math.PI) / 180;
    const cx = width / 2;
    const cy = height / 2;
    const half = Math.abs(Math.cos(rad)) * width / 2 + Math.abs(Math.sin(rad)) * height / 2;
    const dx = Math.cos(rad) * half;
    const dy = Math.sin(rad) * half;
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  if (background.type === 'image' && backgroundImage) {
    const imgAspect = backgroundImage.width / backgroundImage.height;
    const canvasAspect = width / height;
    let sx = 0, sy = 0, sw = backgroundImage.width, sh = backgroundImage.height;
    if (imgAspect > canvasAspect) {
      sw = backgroundImage.height * canvasAspect;
      sx = (backgroundImage.width - sw) / 2;
    } else {
      sh = backgroundImage.width / canvasAspect;
      sy = (backgroundImage.height - sh) / 2;
    }
    ctx.drawImage(backgroundImage, sx, sy, sw, sh, 0, 0, width, height);
    return;
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
};

const getCoveredVideoRect = (
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  videoSizePercentage: number,
) => {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: targetX, y: targetY, width: targetWidth, height: targetHeight };
  }

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight) * (videoSizePercentage / 100);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: targetX + (targetWidth - width) / 2,
    y: targetY + (targetHeight - height) / 2,
    width,
    height,
  };
};

const useMediabunny = (): UseMediabunnyHook => {
  const [progress, setProgress] = useState(0);
  const [transpilingStarted, setTranspilingStarted] = useState(false);
  const [transpilingFinished, setTranspilingFinished] = useState(false);
  const [finishedVideoUrl, setFinishedVideoUrl] = useState<string | null>(null);
  const conversionRef = useRef<Conversion | null>(null);

  const reset = useCallback(() => {
    setProgress(0);
    setTranspilingStarted(false);
    setTranspilingFinished(false);
    setFinishedVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    conversionRef.current = null;
  }, []);

  const generateVideo = async ({
    videoFiles,
    mockup,
    background,
    mockupBackgroundColor,
    phoneSizePercentage,
    videoSizePercentage,
    verticalOffset,
    canvasWidth,
    canvasHeight,
    frameRate,
    exportFormat,
    loopShorter,
    videoStartTimes,
    videoEndTimes,
    deviceGapPercent,
  }: GenerateVideoParams): Promise<void> => {
    setTranspilingStarted(true);
    setTranspilingFinished(false);
    setProgress(0);

    try {
      const count = videoFiles.length;
      const layout = computeLayout(canvasWidth, canvasHeight, mockup, phoneSizePercentage, verticalOffset, count, deviceGapPercent);
      const {
        slots,
        mockupWidth,
        mockupHeight,
        mockupInnerWidth,
        mockupInnerHeight,
        offsetX,
        offsetY,
        borderRadius,
      } = layout;
      const coloredSquareWidth = Math.round(mockupInnerWidth * 1.01);
      const coloredSquareHeight = Math.round(mockupInnerHeight * 1.01);
      const transparentBackground = exportFormat === 'webm-transparent';

      const mockupImageResponse = await fetch(mockup.imageRelative);
      const mockupImageBlob = await mockupImageResponse.blob();
      const mockupImage = await createImageBitmap(mockupImageBlob);

      let backgroundImage: ImageBitmap | null = null;
      if (background.type === 'image') {
        backgroundImage = await createImageBitmap(background.file);
      }

      const inputs = videoFiles.map(
        (file) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
      );
      const durations = await Promise.all(inputs.map((input) => input.computeDuration()));
      const frameDuration = 1 / frameRate;
      const requestedEndTimes = durations.map((duration, idx) => {
        const requestedEnd = videoEndTimes[idx] ?? duration;
        return Math.min(Math.max(requestedEnd || duration, 0), duration);
      });
      const startTimes = durations.map((duration, idx) => {
        const requestedStart = videoStartTimes[idx] ?? 0;
        const maxStart = Math.max(requestedEndTimes[idx] - frameDuration, 0);
        return Math.min(Math.max(requestedStart, 0), maxStart);
      });
      const endTimes = durations.map((duration, idx) => {
        const minEnd = Math.min(duration, startTimes[idx] + frameDuration);
        return Math.min(Math.max(requestedEndTimes[idx], minEnd), duration);
      });
      const effectiveDurations = durations.map((_, idx) => Math.max(endTimes[idx] - startTimes[idx], 0));
      const maxDuration = Math.max(...effectiveDurations);
      if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
        throw new Error('Unable to generate video because all selected videos have no remaining duration.');
      }
      const driverIdx = effectiveDurations.indexOf(maxDuration);

      const sampleSinks: Array<{
        idx: number;
        sink: VideoSampleSink;
        duration: number;
        startTime: number;
        endTime: number;
        effectiveDuration: number;
        lastSample: VideoSample | null;
      }> = [];

      for (let i = 0; i < inputs.length; i++) {
        const track = await inputs[i].getPrimaryVideoTrack();
        if (!track) continue;
        sampleSinks.push({
          idx: i,
          sink: new VideoSampleSink(track),
          duration: durations[i],
          startTime: startTimes[i],
          endTime: endTimes[i],
          effectiveDuration: effectiveDurations[i],
          lastSample: null,
        });
      }

      const output = new Output({
        format: transparentBackground ? new WebMOutputFormat() : new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d', {
        alpha: transparentBackground,
        willReadFrequently: false,
      })!;

      const drawBackdrop = (slot: { posX: number; posY: number }) => {
        const squareX = Math.round((slot.posX + offsetX) * 0.995);
        const squareY = Math.round((slot.posY + offsetY) * 0.995);
        ctx.save();
        createRoundedRectPath(ctx, squareX, squareY, coloredSquareWidth, coloredSquareHeight, borderRadius);
        ctx.fillStyle = mockupBackgroundColor;
        ctx.fill();
        ctx.restore();
      };

      const drawMockupOverlay = (slot: { posX: number; posY: number }) => {
        ctx.drawImage(mockupImage, slot.posX, slot.posY, mockupWidth, mockupHeight);
      };

      const drawVideoFrame = (slot: { posX: number; posY: number }, sample: VideoSample) => {
        const videoX = Math.round((slot.posX + offsetX) * 0.9995);
        const videoY = Math.round((slot.posY + offsetY) * 0.9995);
        ctx.save();
        createRoundedRectPath(ctx, videoX, videoY, mockupInnerWidth, mockupInnerHeight, borderRadius);
        ctx.clip();
        const videoRect = getCoveredVideoRect(
          sample.displayWidth,
          sample.displayHeight,
          videoX,
          videoY,
          mockupInnerWidth,
          mockupInnerHeight,
          videoSizePercentage,
        );
        sample.draw(ctx, videoRect.x, videoRect.y, videoRect.width, videoRect.height);
        ctx.restore();
      };

      const conversion = await Conversion.init({
        input: inputs[driverIdx],
        output,
        video: {
          width: canvasWidth,
          height: canvasHeight,
          fit: 'fill',
          frameRate,
          codec: transparentBackground ? 'vp9' : 'avc',
          bitrate: QUALITY_HIGH,
          alpha: transparentBackground ? 'keep' : 'discard',
          process: async (driverSample) => {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            if (!transparentBackground) {
              paintBackground(ctx, canvasWidth, canvasHeight, background, backgroundImage);
            }

            const t = driverSample.timestamp;
            const samplesByIdx = new Map<number, VideoSample>();

            for (const entry of sampleSinks) {
              let sampleTime: number;
              if (entry.idx !== driverIdx && loopShorter && entry.effectiveDuration > 0) {
                sampleTime = entry.startTime + (t % entry.effectiveDuration);
              } else {
                const frozenRelativeTime = Math.min(t, Math.max(entry.effectiveDuration - frameDuration, 0));
                sampleTime = entry.startTime + frozenRelativeTime;
              }
              sampleTime = Math.min(sampleTime, Math.max(entry.endTime - frameDuration, entry.startTime));
              const sample = await entry.sink.getSample(sampleTime);
              if (sample) {
                if (entry.lastSample && entry.lastSample !== sample) {
                  entry.lastSample.close();
                }
                entry.lastSample = sample;
                samplesByIdx.set(entry.idx, sample);
              } else if (entry.lastSample) {
                samplesByIdx.set(entry.idx, entry.lastSample);
              }
            }

            for (let i = 0; i < count; i++) {
              drawBackdrop(slots[i]);
              const sample = samplesByIdx.get(i);
              if (sample) drawVideoFrame(slots[i], sample);
              drawMockupOverlay(slots[i]);
            }

            return canvas;
          },
        },
        audio: { discard: true },
        trim: { start: startTimes[driverIdx], end: endTimes[driverIdx] },
      });

      conversionRef.current = conversion;

      conversion.onProgress = (progressValue: number) => {
        setProgress(progressValue * 100);
      };

      await conversion.execute();

      for (const entry of sampleSinks) {
        entry.lastSample?.close();
      }

      const outputBuffer = output.target.buffer;
      if (outputBuffer) {
        const videoBlob = new Blob([outputBuffer], {
          type: transparentBackground ? 'video/webm' : 'video/mp4',
        });
        const videoUrl = URL.createObjectURL(videoBlob);
        setFinishedVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return videoUrl;
        });
      }
    } catch (error) {
      console.error('Error generating video:', error);
      throw error;
    } finally {
      setTranspilingFinished(true);
      setTranspilingStarted(false);
    }
  };

  const generateImage = async ({
    imageFiles,
    mockup,
    background,
    mockupBackgroundColor,
    phoneSizePercentage,
    videoSizePercentage,
    verticalOffset,
    canvasWidth,
    canvasHeight,
    deviceGapPercent,
  }: GenerateImageParams): Promise<void> => {
    setTranspilingStarted(true);
    setTranspilingFinished(false);
    setProgress(0);

    try {
      const count = imageFiles.length;
      const layout = computeLayout(
        canvasWidth,
        canvasHeight,
        mockup,
        phoneSizePercentage,
        verticalOffset,
        count,
        deviceGapPercent,
      );
      const {
        slots,
        mockupWidth,
        mockupHeight,
        mockupInnerWidth,
        mockupInnerHeight,
        offsetX,
        offsetY,
        borderRadius,
      } = layout;

      const [mockupImage, imageBitmaps] = await Promise.all([
        fetch(mockup.imageRelative)
          .then((response) => response.blob())
          .then((blob) => createImageBitmap(blob)),
        Promise.all(imageFiles.map((file) => createImageBitmap(file))),
      ]);

      let backgroundImage: ImageBitmap | null = null;
      if (background.type === 'image') {
        backgroundImage = await createImageBitmap(background.file);
      }

      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d')!;
      paintBackground(ctx, canvasWidth, canvasHeight, background, backgroundImage);

      for (let i = 0; i < count; i++) {
        const slot = slots[i];
        const screenX = Math.round((slot.posX + offsetX) * 0.9995);
        const screenY = Math.round((slot.posY + offsetY) * 0.9995);
        const backdropX = Math.round((slot.posX + offsetX) * 0.995);
        const backdropY = Math.round((slot.posY + offsetY) * 0.995);

        ctx.save();
        createRoundedRectPath(
          ctx,
          backdropX,
          backdropY,
          Math.round(mockupInnerWidth * 1.01),
          Math.round(mockupInnerHeight * 1.01),
          borderRadius,
        );
        ctx.fillStyle = mockupBackgroundColor;
        ctx.fill();
        ctx.restore();

        ctx.save();
        createRoundedRectPath(ctx, screenX, screenY, mockupInnerWidth, mockupInnerHeight, borderRadius);
        ctx.clip();
        const source = imageBitmaps[i];
        const imageRect = getCoveredVideoRect(
          source.width,
          source.height,
          screenX,
          screenY,
          mockupInnerWidth,
          mockupInnerHeight,
          videoSizePercentage,
        );
        ctx.drawImage(source, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
        ctx.restore();

        ctx.drawImage(mockupImage, slot.posX, slot.posY, mockupWidth, mockupHeight);
      }

      setProgress(100);
      const imageBlob = await canvas.convertToBlob({ type: 'image/png' });
      const imageUrl = URL.createObjectURL(imageBlob);
      setFinishedVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return imageUrl;
      });

      mockupImage.close();
      imageBitmaps.forEach((bitmap) => bitmap.close());
      backgroundImage?.close();
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    } finally {
      setTranspilingFinished(true);
      setTranspilingStarted(false);
    }
  };

  return {
    progress,
    transpilingStarted,
    transpilingFinished,
    finishedVideoUrl,
    generateVideo,
    generateImage,
    reset,
  };
};

export default useMediabunny;
