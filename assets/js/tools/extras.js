/* Ferramentas próprias do projeto: gerar contrato e converter imagem */
'use strict';

App.register({
    id: 'contract',
    cat: 'extras',
    title: 'Gerar contrato',
    desc: 'Junte PDFs e fotos de documentos em um único PDF, com o nome do beneficiário.',
    keywords: 'contrato documentos beneficiário juntar fotos',
    icon: ICONS.file + '<path d="M8 13h8M8 17h5"/>',
    accept: 'pdf+image',
    multiple: true,
    view: 'pages',
    pagesMode: 'organize',
    actionLabel: 'Gerar contrato',
    doneTitle: 'Contrato gerado',
    defaults: { name: '' },
    pagesHint: ctx => `${ctx.pages.length} ${ctx.pages.length === 1 ? 'página' : 'páginas'} · arraste para reordenar`,
    validate: ctx => ctx.pages.length ? null : 'O contrato ficou sem páginas.',
    options(ctx) {
        const o = ctx.opts;
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Nome do beneficiário', F.text(o.name, v => o.name = v, { placeholder: 'Ex.: João da Silva' }),
                'Usado no nome do arquivo: "contrato - Nome.pdf".'),
            h('div.tool-buttons',
                h('button.btn', { type: 'button', onclick: () => { ctx.pages.reverse(); ctx.refreshPages(); } }, 'Inverter ordem'),
                h('button.btn', { type: 'button', onclick: () => { ctx.pages = []; ctx.buildPages(); ctx.refreshPages(); } }, 'Desfazer tudo')),
            F.note('Cada página dos PDFs e cada foto aparece separada: arraste para mudar a ordem, gire ou exclua. As fotos são ajustadas a uma folha A4 com margem.'));
    },
    async run(ctx) {
        const out = await buildFromPages(ctx, { size: 'a4', orient: 'portrait', margin: 40 });
        ctx.progress(0.95, 'Salvando...');
        const name = ctx.opts.name.trim();
        return { blob: pdfBlob(await PDF.save(out)), name: safeFileName(name ? `contrato - ${name}` : 'contrato') + '.pdf' };
    },
});

App.register({
    id: 'image-convert',
    cat: 'extras',
    title: 'Converter imagem',
    desc: 'Converta imagens entre JPG, PNG e WEBP, com opção de reduzir o tamanho.',
    keywords: 'jpg png webp formato redimensionar',
    icon: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M14 4h3a3 3 0 0 1 3 3v3M10 20H7a3 3 0 0 1-3-3v-3"/>',
    accept: 'image',
    multiple: true,
    sortable: false,
    actionLabel: 'Converter imagens',
    doneTitle: 'Imagens convertidas',
    defaults: { format: 'image/jpeg', quality: 0.9, maxDim: 0 },
    options(ctx) {
        const o = ctx.opts;
        const q = F.field('Qualidade', F.range(o.quality, 0.4, 1, 0.05, v => o.quality = v, v => Math.round(v * 100) + '%'));
        const sync = () => q.hidden = o.format === 'image/png';
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.field', h('span.label', 'Formato de saída'),
                F.choices('img-fmt', [
                    { value: 'image/jpeg', label: 'JPG' },
                    { value: 'image/png', label: 'PNG' },
                    { value: 'image/webp', label: 'WEBP' },
                ], o.format, v => { o.format = v; sync(); }, true)),
            q,
            F.field('Tamanho máximo', F.select([
                { value: 0, label: 'Manter o original' },
                { value: 2560, label: 'Até 2560 px' },
                { value: 1920, label: 'Até 1920 px (Full HD)' },
                { value: 1280, label: 'Até 1280 px' },
                { value: 800, label: 'Até 800 px' },
            ], o.maxDim, v => o.maxDim = +v), 'Vale para o lado maior da imagem.'));
    },
    zipName: () => 'imagens-convertidas.zip',
    async run(ctx) {
        const o = ctx.opts;
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[o.format];
        const outs = [];
        for (let i = 0; i < ctx.files.length; i++) {
            const f = ctx.files[i].file;
            ctx.progress(i / ctx.files.length, `Convertendo ${i + 1} de ${ctx.files.length}...`);
            const bmp = await loadImageBitmap(f);
            const s = o.maxDim ? Math.min(1, o.maxDim / Math.max(bmp.width, bmp.height)) : 1;
            const c = h('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
            const c2 = c.getContext('2d');
            if (o.format === 'image/jpeg') { c2.fillStyle = '#fff'; c2.fillRect(0, 0, c.width, c.height); }
            c2.drawImage(bmp, 0, 0, c.width, c.height);
            outs.push({ blob: await canvasToBlob(c, o.format, o.quality), name: baseName(f.name) + '.' + ext });
        }
        return outs;
    },
});
