/* Conversões: imagem → PDF, Word → PDF, PDF → imagem, PDF → Word */
'use strict';

/* ---------- imagem → PDF (também usado por "Gerar contrato") ---------- */
const PAGE_SIZES = { a4: PDF.A4, letter: PDF.LETTER };

async function embedImageFile(doc, file) {
    const bmp = await loadImageBitmap(file);
    const max = 3000; // evita PDFs gigantes com fotos de 50 megapixels
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), hgt = Math.round(bmp.height * s);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const c2 = canvas.getContext('2d');
    const png = /png|gif|webp/i.test(file.type);
    if (!png) { c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, hgt); }
    c2.drawImage(bmp, 0, 0, w, hgt);
    bmp.close?.();
    if (png) {
        const bytes = await (await canvasToBlob(canvas, 'image/png')).arrayBuffer();
        return { img: await doc.embedPng(bytes), w, h: hgt };
    }
    const bytes = await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer();
    return { img: await doc.embedJpg(bytes), w, h: hgt };
}

async function addImagePage(doc, file, { size = 'a4', orient = 'auto', margin = 20 } = {}) {
    const { img, w, h: ih } = await embedImageFile(doc, file);
    let pw, ph;
    if (size === 'fit') {
        pw = w * 0.75 + margin * 2; ph = ih * 0.75 + margin * 2; // 96 dpi → pontos
    } else {
        [pw, ph] = PAGE_SIZES[size];
        const landscape = orient === 'landscape' || (orient === 'auto' && w > ih);
        if (landscape) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const maxW = pw - margin * 2, maxH = ph - margin * 2;
    const s = Math.min(maxW / w, maxH / ih);
    const dw = w * s, dh = ih * s;
    page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
}

function imagePageOptions(ctx) {
    const o = ctx.opts;
    const orient = h('div.field', h('span.label', 'Orientação'),
        F.choices('orient', [
            { value: 'auto', label: 'Automática' },
            { value: 'portrait', label: 'Retrato' },
            { value: 'landscape', label: 'Paisagem' },
        ], o.orient, v => o.orient = v, true));
    const sync = () => orient.hidden = o.size === 'fit';
    sync();
    return [
        F.field('Tamanho da página', F.select([
            { value: 'a4', label: 'A4 (21 × 29,7 cm)' },
            { value: 'letter', label: 'Carta (21,6 × 27,9 cm)' },
            { value: 'fit', label: 'Mesmo tamanho da imagem' },
        ], o.size, v => { o.size = v; sync(); })),
        orient,
        h('div.field', h('span.label', 'Margem'),
            F.choices('margin', [
                { value: 0, label: 'Nenhuma' },
                { value: 20, label: 'Pequena' },
                { value: 45, label: 'Grande' },
            ], o.margin, v => o.margin = v, true)),
    ];
}

App.register({
    id: 'jpg-to-pdf',
    cat: 'para-pdf',
    title: 'Imagem para PDF',
    desc: 'Transforme fotos e imagens JPG, PNG ou WEBP em PDF.',
    keywords: 'jpg png foto converter imagem',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    accept: 'image',
    multiple: true,
    actionLabel: 'Converter para PDF',
    doneTitle: 'Suas imagens viraram PDF',
    defaults: { size: 'a4', orient: 'auto', margin: 20, merge: true },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            ...imagePageOptions(ctx),
            ctx.files.length > 1 && F.check('Juntar todas as imagens em um único PDF', ctx.opts.merge, v => ctx.opts.merge = v));
    },
    zipName: () => 'imagens-em-pdf.zip',
    async run(ctx) {
        const files = ctx.files;
        if (ctx.opts.merge || files.length === 1) {
            const doc = await PDFLib.PDFDocument.create();
            for (let i = 0; i < files.length; i++) {
                ctx.progress(i / files.length, `Imagem ${i + 1} de ${files.length}...`);
                await addImagePage(doc, files[i].file, ctx.opts);
            }
            const name = files.length === 1 ? baseName(files[0].file.name) : 'imagens';
            return { blob: pdfBlob(await PDF.save(doc)), name: name + '.pdf' };
        }
        const outs = [];
        for (let i = 0; i < files.length; i++) {
            ctx.progress(i / files.length, `Imagem ${i + 1} de ${files.length}...`);
            const doc = await PDFLib.PDFDocument.create();
            await addImagePage(doc, files[i].file, ctx.opts);
            outs.push({ blob: pdfBlob(await PDF.save(doc)), name: baseName(files[i].file.name) + '.pdf' });
        }
        return outs;
    },
});

/* ---------- Word → PDF ---------- */
App.register({
    id: 'word-to-pdf',
    cat: 'para-pdf',
    title: 'Word para PDF',
    desc: 'Converta documentos .docx em PDF com texto selecionável.',
    keywords: 'docx doc word converter',
    icon: ICONS.file + '<path d="M8.5 12l1.2 5 1.3-4 1.3 4 1.2-5"/>',
    accept: 'docx',
    actionLabel: 'Converter para PDF',
    doneTitle: 'Seu documento virou PDF',
    defaults: { size: 'a4' },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Tamanho da página', F.select([
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Carta' },
            ], ctx.opts.size, v => ctx.opts.size = v)),
            F.note('A conversão preserva textos, títulos, listas, tabelas e imagens. Fontes especiais e layouts muito elaborados são simplificados.'));
    },
    async run(ctx) {
        const f = ctx.files[0];
        ctx.progress(0.1, 'Lendo o documento...');
        const mammoth = await Libs.mammoth();
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: f.bytes });
        if (!html.trim()) throw new Error('O documento parece estar vazio.');
        ctx.progress(0.35, 'Montando as páginas...');
        const jsPDF = await Libs.jspdf();

        const [pw, ph] = PAGE_SIZES[ctx.opts.size];
        const margin = 56; // ~2 cm
        const contentPx = 680;
        const holder = h('div', {
            style: { position: 'absolute', left: '-10000px', top: '0', width: contentPx + 'px' },
        });
        holder.innerHTML = `<style>
            .docx-render { font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.45; color: #111; background: #fff; width: ${contentPx}px; }
            .docx-render h1 { font-size: 26px; margin: 0 0 12px; }
            .docx-render h2 { font-size: 21px; margin: 18px 0 8px; }
            .docx-render h3 { font-size: 18px; margin: 14px 0 6px; }
            .docx-render p { margin: 0 0 10px; }
            .docx-render table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; }
            .docx-render td, .docx-render th { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
            .docx-render img { max-width: 100%; height: auto; }
            .docx-render ul, .docx-render ol { margin: 0 0 10px; padding-left: 26px; }
        </style><div class="docx-render">${html}</div>`;
        document.body.append(holder);
        try {
            await Promise.all($$('img', holder).map(img => img.decode().catch(() => {})));
            const doc = new jsPDF({ unit: 'pt', format: [pw, ph], compress: true });
            await doc.html(holder.querySelector('.docx-render'), {
                x: 0, y: 0,
                margin: [margin, margin, margin, margin],
                width: pw - margin * 2,
                windowWidth: contentPx,
                autoPaging: 'text',
                html2canvas: { backgroundColor: '#ffffff' },
            });
            ctx.progress(0.9, 'Salvando...');
            return { blob: doc.output('blob'), name: baseName(f.file.name) + '.pdf' };
        } finally {
            holder.remove();
        }
    },
});

/* ---------- PDF → imagem ---------- */
App.register({
    id: 'pdf-to-jpg',
    cat: 'de-pdf',
    title: 'PDF para imagem',
    desc: 'Salve cada página do PDF como uma imagem JPG ou PNG.',
    keywords: 'jpg png converter imagem foto',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h10M7 17h6"/>',
    accept: 'pdf',
    actionLabel: 'Converter em imagens',
    doneTitle: 'Suas imagens estão prontas',
    defaults: { format: 'jpg', dpi: 150, quality: 0.9, pages: '' },
    options(ctx) {
        const o = ctx.opts;
        const q = F.field('Qualidade', F.range(o.quality, 0.5, 1, 0.05, v => o.quality = v, v => Math.round(v * 100) + '%'));
        const sync = () => q.hidden = o.format !== 'jpg';
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.field', h('span.label', 'Formato'),
                F.choices('fmt', [{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }], o.format, v => { o.format = v; sync(); }, true)),
            F.field('Resolução', F.select([
                { value: 96, label: 'Tela (96 dpi)' },
                { value: 150, label: 'Normal (150 dpi)' },
                { value: 300, label: 'Alta para impressão (300 dpi)' },
            ], o.dpi, v => o.dpi = +v)),
            q,
            F.field('Páginas', F.text(o.pages, v => o.pages = v, { placeholder: 'Todas' }), `Deixe em branco para todas (o arquivo tem ${ctx.files[0].pageCount}).`));
    },
    zipName: ctx => baseName(ctx.files[0].file.name) + '-imagens.zip',
    async run(ctx) {
        const f = ctx.files[0], o = ctx.opts;
        const total = f.pageCount;
        const idx = o.pages.trim() ? PDF.parseRanges(o.pages, total) : [...Array(total).keys()];
        if (!idx.length) throw new Error('Nenhuma página válida foi informada.');
        const outs = [];
        const mime = o.format === 'png' ? 'image/png' : 'image/jpeg';
        for (const [k, i] of idx.entries()) {
            ctx.progress(k / idx.length, `Página ${i + 1}...`);
            const { canvas } = await PDF.render(f.doc, i + 1, { scale: o.dpi / 72 });
            const blob = await canvasToBlob(canvas, mime, o.quality);
            canvas.width = canvas.height = 0;
            outs.push({ blob, name: `${baseName(f.file.name)}-pagina-${String(i + 1).padStart(String(total).length, '0')}.${o.format}` });
        }
        return outs;
    },
});

/* ---------- PDF → Word ---------- */
/** Agrupa os pedaços de texto do pdf.js em linhas e parágrafos */
function textToParagraphs(items, pageWidth) {
    const pieces = items.filter(i => i.str && i.str.trim() !== '' || i.str === ' ').map(i => ({
        s: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        size: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10,
    })).filter(p => p.s);
    if (!pieces.length) return [];

    pieces.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const p of pieces) {
        const line = lines.find(l => Math.abs(l.y - p.y) < Math.max(2, Math.min(l.size, p.size) * 0.45));
        if (line) { line.items.push(p); line.size = Math.max(line.size, p.size); }
        else lines.push({ y: p.y, size: p.size, items: [p] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
        l.items.sort((a, b) => a.x - b.x);
        let text = '', end = null;
        for (const it of l.items) {
            if (end != null) {
                const gap = it.x - end;
                if (gap > it.size * 0.18 && !text.endsWith(' ') && !it.s.startsWith(' ')) text += gap > it.size * 2.5 ? '\t' : ' ';
            }
            text += it.s;
            end = it.x + it.w;
        }
        l.text = text.replace(/\s+$/, '');
        l.left = l.items[0].x;
        l.right = end;
    }

    // tamanho de fonte mais comum = corpo do texto
    const weight = {};
    lines.forEach(l => { const k = Math.round(l.size); weight[k] = (weight[k] || 0) + l.text.length; });
    const body = +Object.entries(weight).sort((a, b) => b[1] - a[1])[0][0];

    const paras = [];
    let cur = null, prev = null;
    for (const l of lines) {
        const centered = Math.abs((l.left + l.right) / 2 - pageWidth / 2) < pageWidth * 0.04 && (l.right - l.left) < pageWidth * 0.6 && l.left > pageWidth * 0.15;
        const heading = l.size > body * 1.2;
        const bullet = /^\s*([•\-–·▪●]|\d+[.)]|[a-z][.)])\s/.test(l.text);
        const gap = prev ? prev.y - l.y : 0;
        const newPara = !cur || gap > Math.max(prev.size, l.size) * 1.65 || Math.abs(l.size - prev.size) > 1.2 || bullet || heading !== cur.heading || centered !== cur.centered || cur.centered;
        if (newPara) {
            cur = { text: l.text.trim(), size: l.size, heading, centered };
            paras.push(cur);
        } else {
            cur.text = cur.text.endsWith('-') ? cur.text.slice(0, -1) + l.text.trim() : cur.text + ' ' + l.text.trim();
        }
        prev = l;
    }
    return paras;
}

App.register({
    id: 'pdf-to-word',
    cat: 'de-pdf',
    title: 'PDF para Word',
    desc: 'Transforme o PDF em um documento .docx que você pode editar.',
    keywords: 'docx doc word editar converter texto',
    icon: ICONS.file + '<path d="M8.5 12l1.2 5 1.3-4 1.3 4 1.2-5"/>',
    accept: 'pdf',
    actionLabel: 'Converter para Word',
    doneTitle: 'Seu PDF virou documento Word',
    defaults: { images: true },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.check('Incluir como imagem as páginas que não têm texto (digitalizadas)', ctx.opts.images, v => ctx.opts.images = v),
            F.note('O texto é extraído e reorganizado em parágrafos editáveis. Títulos e textos centralizados são mantidos; colunas e tabelas complexas podem precisar de ajustes.'));
    },
    async run(ctx) {
        const f = ctx.files[0];
        const docx = await Libs.docx();
        const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType } = docx;
        const children = [];
        let anyText = false;
        let firstSize = null;
        for (let n = 1; n <= f.pageCount; n++) {
            ctx.progress((n - 1) / f.pageCount, `Lendo página ${n} de ${f.pageCount}...`);
            const page = await f.doc.getPage(n);
            const vp = page.getViewport({ scale: 1 });
            firstSize = firstSize || vp;
            const tc = await page.getTextContent();
            const paras = textToParagraphs(tc.items, vp.width);
            const pageBreak = n > 1;
            if (paras.length) {
                anyText = true;
                paras.forEach((p, i) => children.push(new Paragraph({
                    pageBreakBefore: pageBreak && i === 0,
                    alignment: p.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
                    spacing: { after: 120 },
                    children: p.text.split('\t').flatMap((t, j) => j ? [new TextRun({ text: '\t' }), new TextRun({ text: t, size: Math.round(p.size * 2), bold: p.heading })]
                        : [new TextRun({ text: t, size: Math.round(p.size * 2), bold: p.heading })]),
                })));
            } else if (ctx.opts.images) {
                const { canvas } = await PDF.render(f.doc, n, { scale: 1.6 });
                const data = await (await canvasToBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer();
                const w = 600, hh = Math.round(600 * canvas.height / canvas.width);
                children.push(new Paragraph({ pageBreakBefore: pageBreak, children: [new ImageRun({ type: 'jpg', data, transformation: { width: w, height: hh } })] }));
            }
        }
        if (!anyText && !ctx.opts.images) {
            throw new Error('Este PDF não tem texto (parece ser digitalizado). Ative a opção de incluir páginas como imagem.');
        }
        ctx.progress(0.95, 'Gerando o arquivo .docx...');
        const twip = pt => Math.round(pt * 20);
        const doc = new Document({
            creator: 'Editor de PDF',
            sections: [{
                properties: { page: { size: { width: twip(firstSize.width), height: twip(firstSize.height) }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
                children: children.length ? children : [new Paragraph('')],
            }],
        });
        const blob = await Packer.toBlob(doc);
        if (!anyText) ctx.state.noText = true;
        return { blob, name: baseName(f.file.name) + '.docx' };
    },
    resultInfo: ctx => ctx.state.noText ? 'O PDF não tinha texto selecionável, então as páginas foram colocadas como imagem no documento.' : null,
});
