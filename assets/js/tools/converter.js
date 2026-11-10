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
    desc: 'Converta um ou vários documentos .docx em PDF com texto selecionável.',
    keywords: 'docx doc word converter',
    icon: ICONS.file + '<path d="M8.5 12l1.2 5 1.3-4 1.3 4 1.2-5"/>',
    accept: 'docx',
    multiple: true,
    sortable: false,
    actionLabel: 'Converter para PDF',
    doneTitle: 'Conversão concluída',
    zipName: () => 'documentos-em-pdf.zip',
    defaults: { size: 'a4', orient: 'portrait', margin: 56 },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Tamanho da página', F.select([
                { value: 'a4', label: 'A4' },
                { value: 'letter', label: 'Carta' },
            ], ctx.opts.size, v => ctx.opts.size = v)),
            h('div.field', h('span.label', 'Orientação'),
                F.choices('w2p-orient', [{ value: 'portrait', label: 'Retrato' }, { value: 'landscape', label: 'Paisagem' }], ctx.opts.orient, v => ctx.opts.orient = v, true)),
            h('div.field', h('span.label', 'Margens'),
                F.choices('w2p-margin', [{ value: 36, label: 'Estreitas' }, { value: 56, label: 'Normais' }, { value: 85, label: 'Largas' }], ctx.opts.margin, v => ctx.opts.margin = v, true)),
            F.note('A conversão preserva textos, títulos, listas, tabelas e imagens. Fontes especiais e layouts muito elaborados são simplificados.'));
    },
    run: ctx => runBatch(ctx, async (f, sub) => {
        sub.progress(0.1, 'Lendo o documento...');
        const mammoth = await Libs.mammoth();
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: f.bytes });
        if (!html.trim()) throw new Error('O documento parece estar vazio.');
        sub.progress(0.35, 'Montando as páginas...');
        const jsPDF = await Libs.jspdf();

        let [pw, ph] = PAGE_SIZES[ctx.opts.size];
        if (ctx.opts.orient === 'landscape') [pw, ph] = [ph, pw];
        const margin = ctx.opts.margin; // 56 pt ≈ 2 cm
        const contentPx = Math.round((pw - margin * 2) * 1.4); // mantém o texto no mesmo tamanho em qualquer página
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
            const doc = new jsPDF({ unit: 'pt', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
            await doc.html(holder.querySelector('.docx-render'), {
                x: 0, y: 0,
                margin: [margin, margin, margin, margin],
                width: pw - margin * 2,
                windowWidth: contentPx,
                autoPaging: 'text',
                html2canvas: { backgroundColor: '#ffffff' },
            });
            sub.progress(0.9, 'Salvando...');
            return { blob: doc.output('blob'), name: baseName(f.file.name) + '.pdf' };
        } finally {
            holder.remove();
        }
    }),
});

/* ---------- PDF → imagem ---------- */
App.register({
    id: 'pdf-to-jpg',
    cat: 'de-pdf',
    title: 'PDF para imagem',
    desc: 'Salve as páginas de um ou vários PDFs como imagens JPG ou PNG.',
    keywords: 'jpg png converter imagem foto print',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h10M7 17h6"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    actionLabel: 'Converter em imagens',
    doneTitle: 'Suas imagens estão prontas',
    defaults: { format: 'jpg', dpi: 150, quality: 0.9, pages: '', single: false },
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
            F.field('Páginas', F.text(o.pages, v => o.pages = v, { placeholder: 'Todas' }),
                ctx.files.length === 1 ? `Deixe em branco para todas (o arquivo tem ${ctx.files[0].pageCount}).` : 'Ex.: 1-3. Em branco = todas. Vale para cada arquivo.'),
            F.check('Juntar as páginas em uma única imagem comprida', o.single, v => o.single = v));
    },
    zipName: ctx => (ctx.files.length === 1 ? baseName(ctx.files[0].file.name) + '-' : '') + 'imagens.zip',
    run: ctx => runBatch(ctx, async (f, sub) => {
        const o = ctx.opts;
        const total = f.pageCount;
        const idx = o.pages.trim() ? PDF.parseRanges(o.pages, total) : [...Array(total).keys()];
        if (!idx.length) throw new Error('Nenhuma página válida foi informada.');
        const mime = o.format === 'png' ? 'image/png' : 'image/jpeg';
        const base = baseName(f.file.name);

        if (o.single && idx.length > 1) {
            // mede as páginas e reduz a escala se a imagem passar do limite do navegador
            let scale = o.dpi / 72;
            const sizes = [];
            for (const i of idx) sizes.push((await f.doc.getPage(i + 1)).getViewport({ scale: 1 }));
            const width = Math.max(...sizes.map(v => v.width));
            const height = sizes.reduce((t, v) => t + v.height, 0);
            const fit = Math.min(1, 30000 / (height * scale), Math.sqrt(120e6 / (width * height * scale * scale)));
            scale *= fit;
            const sheet = h('canvas', { width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
            const c2 = sheet.getContext('2d');
            c2.fillStyle = '#fff';
            c2.fillRect(0, 0, sheet.width, sheet.height);
            let y = 0;
            for (const [k, i] of idx.entries()) {
                sub.progress(k / idx.length, `Página ${i + 1}...`);
                const { canvas } = await PDF.render(f.doc, i + 1, { scale });
                c2.drawImage(canvas, Math.round((sheet.width - canvas.width) / 2), y);
                y += canvas.height;
                canvas.width = canvas.height = 0;
            }
            const blob = await canvasToBlob(sheet, mime, o.quality);
            return { blob, name: `${base}.${o.format}`, reduced: fit < 1 };
        }

        const outs = [];
        for (const [k, i] of idx.entries()) {
            sub.progress(k / idx.length, `Página ${i + 1}...`);
            const { canvas } = await PDF.render(f.doc, i + 1, { scale: o.dpi / 72 });
            const blob = await canvasToBlob(canvas, mime, o.quality);
            canvas.width = canvas.height = 0;
            const suffix = total === 1 ? '' : `-pagina-${String(i + 1).padStart(String(total).length, '0')}`;
            outs.push({ blob, name: `${base}${suffix}.${o.format}` });
        }
        return outs;
    }),
    resultInfo: (ctx, out, list) => list.some(o => o.reduced)
        ? 'A imagem única ficou muito grande para a resolução escolhida, então foi gerada numa resolução um pouco menor.' : null,
});

/* ---------- PDF → Word ---------- */
/** Descobre negrito/itálico de cada fonte da página (o pdf.js só sabe depois de montar a página) */
async function pageFontStyles(page) {
    const cache = {};
    try { await page.getOperatorList(); } catch (e) { /* sem estilos, segue só com o texto */ }
    return name => {
        if (name in cache) return cache[name];
        let b = false, i = false;
        try {
            if (page.commonObjs.has(name)) {
                const font = page.commonObjs.get(name);
                const n = String(font?.name || '');
                b = !!font?.bold || !!font?.black || /bold|black|heavy|semibold|demi/i.test(n);
                i = !!font?.italic || /italic|oblique/i.test(n);
            }
        } catch (e) { /* fonte ainda não carregada */ }
        return cache[name] = { b, i };
    };
}

/** Junta um trecho de texto a uma lista de trechos, fundindo com o anterior se o estilo for igual */
function pushRun(runs, t, b, i) {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.b === b && last.i === i) last.t += t;
    else runs.push({ t, b, i });
}

/** Agrupa os pedaços de texto do pdf.js em linhas e parágrafos (com negrito, itálico e alinhamento) */
function textToParagraphs(items, pageWidth, fontStyle = () => ({ b: false, i: false })) {
    const pieces = items.filter(i => i.str && i.str.trim() !== '' || i.str === ' ').map(i => ({
        s: i.str,
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        size: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10,
        ...fontStyle(i.fontName),
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
        l.runs = [];
        for (const it of l.items) {
            let sep = '';
            if (end != null) {
                const gap = it.x - end;
                if (gap > it.size * 0.18 && !text.endsWith(' ') && !it.s.startsWith(' ')) sep = gap > it.size * 2.5 ? '\t' : ' ';
            }
            text += sep + it.s;
            pushRun(l.runs, sep + it.s, it.b, it.i);
            end = it.x + it.w;
        }
        l.text = text.trim();
        // tira os espaços das pontas da linha
        l.runs[0].t = l.runs[0].t.replace(/^\s+/, '');
        l.runs[l.runs.length - 1].t = l.runs[l.runs.length - 1].t.replace(/\s+$/, '');
        l.runs = l.runs.filter(r => r.t);
        l.left = l.items[0].x;
        l.right = end;
    }

    // tamanho de fonte mais comum = corpo do texto
    const weight = {};
    lines.forEach(l => { const k = Math.round(l.size); weight[k] = (weight[k] || 0) + l.text.length; });
    const body = +Object.entries(weight).sort((a, b) => b[1] - a[1])[0][0];
    const rightEdge = Math.max(...lines.map(l => l.right));

    const paras = [];
    let cur = null, prev = null;
    for (const l of lines) {
        if (!l.runs.length) continue;
        const centered = Math.abs((l.left + l.right) / 2 - pageWidth / 2) < pageWidth * 0.04 && (l.right - l.left) < pageWidth * 0.6 && l.left > pageWidth * 0.15;
        const heading = l.size > body * 1.2;
        const bullet = /^\s*([•\-–·▪●]|\d+[.)]|[a-z][.)])\s/.test(l.text);
        const gap = prev ? prev.y - l.y : 0;
        const newPara = !cur || gap > Math.max(prev.size, l.size) * 1.65 || Math.abs(l.size - prev.size) > 1.2 || bullet || heading !== cur.heading || centered !== cur.centered || cur.centered;
        if (newPara) {
            cur = { text: l.text, runs: l.runs.map(r => ({ ...r })), size: l.size, heading, centered, rights: [l.right] };
            paras.push(cur);
        } else {
            const last = cur.runs[cur.runs.length - 1];
            // palavra dividida com hífen no fim da linha volta a ser uma só
            if (/[a-zà-ú]-$/i.test(last.t)) last.t = last.t.slice(0, -1);
            else last.t += ' ';
            l.runs.forEach(r => pushRun(cur.runs, r.t, r.b, r.i));
            cur.text += ' ' + l.text;
            cur.rights.push(l.right);
        }
        prev = l;
    }
    // justificado: todas as linhas, menos a última, encostam na margem direita
    for (const p of paras) {
        p.justified = !p.centered && p.rights.length >= 3
            && p.rights.slice(0, -1).every(r => r > rightEdge - pageWidth * 0.012);
    }
    return paras;
}

App.register({
    id: 'pdf-to-word',
    cat: 'de-pdf',
    title: 'PDF para Word',
    desc: 'Transforme um ou vários PDFs em documentos .docx que você pode editar.',
    keywords: 'docx doc word editar converter texto',
    icon: ICONS.file + '<path d="M8.5 12l1.2 5 1.3-4 1.3 4 1.2-5"/>',
    accept: 'pdf',
    multiple: true,
    sortable: false,
    actionLabel: 'Converter para Word',
    doneTitle: 'Conversão concluída',
    zipName: () => 'pdfs-em-word.zip',
    defaults: { images: true },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.check('Incluir como imagem as páginas que não têm texto (digitalizadas)', ctx.opts.images, v => ctx.opts.images = v),
            F.note('O texto vira parágrafos editáveis, mantendo títulos, negrito, itálico e alinhamento (centralizado ou justificado). Colunas e tabelas complexas podem precisar de ajustes.'));
    },
    run: ctx => runBatch(ctx, async (f, sub) => {
        const docx = await Libs.docx();
        const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType } = docx;
        const children = [];
        let anyText = false;
        let firstSize = null;
        for (let n = 1; n <= f.pageCount; n++) {
            sub.progress((n - 1) / f.pageCount, `Lendo página ${n} de ${f.pageCount}...`);
            const page = await f.doc.getPage(n);
            const vp = page.getViewport({ scale: 1 });
            firstSize = firstSize || vp;
            const tc = await page.getTextContent();
            const paras = textToParagraphs(tc.items, vp.width, tc.items.length ? await pageFontStyles(page) : undefined);
            const pageBreak = n > 1;
            if (paras.length) {
                anyText = true;
                paras.forEach((p, i) => children.push(new Paragraph({
                    pageBreakBefore: pageBreak && i === 0,
                    alignment: p.centered ? AlignmentType.CENTER : p.justified ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
                    spacing: { after: 120 },
                    children: p.runs.flatMap(r => r.t.split('\t').flatMap((t, j) => {
                        const style = { size: Math.round(p.size * 2), bold: p.heading || r.b, italics: r.i };
                        const run = t ? [new TextRun({ text: t, ...style })] : [];
                        return j ? [new TextRun({ text: '\t' }), ...run] : run;
                    })),
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
        sub.progress(0.95, 'Gerando o arquivo .docx...');
        const twip = pt => Math.round(pt * 20);
        const doc = new Document({
            creator: 'Editor de PDF',
            sections: [{
                properties: { page: { size: { width: twip(firstSize.width), height: twip(firstSize.height) }, margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
                children: children.length ? children : [new Paragraph('')],
            }],
        });
        const blob = await Packer.toBlob(doc);
        return { blob, name: baseName(f.file.name) + '.docx', noText: !anyText };
    }),
    resultInfo: (ctx, out, list) => list.some(o => o.noText)
        ? 'Havia PDF sem texto selecionável (digitalizado): as páginas dele foram colocadas como imagem no documento.' : null,
});
