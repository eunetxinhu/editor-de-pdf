/* Ferramentas de organização: juntar, dividir, remover, extrair, organizar, girar */
'use strict';

const GROUP_COLORS = ['#2546c7', '#c2501d', '#0e7f5f', '#7b3fbf', '#a0750a', '#b3263e', '#3f5d73', '#c23f8f'];

/** Campo de intervalos de páginas sincronizado com a seleção na grade */
function rangeSyncField(ctx, label, hint) {
    const input = F.text(PDF.formatRanges(ctx.pages.filter(p => p.sel).map(p => p.index)), debounce(v => {
        const set = new Set(PDF.parseRanges(v, ctx.pages.length));
        ctx.pages.forEach(p => p.sel = set.has(p.index));
        ctx.state.syncing = true;
        ctx.renderWorkspace();
        ctx.state.syncing = false;
        ctx.updateAction();
        updateCount();
    }, 350), { placeholder: 'Ex.: 1, 3, 5-8' });
    const count = h('span.hint');
    const updateCount = () => {
        const n = ctx.pages.filter(p => p.sel).length;
        count.textContent = n ? `${n} de ${ctx.pages.length} páginas selecionadas` : 'Clique nas páginas ou digite os números.';
    };
    ctx.state.syncRanges = () => {
        if (!ctx.state.syncing) input.value = PDF.formatRanges(ctx.pages.filter(p => p.sel).map(p => p.index));
        updateCount();
    };
    updateCount();
    return h('div.field', h('label', label), input, count, hint && h('span.hint', hint));
}

function selectionButtons(ctx) {
    const set = fn => { ctx.pages.forEach(fn); ctx.refreshPages(); };
    return [
        h('button.btn.btn-sm', { type: 'button', onclick: () => set(p => p.sel = true) }, 'Todas'),
        h('button.btn.btn-sm', { type: 'button', onclick: () => set(p => p.sel = false) }, 'Nenhuma'),
        h('button.btn.btn-sm', { type: 'button', onclick: () => set(p => p.sel = !p.sel) }, 'Inverter'),
    ];
}

/* ---------- Juntar PDF ---------- */
App.register({
    id: 'merge',
    cat: 'organizar',
    title: 'Juntar PDF',
    desc: 'Combine vários PDFs em um só arquivo, na ordem que você escolher.',
    keywords: 'mesclar unir combinar merge',
    icon: '<path d="M6 3v5c0 2 1 3 3 4l3 1.5M18 3v5c0 2-1 3-3 4l-3 1.5V21"/><path d="M9 18l3 3 3-3"/>',
    accept: 'pdf',
    multiple: true,
    actionLabel: 'Juntar PDF',
    doneTitle: 'Seus PDFs foram juntados',
    defaults: { name: 'pdf-unido' },
    validate: ctx => ctx.files.length < 2 ? 'Adicione pelo menos 2 PDFs.' : null,
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.field('Nome do arquivo final', F.text(ctx.opts.name, v => ctx.opts.name = v)),
            F.note('A ordem dos cartões é a ordem das páginas no arquivo final. Arraste para reorganizar.'));
    },
    async run(ctx) {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < ctx.files.length; i++) {
            const f = ctx.files[i];
            ctx.progress(i / ctx.files.length, `Juntando ${f.file.name}...`);
            const src = await PDF.load(f.bytes);
            const pages = await out.copyPages(src, src.getPageIndices());
            pages.forEach(p => out.addPage(p));
        }
        ctx.progress(0.95, 'Salvando...');
        return { blob: pdfBlob(await PDF.save(out)), name: safeFileName(ctx.opts.name || 'pdf-unido') + '.pdf' };
    },
});

/* ---------- Dividir PDF ---------- */
function splitGroups(ctx) {
    const n = ctx.pages.length;
    const o = ctx.opts;
    if (o.mode === 'all') return ctx.pages.map((_, i) => [i]);
    if (o.mode === 'every') {
        const k = Math.max(1, Math.floor(o.every) || 1);
        const g = [];
        for (let i = 0; i < n; i += k) g.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j));
        return g;
    }
    return PDF.parseGroups(o.ranges, n);
}

App.register({
    id: 'split',
    cat: 'organizar',
    title: 'Dividir PDF',
    desc: 'Separe um PDF em vários arquivos por intervalos ou a cada N páginas.',
    keywords: 'separar cortar split',
    icon: '<path d="M12 3v6M12 9l-6 6v6M12 9l6 6v6"/><path d="M3 12h4M17 12h4" stroke-dasharray="2 2"/>',
    accept: 'pdf',
    view: 'pages',
    pagesMode: 'view',
    actionLabel: 'Dividir PDF',
    doneTitle: 'Seu PDF foi dividido',
    defaults: { mode: 'ranges', ranges: '', every: 1, mergeRanges: false },
    onFiles(ctx) {
        const n = ctx.pages.length;
        const half = Math.ceil(n / 2);
        ctx.opts.ranges = n > 1 ? `1-${half}, ${half + 1}-${n}` : '1';
    },
    pageBadge(ctx, p, i) {
        if (!ctx.state.groupOf) return null;
        const g = ctx.state.groupOf[i];
        return g == null ? { text: 'fora', color: '#7a8494' } : { text: 'Arquivo ' + (g + 1), color: GROUP_COLORS[g % GROUP_COLORS.length] };
    },
    pagesHint(ctx) {
        const groups = splitGroups(ctx);
        ctx.state.groupOf = {};
        const many = ctx.opts.mode === 'ranges' && ctx.opts.mergeRanges;
        groups.forEach((g, gi) => g.forEach(i => { if (ctx.state.groupOf[i] == null) ctx.state.groupOf[i] = many ? 0 : gi; }));
        const files = many ? Math.min(1, groups.length) : groups.length;
        return `${ctx.pages.length} páginas · vai gerar ${files} ${files === 1 ? 'arquivo' : 'arquivos'}`;
    },
    validate(ctx) {
        return splitGroups(ctx).length ? null : 'Informe intervalos válidos, por exemplo 1-3, 4-6.';
    },
    options(ctx) {
        const redraw = () => { ctx.renderWorkspace(); ctx.updateAction(); };
        const rangesBox = h('div', { style: { display: 'grid', gap: '12px' } },
            F.field('Intervalos', F.text(ctx.opts.ranges, debounce(v => { ctx.opts.ranges = v; redraw(); }, 300), { placeholder: 'Ex.: 1-3, 4-6, 7' }),
                'Cada intervalo separado por vírgula vira um arquivo.'),
            F.check('Juntar todos os intervalos em um único PDF', ctx.opts.mergeRanges, v => { ctx.opts.mergeRanges = v; redraw(); }));
        const everyBox = F.field('Páginas por arquivo', F.number(ctx.opts.every, v => { ctx.opts.every = v; redraw(); }, { min: 1, max: ctx.pages.length }));
        const sync = () => { rangesBox.hidden = ctx.opts.mode !== 'ranges'; everyBox.hidden = ctx.opts.mode !== 'every'; };
        sync();
        return h('div', { style: { display: 'grid', gap: '14px' } },
            F.choices('split-mode', [
                { value: 'ranges', label: 'Por intervalos', hint: 'Você escolhe quais páginas vão em cada arquivo.' },
                { value: 'every', label: 'A cada N páginas', hint: 'Divide em partes de tamanho fixo.' },
                { value: 'all', label: 'Todas as páginas', hint: 'Cada página vira um PDF.' },
            ], ctx.opts.mode, v => { ctx.opts.mode = v; sync(); redraw(); }),
            rangesBox, everyBox);
    },
    zipName: ctx => baseName(ctx.files[0].file.name) + '-dividido.zip',
    async run(ctx) {
        const src = await PDF.load(ctx.files[0].bytes);
        const base = baseName(ctx.files[0].file.name);
        let groups = splitGroups(ctx);
        if (ctx.opts.mode === 'ranges' && ctx.opts.mergeRanges) groups = [groups.flat()];
        const outs = [];
        for (let i = 0; i < groups.length; i++) {
            ctx.progress(i / groups.length, `Criando arquivo ${i + 1} de ${groups.length}...`);
            const doc = await PDF.pick(src, groups[i]);
            outs.push({ blob: pdfBlob(await PDF.save(doc)), name: `${base}-pag-${PDF.formatRanges(groups[i]).replace(/, /g, '_')}.pdf` });
        }
        return outs;
    },
});

/* ---------- Remover páginas ---------- */
App.register({
    id: 'remove-pages',
    cat: 'organizar',
    title: 'Remover páginas',
    desc: 'Exclua as páginas que você não quer mais no PDF.',
    keywords: 'excluir apagar deletar páginas',
    icon: ICONS.file + '<path d="M9 14h6"/>',
    accept: 'pdf',
    view: 'pages',
    pagesMode: 'select',
    selectStyle: 'remove',
    actionLabel: 'Remover páginas',
    doneTitle: 'As páginas foram removidas',
    pagesHint: ctx => 'Clique nas páginas que você quer remover',
    pagesActions: ctx => selectionButtons(ctx),
    onSelect: ctx => ctx.state.syncRanges?.(),
    validate(ctx) {
        const n = ctx.pages.filter(p => p.sel).length;
        if (!n) return 'Selecione as páginas que serão removidas.';
        if (n === ctx.pages.length) return 'Não é possível remover todas as páginas.';
        return null;
    },
    options: ctx => rangeSyncField(ctx, 'Páginas a remover'),
    async run(ctx) {
        const src = await PDF.load(ctx.files[0].bytes);
        const keep = ctx.pages.filter(p => !p.sel).map(p => p.index);
        ctx.progress(0.5, 'Removendo páginas...');
        const doc = await PDF.pick(src, keep);
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-editado.pdf' };
    },
});

/* ---------- Extrair páginas ---------- */
App.register({
    id: 'extract',
    cat: 'organizar',
    title: 'Extrair páginas',
    desc: 'Crie um novo PDF só com as páginas que você escolher.',
    keywords: 'selecionar separar páginas',
    icon: ICONS.file + '<path d="M12 11v6M9 14l3-3 3 3"/>',
    accept: 'pdf',
    view: 'pages',
    pagesMode: 'select',
    actionLabel: 'Extrair páginas',
    doneTitle: 'As páginas foram extraídas',
    defaults: { separate: false },
    pagesHint: ctx => 'Clique nas páginas que você quer extrair',
    pagesActions: ctx => selectionButtons(ctx),
    onSelect: ctx => ctx.state.syncRanges?.(),
    validate: ctx => ctx.pages.some(p => p.sel) ? null : 'Selecione pelo menos uma página.',
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            rangeSyncField(ctx, 'Páginas a extrair'),
            F.check('Salvar cada página em um arquivo separado', ctx.opts.separate, v => ctx.opts.separate = v));
    },
    zipName: ctx => baseName(ctx.files[0].file.name) + '-paginas.zip',
    async run(ctx) {
        const src = await PDF.load(ctx.files[0].bytes);
        const base = baseName(ctx.files[0].file.name);
        const idx = ctx.pages.filter(p => p.sel).map(p => p.index);
        if (ctx.opts.separate) {
            const outs = [];
            for (const [k, i] of idx.entries()) {
                ctx.progress(k / idx.length, `Página ${i + 1}...`);
                outs.push({ blob: pdfBlob(await PDF.save(await PDF.pick(src, [i]))), name: `${base}-pag-${i + 1}.pdf` });
            }
            return outs;
        }
        const doc = await PDF.pick(src, idx);
        return { blob: pdfBlob(await PDF.save(doc)), name: `${base}-paginas-${PDF.formatRanges(idx).replace(/, /g, '_')}.pdf` };
    },
});

/* ---------- Organizar PDF ---------- */
async function buildFromPages(ctx, imageOpts = { size: 'a4', orient: 'auto', margin: 40 }) {
    const out = await PDFLib.PDFDocument.create();
    const cache = new Map();
    let lastSize = PDF.A4;
    for (let i = 0; i < ctx.pages.length; i++) {
        const p = ctx.pages[i];
        if (i % 10 === 0) ctx.progress(i / ctx.pages.length, `Página ${i + 1} de ${ctx.pages.length}...`);
        if (p.blank) {
            const page = out.addPage(lastSize);
            if (p.rot) page.setRotation(PDFLib.degrees(p.rot));
            continue;
        }
        if (p.image) {
            await addImagePage(out, p.file.file, imageOpts);
            const page = out.getPage(out.getPageCount() - 1);
            if (p.rot) page.setRotation(PDFLib.degrees(p.rot));
            const { width, height } = page.getSize();
            lastSize = [width, height];
            continue;
        }
        if (!cache.has(p.file)) cache.set(p.file, await PDF.load(p.file.bytes));
        const [page] = await out.copyPages(cache.get(p.file), [p.index]);
        const orig = page.getRotation().angle || 0;
        page.setRotation(PDFLib.degrees(((orig + p.rot) % 360 + 360) % 360));
        const { width, height } = page.getSize();
        lastSize = [width, height];
        out.addPage(page);
    }
    return out;
}

App.register({
    id: 'organize',
    cat: 'organizar',
    title: 'Organizar PDF',
    desc: 'Reordene, gire, duplique e exclua páginas. Junte páginas de vários PDFs.',
    keywords: 'ordenar reordenar mover páginas',
    icon: '<rect x="3" y="3" width="7" height="8" rx="1"/><rect x="14" y="3" width="7" height="8" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M18 14.5l3 3-3 3"/>',
    accept: 'pdf',
    addMore: true,
    view: 'pages',
    pagesMode: 'organize',
    actionLabel: 'Salvar PDF organizado',
    doneTitle: 'Seu PDF foi organizado',
    defaults: { name: '' },
    pagesHint: ctx => `${ctx.pages.length} páginas · arraste para reordenar`,
    validate: ctx => ctx.pages.length ? null : 'O documento ficou sem páginas.',
    onFiles(ctx) { if (!ctx.opts.name && ctx.files[0]) ctx.opts.name = baseName(ctx.files[0].file.name) + '-organizado'; },
    options(ctx) {
        return h('div', { style: { display: 'grid', gap: '14px' } },
            h('div.tool-buttons',
                h('button.btn', { type: 'button', onclick: () => { ctx.pages.push({ key: 'p' + (++ctx.keySeq), blank: true, rot: 0 }); ctx.refreshPages(); } }, icon('plus'), 'Página em branco'),
                h('button.btn', { type: 'button', onclick: () => { ctx.pages.reverse(); ctx.refreshPages(); } }, 'Inverter ordem'),
                h('button.btn', { type: 'button', onclick: () => { ctx.pages.forEach(p => p.rot = (p.rot + 90) % 360); ctx.refreshPages(); } }, icon('rotR'), 'Girar todas'),
                h('button.btn', { type: 'button', onclick: () => { ctx.pages = []; ctx.buildPages(); ctx.refreshPages(); } }, 'Desfazer tudo')),
            F.field('Nome do arquivo final', F.text(ctx.opts.name, v => ctx.opts.name = v)),
            F.note('Passe o mouse sobre uma página para girar, duplicar ou excluir. No celular, use o ícone de setas para arrastar.'));
    },
    async run(ctx) {
        const out = await buildFromPages(ctx);
        ctx.progress(0.95, 'Salvando...');
        return { blob: pdfBlob(await PDF.save(out)), name: safeFileName(ctx.opts.name || 'organizado') + '.pdf' };
    },
});

/* ---------- Girar PDF ---------- */
App.register({
    id: 'rotate',
    cat: 'organizar',
    title: 'Girar PDF',
    desc: 'Gire todas as páginas ou só as que estão de lado.',
    keywords: 'rotacionar virar',
    icon: ICONS.rotR,
    accept: 'pdf',
    view: 'pages',
    pagesMode: 'rotate',
    actionLabel: 'Girar PDF',
    doneTitle: 'Seu PDF foi girado',
    pagesHint: () => 'Clique numa página para girá-la 90°',
    pagesActions(ctx) {
        const all = d => { ctx.pages.forEach(p => p.rot = ((p.rot + d) % 360 + 360) % 360); ctx.refreshPages(); };
        return [
            h('button.btn.btn-sm', { type: 'button', onclick: () => all(-90) }, icon('rotL'), 'Todas'),
            h('button.btn.btn-sm', { type: 'button', onclick: () => all(90) }, icon('rotR'), 'Todas'),
            h('button.btn.btn-sm', { type: 'button', onclick: () => { ctx.pages.forEach(p => p.rot = 0); ctx.refreshPages(); } }, 'Restaurar'),
        ];
    },
    onSelect: ctx => ctx.updateAction(),
    validate: ctx => ctx.pages.some(p => p.rot) ? null : 'Gire pelo menos uma página.',
    options: () => F.note('Use os botões acima da grade para girar todas de uma vez, ou clique em cada página individualmente.'),
    async run(ctx) {
        const doc = await PDF.load(ctx.files[0].bytes);
        doc.getPages().forEach((page, i) => {
            const r = ctx.pages[i].rot;
            if (r) page.setRotation(PDFLib.degrees(((page.getRotation().angle + r) % 360 + 360) % 360));
        });
        return { blob: pdfBlob(await PDF.save(doc)), name: baseName(ctx.files[0].file.name) + '-girado.pdf' };
    },
});
