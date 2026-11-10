/* Ferramentas de otimização: comprimir e reparar */
'use strict';

const COMPRESS_LEVELS = {
    low: { quality: 0.82, maxDim: 2600 },
    recommended: { quality: 0.68, maxDim: 1800 },
    extreme: { quality: 0.5, maxDim: 1200 },
};

/** Desfaz o "predictor" PNG usado em imagens Flate (linhas filtradas como num arquivo .png) */
function undoPngPredictor(data, columns, colors) {
    const bpp = colors, row = columns * colors;
    const rows = Math.floor(data.length / (row + 1));
    const out = new Uint8Array(rows * row);
    for (let y = 0; y < rows; y++) {
        const type = data[y * (row + 1)];
        const src = y * (row + 1) + 1, dst = y * row, up = dst - row;
        for (let x = 0; x < row; x++) {
            const a = x >= bpp ? out[dst + x - bpp] : 0;
            const b = y ? out[up + x] : 0;
            const c = y && x >= bpp ? out[up + x - bpp] : 0;
            let v = data[src + x];
            if (type === 1) v += a;
            else if (type === 2) v += b;
            else if (type === 3) v += (a + b) >> 1;
            else if (type === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[dst + x] = v & 255;
        }
    }
    return out;
}

/** Lê uma imagem do PDF (JPEG ou Flate RGB/cinza de 8 bits) como algo desenhável num canvas */
async function decodePdfImage(obj, ctx) {
    const { PDFName, PDFRawStream, PDFArray, PDFNumber, PDFDict } = PDFLib;
    const N = n => PDFName.of(n);
    const dict = obj.dict;
    if (dict.get(N('ImageMask')) || dict.get(N('Decode')) || dict.get(N('Mask'))) return null;
    const filter = dict.lookup(N('Filter'));
    const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
    const last = filters[filters.length - 1];

    // só RGB ou cinza (CMYK sai com cores erradas no navegador)
    let comps;
    const cs = dict.lookup(N('ColorSpace'));
    if (cs instanceof PDFArray) {
        if (cs.get(0) !== N('ICCBased')) return null;
        const n = cs.lookup(1)?.dict?.get(N('N'));
        if (!(n instanceof PDFNumber) || (n.asNumber() !== 1 && n.asNumber() !== 3)) return null;
        comps = n.asNumber();
    } else if (cs === N('DeviceRGB')) comps = 3;
    else if (cs === N('DeviceGray')) comps = 1;
    else return null;

    if (last === N('DCTDecode')) {
        let bytes = obj.contents;
        if (filters.length > 1) {
            // ex.: [/ASCII85Decode /DCTDecode] — tira as camadas antes do JPEG
            const tmp = dict.clone(ctx);
            tmp.set(N('Filter'), ctx.obj(filters.slice(0, -1)));
            tmp.delete(N('DecodeParms'));
            bytes = PDFLib.decodePDFRawStream(PDFRawStream.of(tmp, obj.contents)).decode();
        }
        return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    }

    if (last === N('FlateDecode')) {
        const num = (d, k, def) => { const v = d?.lookup?.(N(k)); return v instanceof PDFNumber ? v.asNumber() : def; };
        if (num(dict, 'BitsPerComponent', 8) !== 8) return null;
        const w = num(dict, 'Width', 0), hh = num(dict, 'Height', 0);
        if (!w || !hh || w * hh > 40_000_000) return null;
        let parms = dict.lookup(N('DecodeParms'));
        if (parms instanceof PDFArray) parms = parms.lookup(filters.length - 1);
        if (parms && !(parms instanceof PDFDict)) parms = null;
        const predictor = num(parms, 'Predictor', 1);
        if (predictor !== 1 && predictor < 10) return null; // TIFF: raro, deixa como está
        const tmp = dict.clone(ctx);
        tmp.delete(N('DecodeParms'));
        let data = PDFLib.decodePDFRawStream(PDFRawStream.of(tmp, obj.contents)).decode();
        if (predictor >= 10) data = undoPngPredictor(data, num(parms, 'Columns', w), num(parms, 'Colors', comps));
        if (data.length < w * hh * comps) return null;
        const rgba = new Uint8ClampedArray(w * hh * 4);
        for (let i = 0, j = 0, n = w * hh; i < n; i++, j += 4) {
            if (comps === 3) { rgba[j] = data[i * 3]; rgba[j + 1] = data[i * 3 + 1]; rgba[j + 2] = data[i * 3 + 2]; }
            else rgba[j] = rgba[j + 1] = rgba[j + 2] = data[i];
            rgba[j + 3] = 255;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hh;
        canvas.getContext('2d').putImageData(new ImageData(rgba, w, hh), 0, 0);
        return canvas;
    }
    return null;
}

/**
 * Recomprime as imagens dentro do PDF (é onde está o peso de PDFs escaneados
 * e com fotos): JPEGs são regravados com mais compressão e imagens sem perdas
 * (tipo PNG) viram JPEG quando isso compensa. Texto e vetores continuam intactos.
 */
async function recompressImages(doc, { quality, maxDim }, onProgress) {
    const { PDFName, PDFRawStream, PDFNumber } = PDFLib;
    const N = n => PDFName.of(n);
    const ctx = doc.context;
    const images = ctx.enumerateIndirectObjects().filter(([, obj]) =>
        obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image'));

    let changed = 0;
    for (let i = 0; i < images.length; i++) {
        const [ref, obj] = images[i];
        onProgress?.(i / images.length);
        if (obj.contents.length < 20_000) continue; // imagens pequenas não valem a pena
        let src;
        try { src = await decodePdfImage(obj, ctx); } catch (e) { src = null; }
        if (!src) continue;

        const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
        const w = Math.max(1, Math.round(src.width * scale));
        const hh = Math.max(1, Math.round(src.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hh;
        const c2 = canvas.getContext('2d');
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, w, hh);
        c2.imageSmoothingQuality = 'high';
        c2.drawImage(src, 0, 0, w, hh);
        src.close?.();
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        const newBytes = new Uint8Array(await blob.arrayBuffer());
        canvas.width = canvas.height = 0;
        if (newBytes.length > obj.contents.length * 0.9) continue;

        const nd = obj.dict.clone(ctx);
        nd.set(N('Width'), PDFNumber.of(w));
        nd.set(N('Height'), PDFNumber.of(hh));
        nd.set(N('Length'), PDFNumber.of(newBytes.length));
        nd.set(N('ColorSpace'), N('DeviceRGB'));
        nd.set(N('BitsPerComponent'), PDFNumber.of(8));
        nd.set(N('Filter'), N('DCTDecode'));
        nd.delete(N('DecodeParms'));
        ctx.assign(ref, PDFRawStream.of(nd, newBytes));
        changed++;
    }
    return changed;
}

/** Compressão máxima: transforma cada página em imagem */
async function rasterizePdf(bytes, quality, ctx) {
    const src = await PDF.open(bytes);
    const out = await PDFLib.PDFDocument.create();
    try {
        for (let i = 1; i <= src.numPages; i++) {
            ctx.progress((i - 1) / src.numPages, `Página ${i} de ${src.numPages}...`);
            const { canvas, base } = await PDF.render(src, i, { scale: 1.5 });
            const jpg = await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer();
            const img = await out.embedJpg(jpg);
            const page = out.addPage([base.width, base.height]);
            page.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
        }
    } finally {
        src.destroy();
    }
    return await PDF.save(out);
}

/** Otimização sem perdas com qpdf (reorganiza e recomprime a estrutura) */
async function qpdfOptimize(bytes) {
    try {
        const r = await Libs.qpdf(bytes, ['--object-streams=generate', '--compress-streams=y', '--recompress-flate',
            '--compression-level=9', '--decode-level=generalized', '{in}', '{out}']);
        if ((r.code === 0 || r.code === 3) && r.output?.length) return r.output;
    } catch (e) { console.warn('qpdf indisponível', e); }
    return bytes;
}

App.register({
    id: 'compress',
    cat: 'otimizar',
    title: 'Comprimir PDF',
    desc: 'Diminua o tamanho de um ou vários PDFs mantendo a melhor qualidade possível.',
    keywords: 'reduzir diminuir tamanho otimizar',
    icon: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    actionLabel: 'Comprimir PDF',
    doneTitle: 'Compressão concluída',
    next: ['protect', 'merge', 'split', 'sign', 'organize'],
    defaults: { level: 'recommended', rasterQuality: 0.6, metadata: false },
    options(ctx) {
        const raster = h('div', { style: { display: 'grid', gap: '10px' } },
            F.field('Qualidade das páginas', F.range(ctx.opts.rasterQuality, 0.2, 0.9, 0.1, v => ctx.opts.rasterQuality = v, v => Math.round(v * 100) + '%')),
            F.note(h('b', 'Atenção: '), 'neste modo as páginas viram imagem e o texto deixa de ser selecionável.'));
        const meta = F.check('Remover metadados (autor, título, programa usado)', ctx.opts.metadata, v => ctx.opts.metadata = v);
        const sync = () => { raster.hidden = ctx.opts.level !== 'raster'; meta.hidden = ctx.opts.level === 'raster'; };
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.choices('level', [
                { value: 'low', label: 'Leve', hint: 'Alta qualidade, redução menor.' },
                { value: 'recommended', label: 'Recomendada', hint: 'Bom equilíbrio entre qualidade e tamanho.' },
                { value: 'extreme', label: 'Forte', hint: 'Menor arquivo; imagens perdem nitidez.' },
                { value: 'raster', label: 'Máxima (rasterizar)', hint: 'Converte as páginas em imagens. Útil para PDFs muito pesados.' },
            ], ctx.opts.level, v => { ctx.opts.level = v; sync(); }),
            raster, meta);
    },
    zipName: () => 'pdfs-comprimidos.zip',
    resultInfo(ctx) {
        const done = ctx.state.batch;
        const before = done.reduce((t, d) => t + d.file.file.size, 0);
        const after = done.reduce((t, d) => t + d.out.blob.size, 0);
        const same = done.filter(d => d.out.unchanged).length;
        if (same === done.length) {
            return done.length === 1
                ? 'O arquivo já estava otimizado; não foi possível reduzir mais sem perder qualidade.'
                : 'Os arquivos já estavam otimizados; não foi possível reduzir mais sem perder qualidade.';
        }
        const pct = Math.round((1 - after / before) * 100);
        return h('span', `De ${formatBytes(before)} para ${formatBytes(after)} `, h('span.gain', `(−${pct}%)`),
            same ? ` · ${same} já ${same === 1 ? 'estava otimizado' : 'estavam otimizados'}` : '');
    },
    run: ctx => runBatch(ctx, async (f, sub) => {
        let bytes;
        if (ctx.opts.level === 'raster') {
            bytes = await rasterizePdf(f.bytes, ctx.opts.rasterQuality, sub);
        } else {
            const doc = await PDF.load(f.bytes);
            sub.progress(0.05, 'Analisando imagens...');
            await recompressImages(doc, COMPRESS_LEVELS[ctx.opts.level], p => sub.progress(0.05 + p * 0.7, 'Comprimindo imagens...'));
            if (ctx.opts.metadata) stripMetadata(doc);
            sub.progress(0.8, 'Otimizando estrutura...');
            bytes = await PDF.save(doc);
            bytes = await qpdfOptimize(bytes);
        }
        const unchanged = bytes.length >= f.file.size;
        if (unchanged) bytes = new Uint8Array(f.bytes);
        return { blob: pdfBlob(bytes), name: baseName(f.file.name) + '-comprimido.pdf', unchanged };
    }),
});

/** Apaga as informações do documento (autor, título, datas) e o bloco XMP */
function stripMetadata(doc) {
    const { PDFName, PDFRef } = PDFLib;
    const ctx = doc.context;
    const info = ctx.trailerInfo.Info;
    if (info instanceof PDFRef) ctx.delete(info);
    ctx.trailerInfo.Info = undefined;
    const xmp = doc.catalog.get(PDFName.of('Metadata'));
    if (xmp instanceof PDFRef) ctx.delete(xmp);
    doc.catalog.delete(PDFName.of('Metadata'));
}

App.register({
    id: 'repair',
    cat: 'otimizar',
    title: 'Reparar PDF',
    desc: 'Tente recuperar PDFs danificados que não abrem direito.',
    keywords: 'corrompido consertar recuperar',
    icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    keepUnreadable: true,
    actionLabel: 'Reparar PDF',
    doneTitle: 'Reparo concluído',
    zipName: () => 'pdfs-reparados.zip',
    resultInfo: ctx => ctx.state.batch.some(d => d.out.rasterized)
        ? 'Havia arquivo muito danificado: as páginas foram recuperadas como imagem, então o texto delas não é selecionável.' : null,
    options: () => F.note('A ferramenta reconstrói a estrutura interna do arquivo (tabela de referências e objetos). Funciona na maioria dos PDFs que foram baixados pela metade ou salvos com erro.'),
    run: ctx => runBatch(ctx, async (f, sub) => {
        sub.progress(0.2, 'Reconstruindo o arquivo...');
        let bytes = null, rasterized = false;
        try {
            const r = await Libs.qpdf(f.bytes, ['--object-streams=generate', '{in}', '{out}']);
            if ((r.code === 0 || r.code === 3) && r.output?.length) bytes = r.output;
            else if (/password/i.test(r.errors)) throw new Error('Este PDF está protegido por senha. Use "Desbloquear PDF" primeiro.');
        } catch (e) {
            if (/senha/.test(e.message)) throw e;
        }
        if (!bytes) {
            sub.progress(0.4, 'Tentando outro método...');
            try {
                const doc = await PDFLib.PDFDocument.load(f.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
                bytes = await PDF.save(doc);
            } catch (e) { /* segue para o último recurso */ }
        }
        if (!bytes) {
            // último recurso: o pdf.js consegue ler muitos arquivos quebrados; recriamos as páginas como imagem
            try {
                bytes = await rasterizePdf(f.bytes, 0.85, sub);
                rasterized = true;
            } catch (e) {
                throw new Error('Não foi possível recuperar este arquivo. Ele pode estar danificado demais.');
            }
        }
        return { blob: pdfBlob(bytes), name: baseName(f.file.name) + '-reparado.pdf', rasterized };
    }),
});
