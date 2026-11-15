export async function readFileAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (PNG, JPG ou WebP).');
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Não foi possível ler a imagem selecionada.'));
      }
    };
    reader.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
    reader.readAsDataURL(file);
  });
}

export function compressCanvasToDataUrl(sourceCanvas: HTMLCanvasElement): string {
  const renderResized = (maxSide: number, quality: number): string => {
    const maxDim = Math.max(sourceCanvas.width, sourceCanvas.height, 1);
    const scale = Math.min(1, maxSide / maxDim);
    const width = Math.max(1, Math.round(sourceCanvas.width * scale));
    const height = Math.max(1, Math.round(sourceCanvas.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível processar a imagem no navegador.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  let dataUrl = renderResized(420, 0.82);
  if (dataUrl.length > 120000) {
    dataUrl = renderResized(320, 0.74);
  }
  if (dataUrl.length > 140000) {
    dataUrl = renderResized(220, 0.65);
  }
  if (dataUrl.length > 149000) {
    throw new Error('A imagem é muito grande mesmo após compressão. Escolha outra foto.');
  }

  return dataUrl;
}

export async function compressProductImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (PNG, JPG ou WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível processar a imagem no navegador.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);

    return compressCanvasToDataUrl(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
