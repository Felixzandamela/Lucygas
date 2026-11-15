import Cropper from 'cropperjs';
import {
  Check,
  FlipHorizontal2,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { compressCanvasToDataUrl } from '../lib/imageUtils';

interface ImageCropperModalProps {
  imageSrc: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

interface AspectPreset {
  id: string;
  label: string;
  ratio: number;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Livre', ratio: Number.NaN },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '1.9:1', label: '1.9:1', ratio: 1.9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const CROPPER_TEMPLATE =
  '<cropper-canvas background style="width: 100%; height: 100%; display: block;">' +
  '<cropper-image initial-fit="contain" rotatable scalable translatable></cropper-image>' +
  '<cropper-shade hidden></cropper-shade>' +
  '<cropper-handle action="select" plain></cropper-handle>' +
  '<cropper-selection initial-coverage="0.82" aspect-ratio="1" movable resizable outlined>' +
  '<cropper-grid role="grid" bordered covered></cropper-grid>' +
  '<cropper-crosshair centered></cropper-crosshair>' +
  '<cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>' +
  '<cropper-handle action="n-resize"></cropper-handle>' +
  '<cropper-handle action="e-resize"></cropper-handle>' +
  '<cropper-handle action="s-resize"></cropper-handle>' +
  '<cropper-handle action="w-resize"></cropper-handle>' +
  '<cropper-handle action="ne-resize"></cropper-handle>' +
  '<cropper-handle action="nw-resize"></cropper-handle>' +
  '<cropper-handle action="se-resize"></cropper-handle>' +
  '<cropper-handle action="sw-resize"></cropper-handle>' +
  '</cropper-selection>' +
  '</cropper-canvas>';

export function ImageCropperModal({
  imageSrc,
  onCancel,
  onConfirm,
}: ImageCropperModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);

  const [selectedPreset, setSelectedPreset] = useState<string>('1:1');
  const [flipX, setFlipX] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const imgEl = imgRef.current;
    const containerEl = containerRef.current;
    if (!imgEl || !containerEl) return;

    setErrorMsg(null);
    const cropper = new Cropper(imgEl, {
      container: containerEl,
      template: CROPPER_TEMPLATE,
    });
    cropperRef.current = cropper;

    const cropperImage = cropper.getCropperImage();
    if (cropperImage) {
      cropperImage.$ready().catch(() => {
        setErrorMsg('Não foi possível carregar esta imagem para edição.');
      });
    }

    return () => {
      cropper.destroy();
      cropperRef.current = null;
    };
  }, [imageSrc]);

  const handleSelectAspect = (preset: AspectPreset) => {
    setSelectedPreset(preset.id);
    const selection = cropperRef.current?.getCropperSelection();
    if (!selection) return;
    selection.aspectRatio = preset.ratio;
  };

  const handleZoom = (delta: number) => {
    const image = cropperRef.current?.getCropperImage();
    image?.$zoom(delta);
  };

  const handleRotate = (angle: string) => {
    const image = cropperRef.current?.getCropperImage();
    image?.$rotate(angle);
  };

  const handleFlip = () => {
    const image = cropperRef.current?.getCropperImage();
    if (!image) return;
    image.$scale(-1, 1);
    setFlipX((prev) => prev * -1);
  };

  const handleReset = () => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const image = cropper.getCropperImage();
    const selection = cropper.getCropperSelection();
    image?.$resetTransform().$center('contain');
    if (selection) {
      selection.aspectRatio = 1;
    }
    setSelectedPreset('1:1');
    setFlipX(1);
    setErrorMsg(null);
  };

  const handleApply = async () => {
    const selection = cropperRef.current?.getCropperSelection();
    if (!selection) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      const canvas = await selection.$toCanvas({
        width: 520,
        beforeDraw: (ctx, c) => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
        },
      });
      const dataUrl = compressCanvasToDataUrl(canvas);
      onConfirm(dataUrl);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível recortar esta imagem. Se for um link externo, baixe a foto e envie do dispositivo.';
      setErrorMsg(message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Editar e recortar foto do produto"
      className="fixed inset-0 z-[60] bg-slate-950/75 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-xl max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Editar Foto do Produto
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Arraste, dê zoom ou escolha uma proporção rápida
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md cursor-pointer"
            aria-label="Fechar editor"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Quick Aspect Ratios */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Tamanho / Proporção Rápida
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {ASPECT_PRESETS.map((preset) => {
                const active = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectAspect(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'border-orange-600 bg-orange-600 text-white'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cropper Viewport */}
          <div
            ref={containerRef}
            className="w-full h-64 sm:h-80 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900 relative select-none"
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Imagem para recorte"
              crossOrigin={imageSrc.startsWith('http') ? 'anonymous' : undefined}
              className="max-w-full max-h-full block"
            />
          </div>

          {/* Transform Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleZoom(0.15)}
                title="Aproximar (Zoom +)"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Zoom +</span>
              </button>
              <button
                type="button"
                onClick={() => handleZoom(-0.15)}
                title="Afastar (Zoom -)"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Zoom -</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotate('-90deg')}
                title="Girar 90° à esquerda"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>-90°</span>
              </button>
              <button
                type="button"
                onClick={() => handleRotate('90deg')}
                title="Girar 90° à direita"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>+90°</span>
              </button>
              <button
                type="button"
                onClick={handleFlip}
                title="Espelhar horizontalmente"
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                  flipX < 0
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Espelhar</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Redefinir
            </button>
          </div>

          {errorMsg && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400 font-medium">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => void handleApply()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-600 text-white text-xs font-semibold hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{processing ? 'Aplicando...' : 'Aplicar Foto'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
