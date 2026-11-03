/* Ferramentas de otimização: comprimir e reparar */
'use strict';

const COMPRESS_LEVELS = {
    low: { quality: 0.82, maxDim: 2600 },
    recommended: { quality: 0.68, maxDim: 1800 },
    extreme: { quality: 0.5, maxDim: 1200 },
};

/**
 * Recomprime as imagens JPEG dentro do PDF (é onde está o peso de PDFs
 * escaneados e com fotos). Texto e vetores continuam intactos.
 */
async function recompressImages(doc, { quality, maxDim }, onProgress) {
    const { PDFName, PDFRawStream, PDFArray, PDFNumber } = PDFLib;
    const N = n => PDFName.of(n);
    const ctx = doc.context;
    const images = ctx.enumerateIndirectObjects().filter(([, obj]) =>
        obj instanceof PDFRawStream && obj.dict.get(N('Subtype')) === N('Image'));

    let changed = 0;
    for (let i = 0; i < images.length; i++) {
        const [ref, obj] = images[i];
        onProgress?.(i / images.length);
        const dict = obj.dict;
        const filter = dict.get(N('Filter'));
        const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
        if (filters[filters.length - 1] !== N('DCTDecode')) continue;
        if (dict.get(N('ImageMask')) || dict.get(N('Decode'))) continue;

        // só RGB ou cinza (CMYK sai com cores erradas no navegador)
        let cs = dict.lookup(N('ColorSpace'));
        if (cs instanceof PDFArray) {
            const kind = cs.get(0);
            if (kind === N('ICCBased')) {
                const n = cs.lookup(1)?.dict?.get(N('N'));
                if (!(n instanceof PDFNumber) || n.asNumber() === 4) continue;
            } else continue;
        } else if (cs !== N('DeviceRGB') && cs !== N('DeviceGray')) continue;

        if (obj.contents.length < 20_000) continue; // imagens pequenas não valem a pena
        let bytes = obj.contents;
        if (filters.length > 1) {
            // ex.: [/ASCII85Decode /DCTDecode] — tira as camadas antes do JPEG
            try {
                const tmp = dict.clone(ctx);
                tmp.set(N('Filter'), ctx.obj(filters.slice(0, -1)));
                tmp.delete(N('DecodeParms'));
                bytes = PDFLib.decodePDFRawStream(PDFRawStream.of(tmp, obj.contents)).decode();
            } catch (e) { continue; }
        }
        let bmp;
        try { bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })); }
        catch (e) { continue; }
        const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale));
        const hh = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = hh;
        const c2 = canvas.getContext('2d');
        c2.fillStyle = '#fff';
        c2.fillRect(0, 0, w, hh);
        c2.drawImage(bmp, 0, 0, w, hh);
        bmp.close?.();
        const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
        const newBytes = new Uint8Array(await blob.arrayBuffer());
        if (newBytes.length > obj.contents.length * 0.9) continue;

        const nd = dict.clone(ctx);
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
    desc: 'Diminua o tamanho do arquivo mantendo a melhor qualidade possível.',
    keywords: 'reduzir diminuir tamanho otimizar',
    icon: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    accept: 'pdf',
    actionLabel: 'Comprimir PDF',
    doneTitle: 'Seu PDF foi comprimido',
    next: ['protect', 'merge', 'split', 'sign', 'organize'],
    defaults: { level: 'recommended', rasterQuality: 0.6 },
    options(ctx) {
        const raster = h('div', { style: { display: 'grid', gap: '10px' } },
            F.field('Qualidade das páginas', F.range(ctx.opts.rasterQuality, 0.2, 0.9, 0.1, v => ctx.opts.rasterQuality = v, v => Math.round(v * 100) + '%')),
            F.note(h('b', 'Atenção: '), 'neste modo as páginas viram imagem e o texto deixa de ser selecionável.'));
        const sync = () => raster.hidden = ctx.opts.level !== 'raster';
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.choices('level', [
                { value: 'low', label: 'Leve', hint: 'Alta qualidade, redução menor.' },
                { value: 'recommended', label: 'Recomendada', hint: 'Bom equilíbrio entre qualidade e tamanho.' },
                { value: 'extreme', label: 'Forte', hint: 'Menor arquivo; imagens perdem nitidez.' },
                { value: 'raster', label: 'Máxima (rasterizar)', hint: 'Converte as páginas em imagens. Útil para PDFs muito pesados.' },
            ], ctx.opts.level, v => { ctx.opts.level = v; sync(); }),
            raster);
    },
    resultInfo(ctx, out) {
        const before = ctx.files[0].file.size, after = out.blob.size;
        if (ctx.state.unchanged) return 'O arquivo já estava otimizado; não foi possível reduzir mais sem perder qualidade.';
        const pct = Math.round((1 - after / before) * 100);
        return h('span', `De ${formatBytes(before)} para ${formatBytes(after)} `, h('span.gain', `(−${pct}%)`));
    },
    async run(ctx) {
        const f = ctx.files[0];
        let bytes;
        if (ctx.opts.level === 'raster') {
            bytes = await rasterizePdf(f.bytes, ctx.opts.rasterQuality, ctx);
        } else {
            const doc = await PDF.load(f.bytes);
            ctx.progress(0.05, 'Analisando imagens...');
            await recompressImages(doc, COMPRESS_LEVELS[ctx.opts.level], p => ctx.progress(0.05 + p * 0.7, 'Comprimindo imagens...'));
            ctx.progress(0.8, 'Otimizando estrutura...');
            bytes = await PDF.save(doc);
            bytes = await qpdfOptimize(bytes);
        }
        ctx.state.unchanged = bytes.length >= f.file.size;
        if (ctx.state.unchanged) bytes = new Uint8Array(f.bytes);
        return { blob: pdfBlob(bytes), name: baseName(f.file.name) + '-comprimido.pdf' };
    },
});

App.register({
    id: 'repair',
    cat: 'otimizar',
    title: 'Reparar PDF',
    desc: 'Tente recuperar um PDF danificado que não abre direito.',
    keywords: 'corrompido consertar recuperar',
    icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    accept: 'pdf',
    keepUnreadable: true,
    actionLabel: 'Reparar PDF',
    doneTitle: 'Seu PDF foi reparado',
    resultInfo: ctx => ctx.state.rasterized ? 'O arquivo estava muito danificado: as páginas foram recuperadas como imagem, então o texto não é selecionável.' : null,
    options: () => F.note('A ferramenta reconstrói a estrutura interna do arquivo (tabela de referências e objetos). Funciona na maioria dos PDFs que foram baixados pela metade ou salvos com erro.'),
    async run(ctx) {
        const f = ctx.files[0];
        ctx.progress(0.2, 'Reconstruindo o arquivo...');
        let bytes = null;
        try {
            const r = await Libs.qpdf(f.bytes, ['--object-streams=generate', '{in}', '{out}']);
            if ((r.code === 0 || r.code === 3) && r.output?.length) bytes = r.output;
            else if (/password/i.test(r.errors)) throw new Error('Este PDF está protegido por senha. Use "Desbloquear PDF" primeiro.');
        } catch (e) {
            if (/senha/.test(e.message)) throw e;
        }
        if (!bytes) {
            ctx.progress(0.4, 'Tentando outro método...');
            try {
                const doc = await PDFLib.PDFDocument.load(f.bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
                bytes = await PDF.save(doc);
            } catch (e) { /* segue para o último recurso */ }
        }
        if (!bytes) {
            // último recurso: o pdf.js consegue ler muitos arquivos quebrados; recriamos as páginas como imagem
            try {
                bytes = await rasterizePdf(f.bytes, 0.85, ctx);
                ctx.state.rasterized = true;
            } catch (e) {
                throw new Error('Não foi possível recuperar este arquivo. Ele pode estar danificado demais.');
            }
        }
        return { blob: pdfBlob(bytes), name: baseName(f.file.name) + '-reparado.pdf' };
    },
});
