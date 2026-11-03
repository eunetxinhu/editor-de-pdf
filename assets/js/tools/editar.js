/* Edição: marca d'água, números de página, assinar, editar e recortar */
'use strict';

/** Origem (canto inferior esquerdo, visual) de uma caixa w×h centrada em (cx,cy) e girada `angle`° */
function placeRotated(cx, cy, w, hh, angle) {
    const a = angle * Math.PI / 180;
    return {
        x: cx - (w / 2) * Math.cos(a) + (hh / 2) * Math.sin(a),
        y: cy + (w / 2) * Math.sin(a) + (hh / 2) * Math.cos(a),
    };
}
function rotatedBox(w, hh, angle) {
    const a = angle * Math.PI / 180;
    return { w: Math.abs(w * Math.cos(a)) + Math.abs(hh * Math.sin(a)), h: Math.abs(w * Math.sin(a)) + Math.abs(hh * Math.cos(a)) };
}
function posCenter(pos, vw, vh, bw, bh, m) {
    const col = pos[1], row = pos[0];
    const cx = col === 'l' ? m + bw / 2 : col === 'r' ? vw - m - bw / 2 : vw / 2;
    const cy = row === 't' ? m + bh / 2 : row === 'b' ? vh - m - bh / 2 : vh / 2;
    return { cx, cy };
}
function fontFor(family, bold) {
    const S = PDFLib.StandardFonts;
    return {
        helv: bold ? S.HelveticaBold : S.Helvetica,
        times: bold ? S.TimesRomanBold : S.TimesRoman,
        courier: bold ? S.CourierBold : S.Courier,
    }[family];
}
function pageFilter(text, total) {
    if (!String(text || '').trim()) return () => true;
    const set = new Set(PDF.parseRanges(text, total));
    return i => set.has(i);
}

/** Área de pré-visualização ao vivo (aplica as opções só na página exibida) */
function livePreview(ctx, ws, apply) {
    const st = ctx.state;
    st.pv = st.pv || 0;
    const total = ctx.files[0].pageCount;
    const box = h('div.preview-box', h('div.loading-block', h('span.spinner'), 'Gerando prévia...'));
    const label = h('span.pg');
    const prev = h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Página anterior', onclick: () => { if (st.pv > 0) { st.pv--; st.schedulePreview(); } } }, icon('left'));
    const next = h('button.btn.btn-sm', { type: 'button', 'aria-label': 'Próxima página', onclick: () => { if (st.pv < total - 1) { st.pv++; st.schedulePreview(); } } }, icon('right'));
    ws.append(h('div.editor-nav', prev, label, next), box);
    st.schedulePreview = debounce(async () => {
        const token = st.pvToken = {};
        label.textContent = `Prévia da página ${st.pv + 1} de ${total}`;
        prev.disabled = st.pv === 0;
        next.disabled = st.pv >= total - 1;
        try {
            st.srcDoc = st.srcDoc || await PDF.load(ctx.files[0].bytes);
            const doc = await PDF.pick(st.srcDoc, [st.pv]);
            await apply(ctx, doc, [st.pv], total);
            const bytes = await doc.save();
            if (token !== st.pvToken) return;
            await renderPreview(box, bytes, 1);
        } catch (e) {
            box.replaceChildren(h('p.hint', e.message));
        }
    }, 220);
    st.schedulePreview();
}

/* ---------- Marca d'água ---------- */
async function applyWatermark(ctx, doc, origIdx, total) {
    const o = ctx.opts;
    const include = pageFilter(o.pages, total);
    const pages = doc.getPages();
    let font, img;
    if (o.type === 'text') {
        if (!o.text.trim()) return;
        font = await doc.embedFont(fontFor(o.font, o.bold));
    } else {
        if (!ctx.state.wmImage) return;
        img = await doc.embedPng(await (await fetch(ctx.state.wmImage.src)).arrayBuffer());
    }
    const color = PDF.hexToRgb(o.color);
    pages.forEach((page, k) => {
        if (!include(origIdx[k])) return;
        const g = PDF.geom(page);
        let w, hh, text;
        if (font) {
            text = PDF.safeText(font, o.text);
            w = font.widthOfTextAtSize(text, o.size);
            hh = font.heightAtSize(o.size, { descender: false }) * 0.9;
        } else {
            w = g.vw * o.imageScale / 100;
            hh = w * ctx.state.wmImage.h / ctx.state.wmImage.w;
        }
        const box = rotatedBox(w, hh, o.angle);
        const centers = [];
        if (o.mosaic) {
            const sx = box.w + Math.max(40, o.size * 1.2), sy = box.h + Math.max(40, o.size * 1.2);
            for (let row = 0, y = box.h / 2; y - box.h / 2 < g.vh; y += sy, row++) {
                for (let x = (row % 2 ? sx / 2 : 0) + box.w / 2; x - box.w / 2 < g.vw; x += sx) centers.push({ cx: x, cy: y });
            }
        } else {
            centers.push(posCenter(o.pos, g.vw, g.vh, box.w, box.h, 30));
        }
        for (const c of centers) {
            const org = placeRotated(c.cx, c.cy, w, hh, o.angle);
            const p = g.toPdf(org.x, org.y);
            const rotate = PDFLib.degrees(o.angle + g.rot);
            if (font) page.drawText(text, { x: p.x, y: p.y, size: o.size, font, color, opacity: o.opacity, rotate });
            else page.drawImage(img, { x: p.x, y: p.y, width: w, height: hh, opacity: o.opacity, rotate });
        }
    });
}

App.register({
    id: 'watermark',
    cat: 'editar',
    title: "Marca d'água",
    desc: 'Carimbe um texto ou uma imagem sobre as páginas do PDF.',
    keywords: 'carimbo marca agua logo confidencial',
    icon: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    accept: 'pdf',
    view: 'custom',
    actionLabel: "Aplicar marca d'água",
    doneTitle: "A marca d'água foi aplicada",
    defaults: { type: 'text', text: 'CONFIDENCIAL', font: 'helv', bold: true, size: 64, color: '#b3263e', opacity: 0.3, angle: 45, pos: 'mc', mosaic: false, imageScale: 40, pages: '' },
    workspace: (ctx, ws) => livePreview(ctx, ws, applyWatermark),
    validate(ctx) {
        if (ctx.opts.type === 'text' && !ctx.opts.text.trim()) return 'Digite o texto da marca d\'água.';
        if (ctx.opts.type === 'image' && !ctx.state.wmImage) return 'Escolha uma imagem.';
        return null;
    },
    options(ctx) {
        const o = ctx.opts;
        const upd = () => { ctx.state.schedulePreview?.(); ctx.updateAction(); };
        const textBox = h('div', { style: { display: 'grid', gap: '12px' } },
            F.field('Texto', F.text(o.text, v => { o.text = v; upd(); })),
            h('div.row',
                F.field('Fonte', F.select([{ value: 'helv', label: 'Helvetica' }, { value: 'times', label: 'Times' }, { value: 'courier', label: 'Courier' }], o.font, v => { o.font = v; upd(); })),
                F.field('Tamanho', F.number(o.size, v => { o.size = Math.max(6, v || 6); upd(); }, { min: 6, max: 300 }))),
            h('div.row', { style: { alignItems: 'end' } },
                F.field('Cor', F.color(o.color, v => { o.color = v; upd(); })),
                F.check('Negrito', o.bold, v => { o.bold = v; upd(); })));
        const imgInput = h('input', {
            type: 'file', accept: 'image/*', hidden: true,
            onchange: async e => {
                const f = e.target.files[0];
                if (!f) return;
                const bmp = await loadImageBitmap(f);
                const c = h('canvas', { width: bmp.width, height: bmp.height });
                c.getContext('2d').drawImage(bmp, 0, 0);
                ctx.state.wmImage = { src: c.toDataURL('image/png'), w: bmp.width, h: bmp.height, name: f.name };
                imgName.textContent = f.name;
                upd();
            },
        });
        const imgName = h('span.hint', ctx.state.wmImage?.name || 'Nenhuma imagem escolhida');
        const imageBox = h('div', { style: { display: 'grid', gap: '12px' } },
            h('div.field', h('span.label', 'Imagem'), h('div', h('button.btn.btn-sm', { type: 'button', onclick: () => imgInput.click() }, 'Escolher imagem'), imgInput), imgName),
            F.field('Largura', F.range(o.imageScale, 5, 100, 1, v => { o.imageScale = v; upd(); }, v => v + '% da página')));
        const posField = h('div.field', h('span.label', 'Posição'), F.position(o.pos, v => { o.pos = v; upd(); }));
        const sync = () => { textBox.hidden = o.type !== 'text'; imageBox.hidden = o.type !== 'image'; posField.hidden = o.mosaic; };
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.field', h('span.label', 'Tipo'),
                F.choices('wm-type', [{ value: 'text', label: 'Texto' }, { value: 'image', label: 'Imagem' }], o.type, v => { o.type = v; sync(); upd(); }, true)),
            textBox, imageBox,
            F.field('Transparência', F.range(o.opacity, 0.05, 1, 0.05, v => { o.opacity = v; upd(); }, v => Math.round(v * 100) + '% visível')),
            F.field('Inclinação', F.range(o.angle, -90, 90, 5, v => { o.angle = v; upd(); }, v => v + '°')),
            F.check('Repetir em mosaico pela página', o.mosaic, v => { o.mosaic = v; sync(); upd(); }),
            posField,
            F.field('Páginas', F.text(o.pages, debounce(v => { o.pages = v; upd(); }, 300), { placeholder: 'Todas' }), 'Ex.: 1-3, 5. Em branco = todas.'));
    },
    async run(ctx) {
        const doc = await PDF.load(ctx.files[0].bytes);
        ctx.progress(0.4, "Aplicando marca d'água...");
        await applyWatermark(ctx, doc, doc.getPageIndices(), doc.getPageCount());
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-marca-dagua.pdf' };
    },
});

/* ---------- Números de página ---------- */
const NUMBER_FORMATS = [
    { value: '{n}', label: '1' },
    { value: 'Página {n}', label: 'Página 1' },
    { value: '{n} de {t}', label: '1 de 10' },
    { value: 'Página {n} de {t}', label: 'Página 1 de 10' },
    { value: '{n}/{t}', label: '1/10' },
    { value: '- {n} -', label: '- 1 -' },
];

async function applyPageNumbers(ctx, doc, origIdx, total) {
    const o = ctx.opts;
    const font = await doc.embedFont(fontFor(o.font, o.bold));
    const color = PDF.hexToRgb(o.color);
    const include = pageFilter(o.pages, total);
    // quais páginas do documento original recebem número
    const numbered = [];
    for (let i = 0; i < total; i++) if (include(i) && !(o.skipFirst && i === 0)) numbered.push(i);
    const lastNum = o.start + numbered.length - 1;
    doc.getPages().forEach((page, k) => {
        const orig = origIdx[k];
        const pos = numbered.indexOf(orig);
        if (pos < 0) return;
        const n = o.start + pos;
        const text = PDF.safeText(font, o.format.replace('{n}', n).replace('{t}', lastNum));
        const g = PDF.geom(page);
        const w = font.widthOfTextAtSize(text, o.size);
        const cap = font.heightAtSize(o.size, { descender: false });
        const m = o.margin;
        const col = o.pos[1], row = o.pos[0];
        const vx = col === 'l' ? m : col === 'r' ? g.vw - m - w : (g.vw - w) / 2;
        const vy = row === 't' ? m + cap : g.vh - m;
        const p = g.toPdf(vx, vy);
        page.drawText(text, { x: p.x, y: p.y, size: o.size, font, color, rotate: PDFLib.degrees(g.rot) });
    });
}

App.register({
    id: 'page-numbers',
    cat: 'editar',
    title: 'Números de página',
    desc: 'Numere as páginas do PDF escolhendo posição, formato e estilo.',
    keywords: 'numerar paginação rodapé',
    icon: ICONS.file + '<path d="M10 13h1v5M10 18h2.5"/>',
    accept: 'pdf',
    view: 'custom',
    actionLabel: 'Adicionar números',
    doneTitle: 'As páginas foram numeradas',
    defaults: { pos: 'bc', margin: 30, format: '{n}', start: 1, skipFirst: false, pages: '', font: 'helv', bold: false, size: 11, color: '#222222' },
    workspace: (ctx, ws) => livePreview(ctx, ws, applyPageNumbers),
    options(ctx) {
        const o = ctx.opts;
        const upd = () => ctx.state.schedulePreview?.();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.field', h('span.label', 'Posição'),
                F.position(o.pos, v => { o.pos = v; upd(); }, ['tl', 'tc', 'tr', 'bl', 'bc', 'br'])),
            h('div.field', h('span.label', 'Distância da borda'),
                F.choices('np-margin', [{ value: 18, label: 'Pequena' }, { value: 30, label: 'Média' }, { value: 50, label: 'Grande' }], o.margin, v => { o.margin = v; upd(); }, true)),
            F.field('Formato', F.select(NUMBER_FORMATS, o.format, v => { o.format = v; upd(); })),
            h('div.row',
                F.field('Começar em', F.number(o.start, v => { o.start = Math.max(0, Math.floor(v) || 0); upd(); }, { min: 0 })),
                F.field('Tamanho', F.number(o.size, v => { o.size = Math.max(5, v || 5); upd(); }, { min: 5, max: 72 }))),
            h('div.row', { style: { alignItems: 'end' } },
                F.field('Fonte', F.select([{ value: 'helv', label: 'Helvetica' }, { value: 'times', label: 'Times' }, { value: 'courier', label: 'Courier' }], o.font, v => { o.font = v; upd(); })),
                F.field('Cor', F.color(o.color, v => { o.color = v; upd(); }))),
            F.check('Negrito', o.bold, v => { o.bold = v; upd(); }),
            F.check('Não numerar a primeira página (capa)', o.skipFirst, v => { o.skipFirst = v; upd(); }),
            F.field('Páginas', F.text(o.pages, debounce(v => { o.pages = v; upd(); }, 300), { placeholder: 'Todas' }), 'Ex.: 3-20 para numerar só o miolo.'));
    },
    async run(ctx) {
        const doc = await PDF.load(ctx.files[0].bytes);
        ctx.progress(0.4, 'Numerando páginas...');
        await applyPageNumbers(ctx, doc, doc.getPageIndices(), doc.getPageCount());
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-numerado.pdf' };
    },
});

/* ---------- propriedades do item selecionado (assinar / editar) ---------- */
function renderItemProps(ctx, box, item) {
    box.replaceChildren();
    const ed = ctx.state.editor;
    if (!item) {
        box.append(h('span.hint', 'Clique em um item na página para ajustar ou mover. Teclas de seta movem com precisão.'));
        return;
    }
    const redraw = () => ed.drawItems();
    const fields = [];
    if (item.type === 'text') {
        fields.push(
            h('div.row',
                F.field('Tamanho', F.number(item.size, v => { item.size = Math.max(4, v || 4); redraw(); }, { min: 4, max: 200, step: 0.5 })),
                F.field('Cor', F.color(item.color, v => { item.color = v; redraw(); }))),
            h('div.row', { style: { alignItems: 'end' } },
                F.field('Fonte', F.select([{ value: 'helv', label: 'Helvetica' }, { value: 'times', label: 'Times' }, { value: 'courier', label: 'Courier' }], item.font, v => { item.font = v; redraw(); })),
                F.check('Negrito', item.bold, v => { item.bold = v; redraw(); })));
    } else if (item.type === 'rect') {
        fields.push(h('div.row', { style: { alignItems: 'end' } },
            F.field('Cor', F.color(item.fill, v => { item.fill = v; redraw(); })),
            F.field('Opacidade', F.range(item.opacity, 0.1, 1, 0.05, v => { item.opacity = v; redraw(); }, v => Math.round(v * 100) + '%'))));
    }
    box.append(h('b', { style: { fontSize: '.9rem' } }, { text: 'Texto selecionado', image: 'Imagem selecionada', rect: 'Retângulo selecionado' }[item.type]),
        ...fields,
        h('div.tool-buttons',
            h('button.btn.btn-sm', { type: 'button', onclick: () => ed.repeatAll(item) }, 'Repetir em todas as páginas'),
            h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: () => ed.remove(item) }, icon('x'), 'Excluir')));
}

function editorTextItem(ed, text, size = 14) {
    const { w, h: hh } = ed.pageSize();
    return ed.add({ type: 'text', text, size, color: '#111111', font: 'helv', bold: false, x: w * 0.1, y: hh * 0.45 });
}

async function imageFileToItem(file) {
    const bmp = await loadImageBitmap(file);
    const c = h('canvas', { width: bmp.width, height: bmp.height });
    c.getContext('2d').drawImage(bmp, 0, 0);
    const jpg = /jpe?g/i.test(file.type);
    return { src: c.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.92), w: bmp.width, h: bmp.height };
}

function addImageItem(ed, img, widthFrac = 0.3) {
    const { w: pw, h: ph } = ed.pageSize();
    const w = pw * widthFrac, hh = w * img.h / img.w;
    return ed.add({ type: 'image', src: img.src, x: (pw - w) / 2, y: Math.min(ph - hh - 20, ph * 0.68), w, h: hh });
}

/* ---------- Assinar PDF ---------- */
App.register({
    id: 'sign',
    cat: 'editar',
    title: 'Assinar PDF',
    desc: 'Desenhe, digite ou envie sua assinatura e posicione no documento.',
    keywords: 'assinatura rubrica assinar',
    icon: '<path d="M3 17c3-4 5-9 7-9s-1 9 2 9 3-4 5-4 2 3 4 3"/><path d="M3 21h18"/>',
    accept: 'pdf',
    view: 'custom',
    actionLabel: 'Assinar e baixar',
    doneTitle: 'Seu documento foi assinado',
    next: ['protect', 'compress', 'merge'],
    validate: ctx => ctx.state.items?.length ? null : 'Adicione sua assinatura em alguma página.',
    workspace(ctx, ws) {
        new PageEditor(ctx, ws, { mode: 'items', onSelect: it => ctx.state.propsBox && renderItemProps(ctx, ctx.state.propsBox, it) });
    },
    options(ctx) {
        const st = ctx.state;
        st.sigs = st.sigs || [];
        const list = h('div.sig-list');
        const drawList = () => {
            list.replaceChildren(...st.sigs.map(s => h('button.sig-thumb', {
                type: 'button', title: 'Colocar na página atual', onclick: () => addImageItem(st.editor, s),
            }, h('img', { src: s.src, alt: 'Assinatura' }))));
        };
        drawList();
        st.propsBox = h('div.props');
        renderItemProps(ctx, st.propsBox, null);
        const today = new Date().toLocaleDateString('pt-BR');
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('button.btn.btn-primary', {
                type: 'button',
                onclick: () => openSignatureModal(sig => { st.sigs.push(sig); drawList(); addImageItem(st.editor, sig); }),
            }, icon('plus'), 'Criar assinatura'),
            h('div.field', h('span.label', 'Suas assinaturas'), list, h('span.hint', 'Clique numa assinatura para colocá-la na página exibida.')),
            h('div.tool-buttons',
                h('button.btn', { type: 'button', onclick: () => editorTextItem(st.editor, today, 12) }, 'Data de hoje'),
                h('button.btn', { type: 'button', onclick: () => editorTextItem(st.editor, 'Nome completo', 12) }, 'Texto')),
            st.propsBox);
    },
    async run(ctx) {
        const doc = await PDF.load(ctx.files[0].bytes);
        ctx.progress(0.4, 'Aplicando assinatura...');
        await applyEditorItems(doc, ctx.state.items);
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-assinado.pdf' };
    },
});

/* ---------- Editar PDF ---------- */
App.register({
    id: 'edit',
    cat: 'editar',
    title: 'Editar PDF',
    desc: 'Adicione textos e imagens, cubra informações ou destaque trechos.',
    keywords: 'escrever texto adicionar imagem cobrir apagar destacar',
    icon: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    accept: 'pdf',
    view: 'custom',
    actionLabel: 'Salvar alterações',
    doneTitle: 'Seu PDF foi editado',
    validate: ctx => ctx.state.items?.length ? null : 'Adicione algum texto, imagem ou forma.',
    workspace(ctx, ws) {
        new PageEditor(ctx, ws, { mode: 'items', onSelect: it => ctx.state.propsBox && renderItemProps(ctx, ctx.state.propsBox, it) });
    },
    options(ctx) {
        const st = ctx.state;
        st.propsBox = h('div.props');
        renderItemProps(ctx, st.propsBox, null);
        const imgInput = h('input', {
            type: 'file', accept: 'image/*', hidden: true,
            onchange: async e => {
                const f = e.target.files[0];
                if (f) addImageItem(st.editor, await imageFileToItem(f), 0.4);
                e.target.value = '';
            },
        });
        const rect = (fill, opacity, label) => h('button.btn', {
            type: 'button', onclick: () => {
                const { w, h: hh } = st.editor.pageSize();
                st.editor.add({ type: 'rect', fill, opacity, x: w * 0.3, y: hh * 0.4, w: w * 0.4, h: 24 });
            },
        }, label);
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.tool-buttons',
                h('button.btn', { type: 'button', onclick: () => editorTextItem(st.editor, 'Digite aqui') }, 'Texto'),
                h('button.btn', { type: 'button', onclick: () => imgInput.click() }, 'Imagem'),
                rect('#ffffff', 1, 'Cobrir (branco)'),
                rect('#ffe14d', 0.4, 'Destacar')),
            imgInput,
            F.note(h('b', 'Cobrir '), 'esconde visualmente o que está embaixo, mas o texto original continua no arquivo. Para documentos sigilosos, use "Comprimir PDF" no modo Máxima depois, que transforma as páginas em imagem.'),
            st.propsBox);
    },
    async run(ctx) {
        const doc = await PDF.load(ctx.files[0].bytes);
        ctx.progress(0.4, 'Aplicando alterações...');
        await applyEditorItems(doc, ctx.state.items);
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-editado.pdf' };
    },
});

/* ---------- Recortar PDF ---------- */
App.register({
    id: 'crop',
    cat: 'editar',
    title: 'Recortar PDF',
    desc: 'Corte as margens ou uma área das páginas do PDF.',
    keywords: 'cortar margens aparar',
    icon: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
    accept: 'pdf',
    view: 'custom',
    actionLabel: 'Recortar PDF',
    doneTitle: 'Seu PDF foi recortado',
    defaults: { scope: 'all' },
    workspace(ctx, ws) {
        new PageEditor(ctx, ws, { mode: 'crop', onCrop: () => ctx.state.cropInfo?.() });
        ctx.state.cropInfo?.();
    },
    options(ctx) {
        const st = ctx.state;
        const info = h('span.hint');
        st.cropInfo = () => {
            const ed = st.editor, c = st.crop;
            if (!ed?.vw) return;
            const cm = v => (v / 72 * 2.54).toFixed(1).replace('.', ',');
            info.textContent = `Área: ${cm(c.fw * ed.vw)} × ${cm(c.fh * ed.vh)} cm`;
        };
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.note('Arraste o retângulo para posicionar e use o canto inferior direito para mudar o tamanho. A parte escurecida será cortada.'),
            info,
            h('div.field', h('span.label', 'Aplicar em'),
                F.choices('crop-scope', [
                    { value: 'all', label: 'Todas as páginas' },
                    { value: 'current', label: 'Só na página exibida' },
                ], ctx.opts.scope, v => ctx.opts.scope = v)),
            h('button.btn', { type: 'button', onclick: () => { st.crop = { fx: 0.04, fy: 0.04, fw: 0.92, fh: 0.92 }; st.editor.drawItems(); st.cropInfo(); } }, 'Restaurar área'));
    },
    async run(ctx) {
        const st = ctx.state, c = st.crop;
        const doc = await PDF.load(ctx.files[0].bytes);
        doc.getPages().forEach((page, i) => {
            if (ctx.opts.scope === 'current' && i !== st.cur) return;
            const g = PDF.geom(page);
            const a = g.toPdf(c.fx * g.vw, c.fy * g.vh);
            const b = g.toPdf((c.fx + c.fw) * g.vw, (c.fy + c.fh) * g.vh);
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
            const w = Math.abs(a.x - b.x), hh = Math.abs(a.y - b.y);
            page.setMediaBox(x, y, w, hh);
            page.setCropBox(x, y, w, hh);
        });
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-recortado.pdf' };
    },
});
